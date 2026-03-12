// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import ChatPanel from "../components/ChatPanel";
import type {
  ChatMessage,
  SessionCostDisplay,
  SessionSummary,
  ThreadHydrationState
} from "../domain/types";
import {
  buildExpandedVisibleWindow,
  buildRenderedTranscriptSnapshot,
  buildVisibleWindowSnapshot,
  extractRenderedTranscriptDomEntries,
  findDuplicateWindowKeys,
  summarizeRoleRuns,
  toRenderedTranscriptStoreEntries
} from "../services/renderedTranscriptSnapshot";

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

const buildMessage = (partial: Partial<ChatMessage>): ChatMessage => ({
  id: "message-id",
  key: "device-1::thread-1",
  threadId: "thread-1",
  deviceId: "device-1",
  role: "assistant",
  content: "hello",
  createdAt: "2026-03-12T10:00:00.000Z",
  ...partial
});

const buildSession = (messages: ChatMessage[]): SessionSummary => ({
  key: messages[0]?.key ?? "device-1::thread-1",
  threadId: messages[0]?.threadId ?? "thread-1",
  deviceId: messages[0]?.deviceId ?? "device-1",
  deviceLabel: "Local Device",
  deviceAddress: "127.0.0.1",
  title: "Snapshot test",
  preview: "",
  updatedAt: messages.at(-1)?.createdAt ?? "2026-03-12T10:00:00.000Z"
});

describe("renderedTranscriptSnapshot helpers", () => {
  it("records duplicate window keys for ambiguous non-tool history entries", () => {
    const messages = [
      buildMessage({
        id: "item-1",
        role: "assistant",
        content: "First assistant copy"
      }),
      buildMessage({
        id: "item-1",
        role: "assistant",
        content: "Second assistant copy",
        createdAt: "2026-03-12T10:00:01.000Z"
      })
    ];

    expect(findDuplicateWindowKeys(messages)).toEqual([
      {
        renderKey: "item-1::assistant::",
        positions: [0, 1]
      }
    ]);
  });

  it("builds visible-window metadata from the same helper used by ChatPanel", () => {
    const messages = [
      buildMessage({
        id: "older-user",
        role: "user",
        content: "Earlier prompt"
      }),
      buildMessage({
        id: "tool-1",
        role: "tool",
        eventType: "tool_call",
        createdAt: "2026-03-12T10:00:01.000Z",
        content: "Tool: exec_command",
        toolCall: {
          name: "exec_command",
          input: "pwd",
          status: "completed"
        }
      }),
      buildMessage({
        id: "assistant-1",
        role: "assistant",
        createdAt: "2026-03-12T10:00:02.000Z",
        content: "Latest answer"
      })
    ];

    const visibleWindow = buildVisibleWindowSnapshot({
      messages,
      visibleMessageCount: 2,
      anchorMessageKey: null
    });

    expect(visibleWindow).toEqual({
      hiddenMessageCount: 0,
      startIndex: 0,
      anchorMessageKey: null,
      visibleRenderKeys: [
        "older-user::user::",
        "tool-1::tool::tool_call::2026-03-12T10:00:01.000Z",
        "assistant-1::assistant::"
      ]
    });
  });

  it("captures expanded ChatPanel DOM order, labels, and diffs", () => {
    const messages = [
      buildMessage({
        id: "user-1",
        role: "user",
        content: "Inspect the reopened session ordering."
      }),
      buildMessage({
        id: "tool-1",
        role: "tool",
        eventType: "tool_call",
        createdAt: "2026-03-12T10:00:01.000Z",
        content: "Tool: exec_command",
        toolCall: {
          name: "exec_command",
          input: "pwd",
          output: "/Users/demo/project",
          status: "completed"
        }
      }),
      buildMessage({
        id: "assistant-1",
        role: "assistant",
        createdAt: "2026-03-12T10:00:02.000Z",
        chronologySource: "rollout",
        timelineOrder: 2,
        content: "I found the ordering issue."
      })
    ];

    const session = buildSession(messages);
    const expandedWindow = buildExpandedVisibleWindow(messages);
    const { container } = render(
      <ChatPanel
        session={session}
        messages={messages}
        costDisplay={DEFAULT_COST_DISPLAY}
        hydrationState={DEFAULT_HYDRATION_STATE}
        windowOverride={expandedWindow}
      />
    );

    const domEntries = extractRenderedTranscriptDomEntries(container);
    const snapshot = buildRenderedTranscriptSnapshot({
      session,
      phase: "rollout-idle",
      mode: "expanded-full",
      messages,
      visibleWindow: buildVisibleWindowSnapshot({
        messages,
        visibleMessageCount: messages.length,
        anchorMessageKey: null
      }),
      domEntries
    });

    expect(toRenderedTranscriptStoreEntries(messages).map((entry) => entry.renderKey)).toEqual([
      "user-1::user::",
      "tool-1::tool::tool_call::2026-03-12T10:00:01.000Z",
      "assistant-1::assistant::"
    ]);
    expect(domEntries.map((entry) => entry.renderKey)).toEqual([
      "user-1::user::",
      "tool-1::tool::tool_call::2026-03-12T10:00:01.000Z",
      "assistant-1::assistant::"
    ]);
    expect(domEntries[1]).toMatchObject({
      role: "tool",
      label: "Tool Call",
      toolName: "exec_command",
      toolStatus: "completed"
    });
    expect(snapshot.storeVsDom.firstMismatchIndex).toBeNull();
    expect(snapshot.duplicateWindowKeys).toEqual([]);
    expect(summarizeRoleRuns(domEntries)).toEqual([
      { role: "user", startIndex: 0, length: 1 },
      { role: "tool", startIndex: 1, length: 1 },
      { role: "assistant", startIndex: 2, length: 1 }
    ]);
  });
});
