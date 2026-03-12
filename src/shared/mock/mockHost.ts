import type { ChatMessageEventType, ChatToolCall } from "../../renderer/src/domain/types";

type MockRole = "user" | "assistant" | "system" | "tool";

interface MockMessage {
  id: string;
  role: MockRole;
  content: string;
  createdAt: string;
  eventType?: ChatMessageEventType;
  toolCall?: ChatToolCall;
}

interface MockThread {
  id: string;
  title: string;
  cwd: string;
  updatedAt: string;
  model: string;
  messages: MockMessage[];
}

interface MockState {
  kind: "local" | "ssh";
  accountAuthenticated: boolean;
  models: string[];
  directories: Record<string, string[]>;
  threads: MockThread[];
  threadCounter: number;
  turnCounter: number;
}

export const MOCK_CONNECTED_AT_MS = Date.UTC(2026, 2, 12, 9, 30, 0, 0);
const DEFAULT_MODEL = "gpt-5.4";
const DEFAULT_MODELS = ["gpt-5.4", "gpt-5.2", "gpt-5.1-codex-mini"];

const BASE_THREADS: Record<MockState["kind"], MockThread[]> = {
  local: [
    {
      id: "thread-mock-001",
      title: "Investigate blank renderer startup",
      cwd: "/Users/mock/workspace/codex-app-electron",
      updatedAt: "2026-03-12T09:30:00.000Z",
      model: DEFAULT_MODEL,
      messages: [
        {
          id: "msg-mock-001-user",
          role: "user",
          content: "Why is the Electron renderer blank on launch?",
          createdAt: "2026-03-12T09:28:00.000Z"
        },
        {
          id: "msg-mock-001-assistant",
          role: "assistant",
          content:
            "The renderer boot path is failing before first paint. Capture preload, console, and IPC milestones first.",
          createdAt: "2026-03-12T09:29:10.000Z"
        }
      ]
    },
    {
      id: "thread-mock-002",
      title: "Theme toggle follow-up",
      cwd: "/Users/mock/workspace/codex-app-electron",
      updatedAt: "2026-03-12T08:14:00.000Z",
      model: "gpt-5.2",
      messages: [
        {
          id: "msg-mock-002-user",
          role: "user",
          content: "Make the light and dark themes feel more intentional.",
          createdAt: "2026-03-12T08:10:00.000Z"
        },
        {
          id: "msg-mock-002-assistant",
          role: "assistant",
          content:
            "Use a brighter paper background in light mode and denser panel contrast in dark mode.",
          createdAt: "2026-03-12T08:12:25.000Z"
        }
      ]
    },
    {
      id: "thread-mock-003",
      title: "Tool chronology regression fixture",
      cwd: "/Users/mock/workspace/codex-app-electron",
      updatedAt: "2026-03-12T07:30:00.000Z",
      model: DEFAULT_MODEL,
      messages: [
        {
          id: "user-turn-1",
          role: "user",
          content: "Run pwd once",
          createdAt: "2026-03-08T09:10:00.000Z"
        },
        {
          id: "call-reused",
          role: "tool",
          eventType: "tool_call",
          content:
            "Tool: exec_command\n\nInput:\n{\"cmd\":\"pwd\"}\n\nOutput:\n/Users/demo/project-1",
          createdAt: "2026-03-08T09:10:01.000Z",
          toolCall: {
            name: "exec_command",
            input: "{\"cmd\":\"pwd\"}",
            output: "/Users/demo/project-1",
            status: "completed"
          }
        },
        {
          id: "user-turn-2",
          role: "user",
          content: "Run pwd again",
          createdAt: "2026-03-08T09:11:00.000Z"
        },
        {
          id: "call-reused",
          role: "tool",
          eventType: "tool_call",
          content:
            "Tool: exec_command\n\nInput:\n{\"cmd\":\"pwd\"}\n\nOutput:\n/Users/demo/project-2",
          createdAt: "2026-03-08T09:11:01.000Z",
          toolCall: {
            name: "exec_command",
            input: "{\"cmd\":\"pwd\"}",
            output: "/Users/demo/project-2",
            status: "completed"
          }
        }
      ]
    }
  ],
  ssh: [
    {
      id: "thread-ssh-001",
      title: "Remote smoke validation",
      cwd: "/srv/mock/codex-app-electron",
      updatedAt: "2026-03-12T07:00:00.000Z",
      model: DEFAULT_MODEL,
      messages: [
        {
          id: "msg-ssh-001-user",
          role: "user",
          content: "Check the remote app-server health.",
          createdAt: "2026-03-12T06:58:00.000Z"
        },
        {
          id: "msg-ssh-001-assistant",
          role: "assistant",
          content: "Remote mock health is stable. SSH forwarder metrics look clean.",
          createdAt: "2026-03-12T06:59:10.000Z"
        }
      ]
    }
  ]
};

