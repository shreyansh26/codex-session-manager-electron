import type { ChatMessageEventType, ChatRole, ChatToolCallStatus } from "../domain/types";

type RpcNotification = Parameters<
  typeof import("../services/eventParser").parseRpcNotification
>[1];

export type ChronologyReplayStep =
  | {
      source: "live";
      label: string;
      notification: RpcNotification;
    }
  | {
      source: "thread_read";
      label: string;
      snapshot: Record<string, unknown>;
    }
  | {
      source: "rollout";
      label: string;
      records: Array<Record<string, unknown>>;
    };

export interface ExpectedToolBubble {
  id: string;
  name: string;
  inputIncludes?: string;
  outputIncludes?: string;
  status?: ChatToolCallStatus;
}

export interface ExpectedTranscriptEntry {
  id: string;
  role: ChatRole;
  eventType?: ChatMessageEventType;
  contentIncludes?: string;
}

export interface ChronologyReplayFixture {
  id: string;
  description: string;
  threadId: string;
  steps: ChronologyReplayStep[];
  expectedOrder: string[];
  expectedVisibleEntries: ExpectedTranscriptEntry[];
  expectedToolBubbles: ExpectedToolBubble[];
}

export interface ExistingSessionChronologyFixture {
  id: string;
  description: string;
  threadId: string;
  rolloutPath: string;
  staleRolloutPath: string;
  threadReadSnapshot: Record<string, unknown>;
  threadReadResult: {
    thread: Record<string, unknown>;
  };
  threadReadResultWithStalePath: {
    thread: Record<string, unknown>;
  };
  rolloutRecords: Array<Record<string, unknown>>;
  expectedLexicographicSnapshotOrder: string[];
  expectedNumericSnapshotOrder: string[];
  expectedCanonicalOrder: string[];
  expectedVisibleEntries: ExpectedTranscriptEntry[];
  expectedToolBubbles: ExpectedToolBubble[];
}

const messageCompleted = (params: {
  threadId: string;
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}): ChronologyReplayStep => ({
  source: "live",
  label: `message:${params.role}:${params.id}`,
  notification: {
    method: "message/completed",
    params: {
      threadId: params.threadId,
      message: {
        id: params.id,
        role: params.role,
        content: params.content,
        createdAt: params.createdAt
      }
    }
  }
});

const liveFunctionCall = (params: {
  threadId: string;
  timestamp: string;
  callId?: string;
  wrapperId?: string;
  turnId?: string;
  name: string;
  input?: string;
  argumentsJson?: Record<string, unknown>;
  createdAt?: string;
}): ChronologyReplayStep => ({
  source: "live",
  label: `tool-start:${params.callId ?? params.wrapperId ?? params.name}`,
  notification: {
    method: "codex/event",
    params: {
      threadId: params.threadId,
      timestamp: params.timestamp,
      msg: {
        ...(params.wrapperId ? { id: params.wrapperId } : {}),
        ...(params.turnId ? { turnId: params.turnId } : {}),
        createdAt: params.createdAt ?? params.timestamp,
        type: "response_item",
        payload: {
          type: "function_call",
          ...(params.callId ? { call_id: params.callId } : {}),
          ...(params.turnId ? { turn_id: params.turnId } : {}),
          name: params.name,
          ...(params.input ? { input: params.input } : {}),
          ...(params.argumentsJson ? { arguments: JSON.stringify(params.argumentsJson) } : {})
        }
      }
    }
  }
});

const liveFunctionCallOutput = (params: {
  threadId: string;
  timestamp: string;
  callId?: string;
  wrapperId?: string;
  turnId?: string;
  output?: string;
  status?: string;
  createdAt?: string;
}): ChronologyReplayStep => ({
  source: "live",
  label: `tool-output:${params.callId ?? params.wrapperId ?? "missing-call-id"}`,
  notification: {
    method: "codex/event",
    params: {
      threadId: params.threadId,
      timestamp: params.timestamp,
      msg: {
        ...(params.wrapperId ? { id: params.wrapperId } : {}),
        ...(params.turnId ? { turnId: params.turnId } : {}),
        createdAt: params.createdAt ?? params.timestamp,
        type: "response_item",
        payload: {
          type: "function_call_output",
          ...(params.callId ? { call_id: params.callId } : {}),
          ...(params.turnId ? { turn_id: params.turnId } : {}),
          ...(params.output ? { output: params.output } : {}),
          ...(params.status ? { status: params.status } : {})
        }
      }
    }
  }
});

