import { describe, expect, it, vi } from "vitest";
import { registerIpcHandlers } from "./registerIpc";
import { IPC_CHANNELS } from "./channels";

describe("registerIpcHandlers", () => {
  it("registers the expected allowlisted channels and validates payloads", async () => {
    const handlers = new Map<string, (_event: unknown, payload?: unknown) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (_event: unknown, payload?: unknown) => unknown) => {
        handlers.set(channel, handler);
      }
    };

    registerIpcHandlers({
      ipcMain,
      deviceService: {
        list: vi.fn(() => []),
        addLocal: vi.fn(async (payload) => ({ ...payload, id: "1", config: { kind: "local" }, connected: false })),
        addSsh: vi.fn(async (payload) => ({ ...payload, id: "2", config: { kind: "ssh" }, connected: false })),
        connect: vi.fn(async () => ({ id: "1", name: "Local Device", config: { kind: "local" }, connected: true })),
        disconnect: vi.fn(async () => ({ id: "1", name: "Local Device", config: { kind: "local" }, connected: false })),
        remove: vi.fn(async () => [])
      } as never,
      searchIndexService: {
        upsertThread: vi.fn(async () => undefined),
        removeDevice: vi.fn(async () => 0),
        query: vi.fn(() => ({ query: "hello", totalHits: 0, sessionHits: [] })),
        bootstrapStatus: vi.fn(() => ({ indexedSessions: 0, indexedMessages: 0 }))
      } as never,
      themeService: {
        getPreference: vi.fn(async () => ({ preference: "light", resolved: "light" })),
        setPreference: vi.fn(async () => ({ preference: "dark", resolved: "dark" }))
      } as never,
      diagnostics: {
        recordLifecycle: vi.fn(async () => undefined),
        recordFailure: vi.fn(async () => "ipc-timeout" as const),
        snapshotState: vi.fn(async () => undefined),
        isEnabled: vi.fn(() => true),
        getRunId: vi.fn(() => "run-1"),
        getFailureCategory: vi.fn(() => null)
      },
      getWindows: () => []
    });

    expect(handlers.has(IPC_CHANNELS.devicesAddLocal)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.searchQuery)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.diagnosticsRecordLifecycle)).toBe(true);

    await expect(
      handlers.get(IPC_CHANNELS.devicesConnect)?.({}, {})
    ).rejects.toThrow("ipc/handler-failed");
  });
});
