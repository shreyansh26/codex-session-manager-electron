// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type {
  ChatMessage,
  SessionCostDisplay,
  SessionSummary,
  ThreadHydrationState
} from "../domain/types";
import { parseRpcNotification } from "../services/eventParser";
import {
  __TEST_ONLY__ as codexApiTest,
  parseToolMessagesFromRolloutJsonl
} from "../services/codexApi";
import { __TEST_ONLY__ as storeTest } from "../state/useAppStore";
import ChatPanel from "../components/ChatPanel";
import {
  getMessageWindowKey,
  resolveVisibleMessageWindow
} from "../components/chatWindow";
import {
  chronologyReplayFixtureById,
  type ChronologyReplayFixture
} from "./chronologyReplayFixtures";

const TEST_DEVICE_ID = "device-1";
const DEFAULT_COST_DISPLAY: SessionCostDisplay = {
  costAvailable: false
};
const DEFAULT_HYDRATION_STATE: ThreadHydrationState = {
  baseLoading: false,
  baseLoaded: true,
  toolHistoryLoading: false
};

afterEach(() => {
  cleanup();
});

const replayFixture = (fixture: ChronologyReplayFixture): ChatMessage[] => {
  let messages: ChatMessage[] = [];

  for (const step of fixture.steps) {
    if (step.source === "live") {
      const parsed = parseRpcNotification(TEST_DEVICE_ID, step.notification);
      if (!parsed) {
        continue;
      }
      const normalized = storeTest.normalizeLiveNotificationMessage(messages, parsed.message);
      messages = storeTest.upsertMessage(messages, normalized);
      continue;
    }

    if (step.source === "thread_read") {
      const snapshotMessages = codexApiTest.parseMessagesFromThread(
        TEST_DEVICE_ID,
        fixture.threadId,
        step.snapshot
      );
      messages = storeTest.mergeSnapshotMessages(messages, snapshotMessages);
      continue;
    }

    const jsonl = step.records.map((record) => JSON.stringify(record)).join("\n");
    const rolloutMessages = parseToolMessagesFromRolloutJsonl(
      TEST_DEVICE_ID,
      fixture.threadId,
      jsonl
    );
    messages = storeTest.mergeRolloutEnrichmentMessages(messages, rolloutMessages);
  }

  return messages;
};

const renderChatPanel = (messages: ChatMessage[]) => {
  const threadId = messages[0]?.threadId ?? "thread-render";
  const session: SessionSummary = {
    key: messages[0]?.key ?? `${TEST_DEVICE_ID}::${threadId}`,
    threadId,
    deviceId: TEST_DEVICE_ID,
    deviceLabel: "Local",
    deviceAddress: "127.0.0.1",
    title: "Chronology fixture",
    preview: "",
    updatedAt: messages[messages.length - 1]?.createdAt ?? "2026-03-08T08:00:00.000Z"
  };

  return render(
    <ChatPanel
      session={session}
      messages={messages}
      costDisplay={DEFAULT_COST_DISPLAY}
      hydrationState={DEFAULT_HYDRATION_STATE}
    />
  );
};

const extractRenderedTranscriptOrder = (container: HTMLElement): string[] => {
  const items = Array.from(
    container.querySelectorAll<HTMLLIElement>("li[data-message-id]")
  );

  return items
    .map((item) => {
      const messageId = item.dataset.messageId ?? "";
      const role = (["user", "assistant", "tool", "system"] as const).find((candidate) =>
        item.classList.contains(`bubble--${candidate}`)
      );
      if (!messageId || !role) {
        return null;
      }
      return `${role}:${messageId}`;
    })
    .filter((value): value is string => value !== null);
};