const BASE_DIRECTORIES: Record<MockState["kind"], Record<string, string[]>> = {
  local: {
    "/Users/mock": ["workspace/"],
    "/Users/mock/workspace": ["codex-app-electron/", "docs/", "playgrounds/"],
    "/Users/mock/workspace/codex-app-electron": [
      "src/",
      "build/",
      "scripts/",
      ".git/",
      "README.md"
    ]
  },
  ssh: {
    "/srv": ["mock/"],
    "/srv/mock": ["codex-app-electron/"],
    "/srv/mock/codex-app-electron": ["src/", "logs/", "README.md"]
  }
};

const runtimeRegistry = new Map<string, MockRuntime>();

export interface MockRuntime {
  call: <T>(method: string, params?: unknown) => Promise<T>;
  subscribe: (handler: (notification: { method: string; params?: unknown }) => void) => () => void;
}

export const getMockRuntime = (endpoint: string): MockRuntime => {
  const existing = runtimeRegistry.get(endpoint);
  if (existing) {
    return existing;
  }
  const created = createMockRuntime(endpoint);
  runtimeRegistry.set(endpoint, created);
  return created;
};

export const resetMockRuntimeRegistry = (): void => {
  runtimeRegistry.clear();
};

export const isMockEndpoint = (endpoint: string): boolean => endpoint.startsWith("mock://");

export const createMockRuntime = (endpoint: string): MockRuntime => {
  const state = createInitialState(resolveEndpointKind(endpoint));
  const notificationHandlers = new Set<
    (notification: { method: string; params?: unknown }) => void
  >();

  const subscribe = (
    handler: (notification: { method: string; params?: unknown }) => void
  ): (() => void) => {
    notificationHandlers.add(handler);
    return () => {
      notificationHandlers.delete(handler);
    };
  };

  const emitNotification = (method: string, params?: unknown): void => {
    for (const handler of notificationHandlers) {
      handler({ method, params });
    }
  };

  return {
    subscribe,
    async call<T>(method: string, params?: unknown): Promise<T> {
      switch (method) {
        case "initialize":
        case "initialized":
          return {} as T;
        case "account/read":
          return { authenticated: state.accountAuthenticated } as T;
        case "model/list":
          return { models: [...state.models] } as T;
        case "thread/list":
          return {
            data: [...state.threads]
              .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
              .map(toThreadListRecord)
          } as T;
        case "thread/read": {
          const threadId = pickThreadId(params);
          const thread = requireThread(state, threadId);
          return {
            thread: {
              ...toThreadListRecord(thread),
              messages: thread.messages.map((message) => ({ ...message }))
            }
          } as T;
        }
        case "thread/resume": {
          const thread = requireThread(state, pickThreadId(params));
          return { threadId: thread.id, model: thread.model } as T;
        }
        case "thread/start": {
          const cwd = pickString(params, "cwd") ?? defaultCwd(state.kind);
          state.threadCounter += 1;
          const thread: MockThread = {
            id: `thread-mock-${String(state.threadCounter).padStart(3, "0")}`,
            title: "New mock session",
            cwd,
            updatedAt: timestampForCounter(state.threadCounter, 40),
            model: DEFAULT_MODEL,
            messages: []
          };
          state.threads = [thread, ...state.threads];
          emitNotification("thread/created", { threadId: thread.id });
          return {
            threadId: thread.id,
            cwd,
            model: thread.model,
            thread: toThreadListRecord(thread)
          } as T;
        }
        case "turn/start": {
          const thread = requireThread(state, pickThreadId(params));
          state.turnCounter += 1;
          const prompt = extractPrompt(params) ?? "Continue.";
          const userMessage: MockMessage = {
            id: `msg-${thread.id}-user-${String(state.turnCounter).padStart(3, "0")}`,
            role: "user",
            content: prompt,
            createdAt: timestampForCounter(state.turnCounter, 50)
          };
          const assistantMessage: MockMessage = {
            id: `msg-${thread.id}-assistant-${String(state.turnCounter).padStart(3, "0")}`,
            role: "assistant",
            content: `Mock response for: ${prompt}`,
            createdAt: timestampForCounter(state.turnCounter, 51)
          };
          thread.messages = [...thread.messages, userMessage, assistantMessage];
          thread.updatedAt = assistantMessage.createdAt;
          emitNotification("thread/updated", {
            threadId: thread.id,
            turnId: `turn-${String(state.turnCounter).padStart(3, "0")}`
          });
          return { turnId: `turn-${String(state.turnCounter).padStart(3, "0")}` } as T;
        }
        case "command/exec": {
          const command = pickCommand(params);
          const cwd = pickString(params, "cwd") ?? defaultCwd(state.kind);
          if (command.startsWith("ls ")) {
            const entries = state.directories[cwd] ?? [];
            return {
              exitCode: 0,
              stdout: `${entries.join("\n")}${entries.length > 0 ? "\n" : ""}`,
              stderr: ""
            } as T;
          }
          return {
            exitCode: 0,
            stdout: "",
            stderr: ""
          } as T;
        }
        default:
          throw new Error(`Unsupported mock RPC method: ${method}`);
      }
    }
  };
};

