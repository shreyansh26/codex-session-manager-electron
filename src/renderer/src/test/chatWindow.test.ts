import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../domain/types";
import {
  getMessageWindowKey,
  resolveVisibleMessageWindow
} from "../components/chatWindow";

const buildMessage = (id: string, createdAt: string): ChatMessage => ({
  id,
  key: "device-1::thread-1",
  threadId: "thread-1",
  deviceId: "device-1",
  role: "assistant",
  content: id,
  createdAt
});

const buildRoleMessage = (
  id: string,
  createdAt: string,
  role: ChatMessage["role"],
  eventType?: ChatMessage["eventType"]
): ChatMessage => ({
  ...buildMessage(id, createdAt),
  role,
  ...(eventType ? { eventType } : {})
});

describe("resolveVisibleMessageWindow", () => {
  it("shows the latest tail when no anchor is present", () => {
    const messages = [
      buildMessage("m1", "2026-03-08T12:00:01.000Z"),
      buildMessage("m2", "2026-03-08T12:00:02.000Z"),
      buildMessage("m3", "2026-03-08T12:00:03.000Z")
    ];

    const window = resolveVisibleMessageWindow({
      messages,
      visibleMessageCount: 2,
      anchorMessageKey: null
    });

    expect(window.hiddenMessageCount).toBe(1);
    expect(window.visibleMessages.map((message) => message.id)).toEqual(["m2", "m3"]);
  });

  it("keeps an anchored visible message in view after the transcript is reordered", () => {
    const reorderedMessages = [
      buildMessage("older-1", "2026-03-08T12:00:01.000Z"),
      buildMessage("tool-1", "2026-03-08T12:00:02.000Z"),
      buildMessage("assistant-1", "2026-03-08T12:00:03.000Z"),
      buildMessage("assistant-2", "2026-03-08T12:00:04.000Z")
    ];

    const window = resolveVisibleMessageWindow({
      messages: reorderedMessages,
      visibleMessageCount: 2,
      anchorMessageKey: getMessageWindowKey(reorderedMessages[1])
    });

    expect(window.hiddenMessageCount).toBe(1);
    expect(window.visibleMessages.map((message) => message.id)).toEqual([
      "tool-1",
      "assistant-1",
      "assistant-2"
    ]);
  });

  it("falls back to the latest tail when the previous anchor disappeared", () => {
    const messages = [
      buildMessage("m1", "2026-03-08T12:00:01.000Z"),
      buildMessage("m2", "2026-03-08T12:00:02.000Z"),
      buildMessage("m3", "2026-03-08T12:00:03.000Z"),
      buildMessage("m4", "2026-03-08T12:00:04.000Z")
    ];

    const window = resolveVisibleMessageWindow({
      messages,
      visibleMessageCount: 2,
      anchorMessageKey: "missing-tool::tool::tool_call"
    });

    expect(window.hiddenMessageCount).toBe(2);
    expect(window.visibleMessages.map((message) => message.id)).toEqual(["m3", "m4"]);
  });

  it("expands older history when the anchor moves to an older visible message", () => {
    const messages = [
      buildMessage("m1", "2026-03-08T12:00:01.000Z"),
      buildMessage("m2", "2026-03-08T12:00:02.000Z"),
      buildMessage("m3", "2026-03-08T12:00:03.000Z"),
      buildMessage("m4", "2026-03-08T12:00:04.000Z"),
      buildMessage("m5", "2026-03-08T12:00:05.000Z")
    ];

    const initialWindow = resolveVisibleMessageWindow({
      messages,
      visibleMessageCount: 2,
      anchorMessageKey: null
    });
    const expandedWindow = resolveVisibleMessageWindow({
      messages,
      visibleMessageCount: 4,
      anchorMessageKey: getMessageWindowKey(messages[1])
    });

    expect(initialWindow.visibleMessages.map((message) => message.id)).toEqual(["m4", "m5"]);
    expect(expandedWindow.visibleMessages.map((message) => message.id)).toEqual([
      "m2",
      "m3",
      "m4",
      "m5"
    ]);
  });

  it("rewinds the latest tail to the user turn boundary so early tool calls in the current turn stay visible", () => {
    const olderMessages = Array.from({ length: 5 }, (_, index) =>
      buildRoleMessage(
        `older-${index + 1}`,
        `2026-03-08T12:00:0${index}.000Z`,
        index % 2 === 0 ? "user" : "assistant"
      )
    );
    const currentTurn = [
      buildRoleMessage("current-user", "2026-03-08T12:01:00.000Z", "user"),
      buildRoleMessage(
        "current-tool",
        "2026-03-08T12:01:01.000Z",
        "tool",
        "tool_call"
      ),
      ...Array.from({ length: 40 }, (_, index) =>
        buildRoleMessage(
          `current-assistant-${index + 1}`,
          `2026-03-08T12:01:${String(index + 2).padStart(2, "0")}.000Z`,
          "assistant"
        )
      )
    ];
    const messages = [...olderMessages, ...currentTurn];

    const window = resolveVisibleMessageWindow({
      messages,
      visibleMessageCount: 40,
      anchorMessageKey: null
    });

    expect(window.hiddenMessageCount).toBe(5);
    expect(window.visibleMessages[0]?.id).toBe("current-user");
    expect(window.visibleMessages.map((message) => message.id)).toContain("current-tool");
    expect(window.visibleMessages).toHaveLength(42);
  });
});