describe("ChatPanel chronology rendering", () => {
  it("renders a tool card whenever toolCall is present, even without eventType", () => {
    const { container } = renderChatPanel([
      {
        id: "tool-without-event-type",
        key: `${TEST_DEVICE_ID}::thread-tool-card`,
        threadId: "thread-tool-card",
        deviceId: TEST_DEVICE_ID,
        role: "tool",
        content: "Tool call payload should not be rendered as markdown fallback.",
        createdAt: "2026-03-08T09:30:00.000Z",
        toolCall: {
          name: "exec_command",
          input: "pwd",
          output: "/Users/demo/project\n",
          status: "completed"
        }
      }
    ]);

    expect(container.querySelector(".bubble__tool-card")).not.toBeNull();
    expect(container.querySelector(".bubble__tool-name")).not.toBeNull();
    expect(container.querySelector(".bubble__markdown")).toBeNull();
  });

  it("shows tool input, output, and status for converged tool-call messages", () => {
    const fixture = chronologyReplayFixtureById["live-snapshot-rollout-tool-convergence"];
    const { container } = renderChatPanel(replayFixture(fixture));
    const toolBubble = container.querySelector(
      'li[data-message-id="call-converge-1"]'
    );

    expect(toolBubble).not.toBeNull();
    expect(toolBubble?.querySelector(".bubble__tool-card")).not.toBeNull();
    expect(toolBubble?.textContent).toContain("Input");
    expect(toolBubble?.textContent).toContain("Output");
    expect(toolBubble?.textContent).toContain("completed");
    expect(toolBubble?.textContent).toContain("Process exited with code 0");
  });

  it("collapses long tool output and renders the expanded state when toggled", () => {
    const longOutput = `${"line\n".repeat(90)}${"x".repeat(4_100)}\nTAIL_MARKER`;
    const message: ChatMessage = {
      id: "tool-long-output",
      key: `${TEST_DEVICE_ID}::thread-long-output`,
      threadId: "thread-long-output",
      deviceId: TEST_DEVICE_ID,
      role: "tool",
      eventType: "tool_call",
      content: "Tool: exec_command",
      createdAt: "2026-03-08T09:31:00.000Z",
      toolCall: {
        name: "exec_command",
        input: "cat huge.log",
        output: longOutput,
        status: "completed"
      }
    };

    const { getByRole, container } = renderChatPanel([message]);
    const expandButton = getByRole("button", { name: "Show full output" });

    expect(container.textContent).toContain("output truncated");
    expect(container.textContent).not.toContain("TAIL_MARKER");

    fireEvent.click(expandButton);

    getByRole("button", { name: "Show less output" });
    expect(container.textContent).toContain("TAIL_MARKER");
    expect(container.textContent).not.toContain("output truncated");
  });

  it("keeps rendered transcript DOM order aligned with canonical replay order", () => {
    const fixture = chronologyReplayFixtureById["reused-call-id-across-turns"];
    const { container } = renderChatPanel(replayFixture(fixture));

    expect(extractRenderedTranscriptOrder(container)).toEqual(fixture.expectedOrder);
  });

  it("keeps early tool calls visible when the latest tail would otherwise cut into the current turn", () => {
    const olderMessages: ChatMessage[] = Array.from({ length: 5 }, (_, index) => ({
      id: `older-${index + 1}`,
      key: `${TEST_DEVICE_ID}::thread-long-turn`,
      threadId: "thread-long-turn",
      deviceId: TEST_DEVICE_ID,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `older message ${index + 1}`,
      createdAt: `2026-03-08T12:00:0${index}.000Z`
    }));
    const currentTurn: ChatMessage[] = [
      {
        id: "current-user",
        key: `${TEST_DEVICE_ID}::thread-long-turn`,
        threadId: "thread-long-turn",
        deviceId: TEST_DEVICE_ID,
        role: "user",
        content: "Continue fixing chronology.",
        createdAt: "2026-03-08T12:01:00.000Z"
      },
      {
        id: "current-tool",
        key: `${TEST_DEVICE_ID}::thread-long-turn`,
        threadId: "thread-long-turn",
        deviceId: TEST_DEVICE_ID,
        role: "tool",
        eventType: "tool_call",
        content: "Tool: exec_command",
        createdAt: "2026-03-08T12:01:01.000Z",
        toolCall: {
          name: "exec_command",
          input: "pwd",
          output: "/Users/demo/project",
          status: "completed"
        }
      },
      ...Array.from({ length: 40 }, (_, index) => ({
        id: `current-assistant-${index + 1}`,
        key: `${TEST_DEVICE_ID}::thread-long-turn`,
        threadId: "thread-long-turn",
        deviceId: TEST_DEVICE_ID,
        role: "assistant" as const,
        content: `current assistant message ${index + 1}`,
        createdAt: `2026-03-08T12:01:${String(index + 2).padStart(2, "0")}.000Z`
      }))
    ];

    const { container } = renderChatPanel([...olderMessages, ...currentTurn]);

    expect(container.textContent).toContain("Load 5 older messages");
    expect(container.querySelector('li[data-message-id="current-user"]')).not.toBeNull();
    expect(container.querySelector('li[data-message-id="current-tool"]')).not.toBeNull();
    expect(container.textContent).toContain("/Users/demo/project");
  });

  it("preserves an anchored visible-window message after chronology reordering", () => {
    const fixture = chronologyReplayFixtureById["stale-refresh-pulls-old-tool-upward"];
    const messages = replayFixture(fixture);
    const initialWindow = resolveVisibleMessageWindow({
      messages,
      visibleMessageCount: 2,
      anchorMessageKey: null
    });
    const anchoredMessage = initialWindow.visibleMessages[0];
    expect(anchoredMessage).toBeDefined();

    const reorderedMessages = [messages[0], messages[2], messages[1], messages[3]];
    const reorderedWindow = resolveVisibleMessageWindow({
      messages: reorderedMessages,
      visibleMessageCount: 2,
      anchorMessageKey: getMessageWindowKey(anchoredMessage)
    });

    expect(reorderedWindow.visibleMessages.some((message) => message.id === anchoredMessage.id)).toBe(
      true
    );
  });
});