const createInitialState = (kind: MockState["kind"]): MockState => ({
  kind,
  accountAuthenticated: true,
  models: [...DEFAULT_MODELS],
  directories: structuredClone(BASE_DIRECTORIES[kind]),
  threads: structuredClone(BASE_THREADS[kind]),
  threadCounter: BASE_THREADS[kind].length,
  turnCounter: 0
});

const resolveEndpointKind = (endpoint: string): MockState["kind"] =>
  endpoint.includes("/ssh/") ? "ssh" : "local";

const toThreadListRecord = (thread: MockThread) => ({
  id: thread.id,
  title: thread.title,
  preview: thread.messages.at(-1)?.content ?? "",
  updatedAt: thread.updatedAt,
  cwd: thread.cwd,
  model: thread.model
});

const requireThread = (state: MockState, threadId: string): MockThread => {
  const thread = state.threads.find((entry) => entry.id === threadId);
  if (!thread) {
    throw new Error(`Unknown mock thread: ${threadId}`);
  }
  return thread;
};

const pickThreadId = (params: unknown): string => {
  const threadId =
    pickString(params, "threadId") ??
    pickString(params, "thread_id") ??
    pickString(params, "id");
  if (!threadId) {
    throw new Error("Mock RPC request is missing threadId.");
  }
  return threadId;
};

const pickString = (value: unknown, key: string): string | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
};

const pickCommand = (params: unknown): string => {
  if (!params || typeof params !== "object") {
    return "";
  }
  const command = (params as Record<string, unknown>).command;
  if (Array.isArray(command)) {
    return command.map((entry) => String(entry)).join(" ");
  }
  return typeof command === "string" ? command : "";
};

const extractPrompt = (params: unknown): string | null => {
  if (!params || typeof params !== "object") {
    return null;
  }

  const input = (params as Record<string, unknown>).input;
  return extractPromptFromValue(input);
};

const extractPromptFromValue = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractPromptFromValue(entry);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["text", "content"]) {
      const nested = extractPromptFromValue(record[key]);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
};

const defaultCwd = (kind: MockState["kind"]): string =>
  kind === "ssh"
    ? "/srv/mock/codex-app-electron"
    : "/Users/mock/workspace/codex-app-electron";

const timestampForCounter = (counter: number, offsetSeconds: number): string =>
  new Date(Date.UTC(2026, 2, 12, 10, 0, counter * 2 + offsetSeconds)).toISOString();

export const __TEST_ONLY__ = {
  BASE_THREADS,
  BASE_DIRECTORIES,
  extractPromptFromValue
};