const threadRead = (
  label: string,
  snapshot: Record<string, unknown>
): ChronologyReplayStep => ({
  source: "thread_read",
  label,
  snapshot: {
    createdAt: snapshot.createdAt ?? "2026-03-08T08:00:00.000Z",
    ...snapshot
  }
});

const rollout = (
  label: string,
  records: Array<Record<string, unknown>>
): ChronologyReplayStep => ({
  source: "rollout",
  label,
  records
});

export const chronologyReplayFixtures: ChronologyReplayFixture[] = [
  {
    id: "stale-assistant-after-tool",
    description:
      "A later assistant notification arrives with a stale createdAt and must stay below the already-rendered tool bubble.",
    threadId: "thread-stale-assistant-after-tool",
    steps: [
      messageCompleted({
        threadId: "thread-stale-assistant-after-tool",
        id: "user-live",
        role: "user",
        content: "Inspect the parser ordering",
        createdAt: "2026-03-08T08:09:59.994Z"
      }),
      liveFunctionCall({
        threadId: "thread-stale-assistant-after-tool",
        timestamp: "2026-03-08T08:10:20.498Z",
        callId: "call-live-1",
        name: "exec_command",
        argumentsJson: {
          cmd: "pwd"
        },
        createdAt: "2026-03-08T08:09:59.994Z"
      }),
      messageCompleted({
        threadId: "thread-stale-assistant-after-tool",
        id: "assistant-stale",
        role: "assistant",
        content: "Finished checking the parser.",
        createdAt: "2026-03-08T08:09:59.994Z"
      })
    ],
    expectedOrder: ["user:user-live", "tool:call-live-1", "assistant:assistant-stale"],
    expectedVisibleEntries: [
      { id: "user-live", role: "user", contentIncludes: "Inspect the parser ordering" },
      { id: "call-live-1", role: "tool", eventType: "tool_call" },
      {
        id: "assistant-stale",
        role: "assistant",
        contentIncludes: "Finished checking the parser."
      }
    ],
    expectedToolBubbles: [
      {
        id: "call-live-1",
        name: "exec_command",
        inputIncludes: "\"cmd\":\"pwd\""
      }
    ]
  },
  {
    id: "live-snapshot-rollout-tool-convergence",
    description:
      "The same tool call is seen as a live input, then a stale snapshot output, then rollout enrichment, and must converge into one visible bubble.",
    threadId: "thread-tool-convergence",
    steps: [
      messageCompleted({
        threadId: "thread-tool-convergence",
        id: "user-tool",
        role: "user",
        content: "Run pwd",
        createdAt: "2026-03-08T08:10:00.000Z"
      }),
      messageCompleted({
        threadId: "thread-tool-convergence",
        id: "assistant-tool",
        role: "assistant",
        content: "Running it now.",
        createdAt: "2026-03-08T08:10:00.400Z"
      }),
      liveFunctionCall({
        threadId: "thread-tool-convergence",
        timestamp: "2026-03-08T08:10:01.000Z",
        callId: "call-converge-1",
        name: "exec_command",
        argumentsJson: {
          cmd: "pwd"
        },
        createdAt: "2026-03-08T08:09:50.000Z"
      }),
      threadRead("snapshot-stale-output", {
        createdAt: "2026-03-08T08:09:50.000Z",
        updatedAt: "2026-03-08T08:10:03.000Z",
        turns: [
          {
            id: "turn-1",
            items: [
              {
                type: "userMessage",
                id: "user-tool",
                content: [{ type: "text", text: "Run pwd" }]
              },
              {
                type: "agentMessage",
                id: "assistant-tool",
                text: "Running it now.",
                phase: "commentary"
              },
              {
                type: "toolCall",
                id: "call-converge-1",
                callId: "call-converge-1",
                name: "exec_command",
                input: { cmd: "pwd" },
                output: "/Users/demo/project\n",
                status: "completed"
              }
            ]
          }
        ]
      }),
      rollout("rollout-output", [
        {
          id: "rollout-call-converge-1",
          type: "response_item",
          timestamp: "2026-03-08T08:10:03.100Z",
          payload: {
            type: "function_call_output",
            call_id: "call-converge-1",
            output:
              "Chunk ID: converge\nWall time: 0.01 seconds\nProcess exited with code 0\nOutput:\n/Users/demo/project\n"
          }
        }
      ])
    ],
    expectedOrder: [
      "user:user-tool",
      "assistant:assistant-tool",
      "tool:call-converge-1"
    ],
    expectedVisibleEntries: [
      { id: "user-tool", role: "user", contentIncludes: "Run pwd" },
      { id: "assistant-tool", role: "assistant", contentIncludes: "Running it now." },
      { id: "call-converge-1", role: "tool", eventType: "tool_call" }
    ],
    expectedToolBubbles: [
      {
        id: "call-converge-1",
        name: "exec_command",
        inputIncludes: "\"cmd\":\"pwd\"",
        outputIncludes: "Process exited with code 0",
        status: "completed"
      }
    ]
  },
  {
    id: "snapshot-with-missing-message-timestamps",
    description:
      "A snapshot without per-message timestamps must preserve interleaving and keep later live tool activity in place.",
    threadId: "thread-snapshot-missing-timestamps",
    steps: [
      threadRead("initial-snapshot", {
        createdAt: "2026-03-08T08:00:00.000Z",
        turns: [
          {
            createdAt: "2026-03-08T08:00:00.000Z",
            messages: [
              { id: "user-1", role: "user", content: "First prompt" },
              { id: "assistant-1", role: "assistant", content: "First answer" }
            ]
          },
          {
            createdAt: "2026-03-08T08:01:00.000Z",
            messages: [
              { id: "user-2", role: "user", content: "Second prompt" },
              { id: "assistant-2", role: "assistant", content: "Second answer" }
            ]
          }
        ]
      }),
      liveFunctionCall({
        threadId: "thread-snapshot-missing-timestamps",
        timestamp: "2026-03-08T08:01:30.000Z",
        callId: "call-missing-ts",
        name: "apply_patch",
        input: "*** Begin Patch\n*** End Patch\n",
        createdAt: "2026-03-08T08:00:00.000Z"
      }),
      messageCompleted({
        threadId: "thread-snapshot-missing-timestamps",
        id: "assistant-3",
        role: "assistant",
        content: "Patch applied, continuing.",
        createdAt: "2026-03-08T08:00:00.000Z"
      }),
      threadRead("refresh-snapshot", {
        createdAt: "2026-03-08T08:00:00.000Z",
        turns: [
          {
            createdAt: "2026-03-08T08:00:00.000Z",
            messages: [
              { id: "user-1", role: "user", content: "First prompt" },
              { id: "assistant-1", role: "assistant", content: "First answer" }
            ]
          },
          {
            createdAt: "2026-03-08T08:01:00.000Z",
            messages: [
              { id: "user-2", role: "user", content: "Second prompt" },
              { id: "assistant-2", role: "assistant", content: "Second answer" },
              { id: "assistant-3", role: "assistant", content: "Patch applied, continuing." }
            ]
          }
        ]
      })
    ],
    expectedOrder: [
      "user:user-1",
      "assistant:assistant-1",
      "user:user-2",
      "assistant:assistant-2",
      "tool:call-missing-ts",
      "assistant:assistant-3"
    ],
    expectedVisibleEntries: [
      { id: "user-1", role: "user", contentIncludes: "First prompt" },
      { id: "assistant-1", role: "assistant", contentIncludes: "First answer" },
      { id: "user-2", role: "user", contentIncludes: "Second prompt" },
      { id: "assistant-2", role: "assistant", contentIncludes: "Second answer" },
      { id: "call-missing-ts", role: "tool", eventType: "tool_call" },
      { id: "assistant-3", role: "assistant", contentIncludes: "Patch applied" }
    ],
    expectedToolBubbles: [
      {
        id: "call-missing-ts",
        name: "apply_patch",
        inputIncludes: "*** Begin Patch"
      }
    ]
  },
  {
    id: "output-before-call-record",
    description:
      "An output record arrives before its call/input record; the tool bubble must converge without creating a second orphaned history item.",
    threadId: "thread-output-before-call",
    steps: [
      messageCompleted({
        threadId: "thread-output-before-call",
        id: "user-out-first",
        role: "user",
        content: "Run pwd and show me the result.",
        createdAt: "2026-03-08T08:20:00.000Z"
      }),
      liveFunctionCallOutput({
        threadId: "thread-output-before-call",
        timestamp: "2026-03-08T08:20:10.000Z",
        callId: "call-out-first",
        output: "Process exited with code 0\nOutput:\n/Users/demo/project\n"
      }),
      liveFunctionCall({
        threadId: "thread-output-before-call",
        timestamp: "2026-03-08T08:20:09.000Z",
        callId: "call-out-first",
        name: "exec_command",
        argumentsJson: {
          cmd: "pwd"
        }
      })
    ],
    expectedOrder: ["user:user-out-first", "tool:call-out-first"],
    expectedVisibleEntries: [
      {
        id: "user-out-first",
        role: "user",
        contentIncludes: "Run pwd and show me the result."
      },
      { id: "call-out-first", role: "tool", eventType: "tool_call" }
    ],
    expectedToolBubbles: [
      {
        id: "call-out-first",
        name: "exec_command",
        inputIncludes: "\"cmd\":\"pwd\"",
        outputIncludes: "Process exited with code 0",
        status: "completed"
      }
    ]
  },
  {
    id: "equal-timestamps-timeline-order",
    description:
      "Equal timestamps must preserve batch order via timelineOrder rather than collapsing to an unstable sort.",
    threadId: "thread-equal-timestamps",
    steps: [
      threadRead("equal-ts-snapshot", {
        createdAt: "2026-03-08T09:00:00.000Z",
        turns: [
          {
            createdAt: "2026-03-08T09:00:00.000Z",
            messages: [
              { id: "user-equal", role: "user", content: "First" },
              { id: "assistant-equal", role: "assistant", content: "Second" },
              {
                id: "tool-equal",
                role: "tool",
                content: "Tool: exec_command\n\nInput:\npwd",
                eventType: "tool_call",
                toolCall: {
                  name: "exec_command",
                  input: "pwd",
                  status: "completed"
                }
              }
            ]
          }
        ]
      })
    ],
    expectedOrder: [
      "user:user-equal",
      "assistant:assistant-equal",
      "tool:tool-equal"
    ],
    expectedVisibleEntries: [
      { id: "user-equal", role: "user", contentIncludes: "First" },
      { id: "assistant-equal", role: "assistant", contentIncludes: "Second" },
      { id: "tool-equal", role: "tool", eventType: "tool_call" }
    ],
    expectedToolBubbles: [
      {
        id: "tool-equal",
        name: "exec_command",
        inputIncludes: "pwd",
        status: "completed"
      }
    ]
  },
  {
    id: "reused-call-id-across-turns",
    description:
      "The same upstream call_id reused across turns must not collapse two distinct tool bubbles.",
    threadId: "thread-reused-call-id",
    steps: [
      messageCompleted({
        threadId: "thread-reused-call-id",
        id: "user-turn-1",
        role: "user",
        content: "Run pwd once",
        createdAt: "2026-03-08T09:10:00.000Z"
      }),
      liveFunctionCall({
        threadId: "thread-reused-call-id",
        timestamp: "2026-03-08T09:10:01.000Z",
        callId: "call-reused",
        turnId: "turn-1",
        name: "exec_command",
        argumentsJson: { cmd: "pwd" }
      }),
      liveFunctionCallOutput({
        threadId: "thread-reused-call-id",
        timestamp: "2026-03-08T09:10:01.500Z",
        callId: "call-reused",
        turnId: "turn-1",
        output: "/Users/demo/project-1\n"
      }),
      messageCompleted({
        threadId: "thread-reused-call-id",
        id: "user-turn-2",
        role: "user",
        content: "Run pwd again",
        createdAt: "2026-03-08T09:11:00.000Z"
      }),
      liveFunctionCall({
        threadId: "thread-reused-call-id",
        timestamp: "2026-03-08T09:11:01.000Z",
        callId: "call-reused",
        turnId: "turn-2",
        name: "exec_command",
        argumentsJson: { cmd: "pwd" }
      }),
      liveFunctionCallOutput({
        threadId: "thread-reused-call-id",
        timestamp: "2026-03-08T09:11:01.500Z",
        callId: "call-reused",
        turnId: "turn-2",
        output: "/Users/demo/project-2\n"
      })
    ],
    expectedOrder: [
      "user:user-turn-1",
      "tool:call-reused",
      "user:user-turn-2",
      "tool:call-reused"
    ],
    expectedVisibleEntries: [
      { id: "user-turn-1", role: "user", contentIncludes: "Run pwd once" },
      { id: "call-reused", role: "tool", eventType: "tool_call" },
      { id: "user-turn-2", role: "user", contentIncludes: "Run pwd again" },
      { id: "call-reused", role: "tool", eventType: "tool_call" }
    ],
    expectedToolBubbles: [
      {
        id: "call-reused",
        name: "exec_command",
        inputIncludes: "\"cmd\":\"pwd\"",
        outputIncludes: "project-1",
        status: "completed"
      },
      {
        id: "call-reused",
        name: "exec_command",
        inputIncludes: "\"cmd\":\"pwd\"",
        outputIncludes: "project-2",
        status: "completed"
      }
    ]
  },
  {
    id: "reused-upstream-id-across-role-envelope",
    description:
      "The same upstream id reused across different roles or event envelopes must stay split into distinct visible entries.",
    threadId: "thread-reused-upstream-id",
    steps: [
      messageCompleted({
        threadId: "thread-reused-upstream-id",
        id: "shared-id",
        role: "assistant",
        content: "I will run pwd.",
        createdAt: "2026-03-08T09:20:00.000Z"
      }),
      {
        source: "live",
        label: "tool-with-shared-wrapper-id",
        notification: {
          method: "codex/event",
          params: {
            threadId: "thread-reused-upstream-id",
            timestamp: "2026-03-08T09:20:01.000Z",
            id: "shared-id",
            msg: {
              id: "shared-id",
              createdAt: "2026-03-08T09:20:01.000Z",
              type: "response_item",
              payload: {
                type: "function_call",
                name: "exec_command",
                arguments: JSON.stringify({ cmd: "pwd" }),
                call_id: "call-shared-id"
              }
            }
          }
        }
      }
    ],
    expectedOrder: ["assistant:shared-id", "tool:call-shared-id"],
    expectedVisibleEntries: [
      { id: "shared-id", role: "assistant", contentIncludes: "I will run pwd." },
      { id: "call-shared-id", role: "tool", eventType: "tool_call" }
    ],
    expectedToolBubbles: [
      {
        id: "call-shared-id",
        name: "exec_command",
        inputIncludes: "\"cmd\":\"pwd\""
      }
    ]
  },
  {
    id: "existing-session-flat-snapshot-lexicographic-drift",
    description:
      "Older CLI sessions can reopen through a lossy flat thread/read snapshot ordered lexicographically by item-* id while rollout history still contains the canonical chronology.",
    threadId: "thread-cli-reopen-lexicographic-items",
    steps: [
      threadRead("flat-thread-read-lexicographic", {
        createdAt: "2026-01-10T20:34:59.000Z",
        updatedAt: "2026-01-10T20:35:30.000Z",
        messages: [
          {
            id: "item-1",
            role: "user",
            content: "Draft a migration checklist for the timeline parser."
          },
          {
            id: "item-10",
            role: "assistant",
            content: "Starting with quick parser diagnostics."
          },
          {
            id: "item-11",
            role: "assistant",
            content: "Diagnostics captured. Continuing."
          },
          {
            id: "item-2",
            role: "assistant",
            content: "First, I will map message ordering."
          },
          {
            id: "item-3",
            role: "user",
            content: "Also include rollout recovery."
          }
        ]
      }),
      rollout("canonical-rollout-history", [
        {
          kind: "message",
          id: "item-1",
          role: "user",
          content: "Draft a migration checklist for the timeline parser.",
          createdAt: "2026-01-10T20:34:43.100Z",
          sourceType: "turn_message"
        },
        {
          kind: "message",
          id: "item-2",
          role: "assistant",
          content: "First, I will map message ordering.",
          createdAt: "2026-01-10T20:34:47.210Z",
          sourceType: "response_item"
        },
        {
          kind: "message",
          id: "item-3",
          role: "user",
          content: "Also include rollout recovery.",
          createdAt: "2026-01-10T20:34:50.904Z",
          sourceType: "turn_message"
        },
        {
          kind: "message",
          id: "item-10",
          role: "assistant",
          content: "Starting with quick parser diagnostics.",
          createdAt: "2026-01-10T20:35:11.022Z",
          sourceType: "response_item"
        },
        {
          kind: "message",
          id: "item-11",
          role: "assistant",
          content: "Diagnostics captured. Continuing.",
          createdAt: "2026-01-10T20:35:18.491Z",
          sourceType: "response_item"
        }
      ])
    ],
    expectedOrder: [
      "user:item-1",
      "assistant:item-2",
      "user:item-3",
      "assistant:item-10",
      "assistant:item-11"
    ],
    expectedVisibleEntries: [
      {
        id: "item-1",
        role: "user",
        contentIncludes: "Draft a migration checklist for the timeline parser."
      },
      {
        id: "item-2",
        role: "assistant",
        contentIncludes: "First, I will map message ordering."
      },
      {
        id: "item-3",
        role: "user",
        contentIncludes: "Also include rollout recovery."
      },
      {
        id: "item-10",
        role: "assistant",
        contentIncludes: "Starting with quick parser diagnostics."
      },
      {
        id: "item-11",
        role: "assistant",
        contentIncludes: "Diagnostics captured. Continuing."
      }
    ],
    expectedToolBubbles: []
  },
  {
    id: "stale-refresh-pulls-old-tool-upward",
    description:
      "A stale thread/read refresh must not pull an older tool bubble above a newer user or assistant turn.",
    threadId: "thread-stale-refresh",
    steps: [
      messageCompleted({
        threadId: "thread-stale-refresh",
        id: "user-a",
        role: "user",
        content: "Run pwd",
        createdAt: "2026-03-08T09:39:28.104Z"
      }),
      liveFunctionCall({
        threadId: "thread-stale-refresh",
        timestamp: "2026-03-08T09:39:28.747Z",
        callId: "call-tool-a",
        name: "exec_command",
        argumentsJson: {
          cmd: "pwd"
        }
      }),
      liveFunctionCallOutput({
        threadId: "thread-stale-refresh",
        timestamp: "2026-03-08T09:39:28.861Z",
        callId: "call-tool-a",
        output:
          "Chunk ID: stale-a\nWall time: 0.01 seconds\nProcess exited with code 0\nOutput:\n/Users/demo/project\n"
      }),
      messageCompleted({
        threadId: "thread-stale-refresh",
        id: "assistant-b",
        role: "assistant",
        content: "I am running the next command now.",
        createdAt: "2026-03-08T09:39:40.754Z"
      }),
      liveFunctionCall({
        threadId: "thread-stale-refresh",
        timestamp: "2026-03-08T09:39:40.842Z",
        callId: "call-tool-b",
        name: "exec_command",
        argumentsJson: {
          cmd: "ls src/state"
        }
      }),
      threadRead("stale-refresh", {
        createdAt: "2026-03-08T09:39:05.539Z",
        updatedAt: "2026-03-08T09:39:50.298Z",
        turns: [
          {
            id: "turn-1",
            items: [
              {
                type: "userMessage",
                id: "user-a",
                content: [{ type: "text", text: "Run pwd" }]
              },
              {
                type: "agentMessage",
                id: "assistant-b",
                text: "I am running the next command now.",
                phase: "commentary"
              }
            ]
          }
        ]
      })
    ],
    expectedOrder: [
      "user:user-a",
      "tool:call-tool-a",
      "assistant:assistant-b",
      "tool:call-tool-b"
    ],
    expectedVisibleEntries: [
      { id: "user-a", role: "user", contentIncludes: "Run pwd" },
      { id: "call-tool-a", role: "tool", eventType: "tool_call" },
      {
        id: "assistant-b",
        role: "assistant",
        contentIncludes: "I am running the next command now."
      },
      { id: "call-tool-b", role: "tool", eventType: "tool_call" }
    ],
    expectedToolBubbles: [
      {
        id: "call-tool-a",
        name: "exec_command",
        inputIncludes: "\"cmd\":\"pwd\"",
        outputIncludes: "Process exited with code 0",
        status: "completed"
      },
      {
        id: "call-tool-b",
        name: "exec_command",
        inputIncludes: "\"cmd\":\"ls src/state\""
      }
    ]
  },
  {
    id: "historical-cli-session-flat-item-order",
    description:
      "An older CLI-created session re-opened in the GUI can flatten into lexicographic top-level item-* history; recovered rollout chronology must restore the real transcript order.",
    threadId: "thread-historical-cli-session",
    steps: [
      threadRead("flat-thread-read-history", {
        createdAt: "2026-01-10T16:01:40.000Z",
        updatedAt: "2026-01-10T16:01:40.000Z",
        messages: [
          {
            id: "item-1",
            role: "user",
            content: "I want a GitHub Action that emails me when tracked repositories get new commits."
          },
          {
            id: "item-10",
            role: "assistant",
            content: "I can wire that up once the repo and notification config are settled."
          },
          {
            id: "item-11",
            role: "user",
            content: "Track main and develop, and make the config easy to extend."
          },
          {
            id: "item-2",
            role: "assistant",
            content: "I can help with that. I need to know which repositories and branches to watch."
          },
          {
            id: "item-3",
            role: "user",
            content: "Start with one repository for now, but keep it configurable."
          },
          {
            id: "item-4",
            role: "assistant",
            content: "Understood. I will scaffold the workflow and a repo configuration file."
          }
        ]
      }),
      rollout("canonical-rollout-history", [
        {
          kind: "message",
          id: "item-1",
          role: "user",
          content: "I want a GitHub Action that emails me when tracked repositories get new commits.",
          createdAt: "2026-01-10T15:06:13.810Z",
          order: 0
        },
        {
          kind: "message",
          id: "item-2",
          role: "assistant",
          content: "I can help with that. I need to know which repositories and branches to watch.",
          createdAt: "2026-01-10T15:06:20.500Z",
          order: 1
        },
        {
          kind: "message",
          id: "item-3",
          role: "user",
          content: "Start with one repository for now, but keep it configurable.",
          createdAt: "2026-01-10T15:06:35.000Z",
          order: 2
        },
        {
          kind: "message",
          id: "item-4",
          role: "assistant",
          content: "Understood. I will scaffold the workflow and a repo configuration file.",
          createdAt: "2026-01-10T15:06:42.000Z",
          order: 3
        },
        {
          kind: "message",
          id: "item-10",
          role: "assistant",
          content: "I can wire that up once the repo and notification config are settled.",
          createdAt: "2026-01-10T15:07:11.000Z",
          order: 4
        },
        {
          kind: "message",
          id: "item-11",
          role: "user",
          content: "Track main and develop, and make the config easy to extend.",
          createdAt: "2026-01-10T15:07:27.000Z",
          order: 5
        }
      ])
    ],
    expectedOrder: [
      "user:item-1",
      "assistant:item-2",
      "user:item-3",
      "assistant:item-4",
      "assistant:item-10",
      "user:item-11"
    ],
    expectedVisibleEntries: [
      {
        id: "item-1",
        role: "user",
        contentIncludes: "emails me when tracked repositories get new commits"
      },
      {
        id: "item-2",
        role: "assistant",
        contentIncludes: "which repositories and branches to watch"
      },
      {
        id: "item-3",
        role: "user",
        contentIncludes: "one repository for now"
      },
      {
        id: "item-4",
        role: "assistant",
        contentIncludes: "scaffold the workflow"
      },
      {
        id: "item-10",
        role: "assistant",
        contentIncludes: "notification config are settled"
      },
      {
        id: "item-11",
        role: "user",
        contentIncludes: "Track main and develop"
      }
    ],
    expectedToolBubbles: []
  }
];

