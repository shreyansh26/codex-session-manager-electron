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
  deriveVisibleWindowSnapshotFromDom,
  extractRenderedTranscriptDomEntries,
  findDuplicateWindowKeys,
  summarizeRoleRuns,
  toRenderedTranscriptStoreEntries
} from "../services/renderedTranscriptSnapshot";
import { chronologyReplayFixtureById } from "./chronologyReplayFixtures";
import { applyChronologyReplayFixture } from "./chronologyReplayHarness";

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

  it("captures reopened historical fixtures with canonical expanded DOM order", () => {
    const fixture = chronologyReplayFixtureById["historical-cli-session-flat-item-order"];
    const messages = applyChronologyReplayFixture(fixture);
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
      domEntries: extractRenderedTranscriptDomEntries(container)
    });

    expect(snapshot.domEntries.map((entry) => `${entry.role}:${entry.id}`)).toEqual(
      fixture.expectedOrder
    );
    expect(snapshot.storeVsDom.firstMismatchIndex).toBeNull();
  });

  it("keeps mounted-visible order as an order-preserving slice of expanded DOM order", () => {
    const messages = [
      buildMessage({
        id: "older-1",
        role: "user",
        content: "Older user"
      }),
      buildMessage({
        id: "older-2",
        role: "assistant",
        createdAt: "2026-03-12T10:00:01.000Z",
        content: "Older assistant"
      }),
      buildMessage({
        id: "current-user",
        role: "user",
        createdAt: "2026-03-12T10:01:00.000Z",
        content: "Current user"
      }),
      buildMessage({
        id: "current-tool",
        role: "tool",
        eventType: "tool_call",
        createdAt: "2026-03-12T10:01:01.000Z",
        content: "Tool: exec_command",
        toolCall: {
          name: "exec_command",
          input: "pwd",
          output: "/Users/demo/project",
          status: "completed"
        }
      }),
      ...Array.from({ length: 40 }, (_, index) =>
        buildMessage({
          id: `current-assistant-${index + 1}`,
          role: "assistant",
          createdAt: `2026-03-12T10:01:${String(index + 2).padStart(2, "0")}.000Z`,
          content: `Current assistant ${index + 1}`
        })
      )
    ];

    const session = buildSession(messages);
    const mounted = render(
      <ChatPanel
        session={session}
        messages={messages}
        costDisplay={DEFAULT_COST_DISPLAY}
        hydrationState={DEFAULT_HYDRATION_STATE}
      />
    );
    const mountedDomEntries = extractRenderedTranscriptDomEntries(mounted.container);
    const mountedSnapshot = buildRenderedTranscriptSnapshot({
      session,
      phase: "base-loaded",
      mode: "mounted-visible",
      messages,
      visibleWindow: deriveVisibleWindowSnapshotFromDom({
        messages,
        domEntries: mountedDomEntries
      }),
      domEntries: mountedDomEntries
    });

    mounted.unmount();

    const expandedWindow = buildExpandedVisibleWindow(messages);
    const expanded = render(
      <ChatPanel
        session={session}
        messages={messages}
        costDisplay={DEFAULT_COST_DISPLAY}
        hydrationState={DEFAULT_HYDRATION_STATE}
        windowOverride={expandedWindow}
      />
    );
    const expandedEntries = extractRenderedTranscriptDomEntries(expanded.container);

    expect(expandedEntries.map((entry) => entry.renderKey)).toEqual(
      expect.arrayContaining(mountedSnapshot.domEntries.map((entry) => entry.renderKey))
    );
    expect(
      expandedEntries
        .map((entry) => entry.renderKey)
        .slice(-mountedSnapshot.domEntries.length)
    ).toEqual(mountedSnapshot.domEntries.map((entry) => entry.renderKey));
  });

  it("reports an explicit mismatch artifact when the rendered order is scrambled", () => {
    const messages = [
      buildMessage({
        id: "user-1",
        role: "user",
        content: "First"
      }),
      buildMessage({
        id: "assistant-1",
        role: "assistant",
        createdAt: "2026-03-12T10:00:01.000Z",
        content: "Second"
      }),
      buildMessage({
        id: "tool-1",
        role: "tool",
        eventType: "tool_call",
        createdAt: "2026-03-12T10:00:02.000Z",
        content: "Tool: exec_command",
        toolCall: {
          name: "exec_command",
          input: "pwd",
          status: "completed"
        }
      })
    ];

    const storeEntries = toRenderedTranscriptStoreEntries(messages);
    const snapshot = buildRenderedTranscriptSnapshot({
      session: buildSession(messages),
      phase: "rollout-idle",
      mode: "expanded-full",
      messages,
      visibleWindow: buildVisibleWindowSnapshot({
        messages,
        visibleMessageCount: messages.length,
        anchorMessageKey: null
      }),
      domEntries: [
        {
          ...renderedEntryFromStore(storeEntries[1], 0)
        },
        {
          ...renderedEntryFromStore(storeEntries[0], 1)
        },
        {
          ...renderedEntryFromStore(storeEntries[2], 2)
        }
      ]
    });

    expect(snapshot.storeVsDom.firstMismatchIndex).toBe(0);
    expect(snapshot.storeVsDom.actualOrder).not.toEqual(snapshot.storeVsDom.expectedOrder);
  });
});

const renderedEntryFromStore = (
  entry: ReturnType<typeof toRenderedTranscriptStoreEntries>[number],
  domIndex: number
) => ({
  domIndex,
  renderKey: entry.renderKey,
  id: entry.id,
  role: entry.role,
  eventType: entry.eventType,
  label: entry.label,
  textPreview: entry.contentPreview,
  toolName: entry.toolName,
  toolStatus: entry.toolStatus
});