export const chronologyReplayFixtureById = Object.fromEntries(
  chronologyReplayFixtures.map((fixture) => [fixture.id, fixture])
) as Record<string, ChronologyReplayFixture>;

export const existingSessionChronologyFixture: ExistingSessionChronologyFixture = {
  id: "existing-session-flat-snapshot-rollout-recovery",
  description:
    "A historical CLI session is reopened later from a lossy flat thread/read snapshot whose item-* ids are already lexicographically ordered and share one fallback timestamp.",
  threadId: "thread-existing-session-flat-snapshot",
  rolloutPath:
    "/Users/shreyansh/.codex/sessions/2026/01/10/rollout-2026-01-10T20-34-43-thread-existing-session-flat-snapshot.jsonl",
  staleRolloutPath:
    "/Users/shreyansh/Projects/codex-app-v2/.codex/sessions/2026/01/10/rollout-2026-01-10T20-34-43-thread-existing-session-flat-snapshot.jsonl",
  threadReadSnapshot: {
    id: "thread-existing-session-flat-snapshot",
    createdAt: "2026-01-10T16:01:40.000Z",
    updatedAt: "2026-01-10T16:12:55.000Z",
    messages: [
      {
        id: "item-1",
        role: "user",
        content:
          "Set up a GitHub Action that emails me whenever tracked repositories receive new commits."
      },
      {
        id: "item-10",
        role: "assistant",
        content:
          "I found the workflow syntax issue and corrected the invalid trigger configuration."
      },
      {
        id: "item-11",
        role: "assistant",
        content:
          "The repository now sends email notifications for configured branches and includes setup notes."
      },
      {
        id: "item-2",
        role: "assistant",
        content:
          "I’m inspecting the empty repository first, then I’ll scaffold the workflow and config files."
      },
      {
        id: "item-3",
        role: "user",
        content: "Track pushes on the main and release branches."
      },
      {
        id: "item-4",
        role: "assistant",
        content:
          "I added a tracked-repositories config file so the workflow knows which branches to watch."
      }
    ]
  },
  threadReadResult: {
    thread: {
      id: "thread-existing-session-flat-snapshot",
      title: "GitHub commit tracker automation",
      preview:
        "The repository now sends email notifications for configured branches and includes setup notes.",
      updatedAt: "2026-01-10T16:12:55.000Z",
      cwd: "/Users/shreyansh/Projects/track-project",
      model: "gpt-5.4",
      messages: [
        {
          id: "item-1",
          role: "user",
          content:
            "Set up a GitHub Action that emails me whenever tracked repositories receive new commits."
        },
        {
          id: "item-10",
          role: "assistant",
          content:
            "I found the workflow syntax issue and corrected the invalid trigger configuration."
        },
        {
          id: "item-11",
          role: "assistant",
          content:
            "The repository now sends email notifications for configured branches and includes setup notes."
        },
        {
          id: "item-2",
          role: "assistant",
          content:
            "I’m inspecting the empty repository first, then I’ll scaffold the workflow and config files."
        },
        {
          id: "item-3",
          role: "user",
          content: "Track pushes on the main and release branches."
        },
        {
          id: "item-4",
          role: "assistant",
          content:
            "I added a tracked-repositories config file so the workflow knows which branches to watch."
        }
      ]
    }
  },
  threadReadResultWithStalePath: {
    thread: {
      id: "thread-existing-session-flat-snapshot",
      title: "GitHub commit tracker automation",
      preview:
        "The repository now sends email notifications for configured branches and includes setup notes.",
      updatedAt: "2026-01-10T16:12:55.000Z",
      cwd: "/Users/shreyansh/Projects/track-project",
      model: "gpt-5.4",
      path:
        "/Users/shreyansh/Projects/codex-app-v2/.codex/sessions/2026/01/10/rollout-2026-01-10T20-34-43-thread-existing-session-flat-snapshot.jsonl",
      messages: [
        {
          id: "item-1",
          role: "user",
          content:
            "Set up a GitHub Action that emails me whenever tracked repositories receive new commits."
        },
        {
          id: "item-10",
          role: "assistant",
          content:
            "I found the workflow syntax issue and corrected the invalid trigger configuration."
        },
        {
          id: "item-11",
          role: "assistant",
          content:
            "The repository now sends email notifications for configured branches and includes setup notes."
        },
        {
          id: "item-2",
          role: "assistant",
          content:
            "I’m inspecting the empty repository first, then I’ll scaffold the workflow and config files."
        },
        {
          id: "item-3",
          role: "user",
          content: "Track pushes on the main and release branches."
        },
        {
          id: "item-4",
          role: "assistant",
          content:
            "I added a tracked-repositories config file so the workflow knows which branches to watch."
        }
      ]
    }
  },
  rolloutRecords: [
    {
      kind: "message",
      id: "message-1",
      role: "user",
      content:
        "Set up a GitHub Action that emails me whenever tracked repositories receive new commits.",
      createdAt: "2026-01-10T15:06:13.810Z",
      order: 0,
      sourceType: "event_msg"
    },
    {
      kind: "message",
      id: "message-2",
      role: "assistant",
      content:
        "I’m inspecting the empty repository first, then I’ll scaffold the workflow and config files.",
      createdAt: "2026-01-10T15:06:40.237Z",
      order: 1,
      sourceType: "response_item"
    },
    {
      kind: "message",
      id: "message-3",
      role: "user",
      content: "Track pushes on the main and release branches.",
      createdAt: "2026-01-10T15:07:01.905Z",
      order: 2,
      sourceType: "event_msg"
    },
    {
      kind: "message",
      id: "message-4",
      role: "assistant",
      content:
        "I added a tracked-repositories config file so the workflow knows which branches to watch.",
      createdAt: "2026-01-10T15:07:32.422Z",
      order: 3,
      sourceType: "response_item"
    },
    {
      kind: "message",
      id: "message-10",
      role: "assistant",
      content:
        "I found the workflow syntax issue and corrected the invalid trigger configuration.",
      createdAt: "2026-01-10T15:09:41.901Z",
      order: 4,
      sourceType: "response_item"
    },
    {
      kind: "message",
      id: "message-11",
      role: "assistant",
      content:
        "The repository now sends email notifications for configured branches and includes setup notes.",
      createdAt: "2026-01-10T15:10:18.044Z",
      order: 5,
      sourceType: "response_item"
    }
  ],
  expectedLexicographicSnapshotOrder: [
    "user:item-1",
    "assistant:item-10",
    "assistant:item-11",
    "assistant:item-2",
    "user:item-3",
    "assistant:item-4"
  ],
  expectedNumericSnapshotOrder: [
    "user:item-1",
    "assistant:item-2",
    "user:item-3",
    "assistant:item-4",
    "assistant:item-10",
    "assistant:item-11"
  ],
  expectedCanonicalOrder: [
    "user:message-1",
    "assistant:message-2",
    "user:message-3",
    "assistant:message-4",
    "assistant:message-10",
    "assistant:message-11"
  ],
  expectedVisibleEntries: [
    {
      id: "message-1",
      role: "user",
      contentIncludes: "emails me whenever tracked repositories receive new commits"
    },
    {
      id: "message-2",
      role: "assistant",
      contentIncludes: "inspecting the empty repository first"
    },
    {
      id: "message-3",
      role: "user",
      contentIncludes: "main and release branches"
    },
    {
      id: "message-4",
      role: "assistant",
      contentIncludes: "tracked-repositories config file"
    },
    {
      id: "message-10",
      role: "assistant",
      contentIncludes: "corrected the invalid trigger configuration"
    },
    {
      id: "message-11",
      role: "assistant",
      contentIncludes: "email notifications for configured branches"
    }
  ],
  expectedToolBubbles: []
};
