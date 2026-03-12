import { describe, expect, it } from "vitest";
import {
  ipcErrorEnvelopeSchema,
  migrationStateSchema,
  persistedDevicesSchema,
  persistedSearchIndexSchema,
  preferencesSchema,
  searchBootstrapStatusSchema,
  searchIndexThreadPayloadSchema,
  searchQueryRequestSchema
} from "./contracts";

describe("shared contracts", () => {
  it("accepts forward-compatible persisted devices payloads", () => {
    const parsed = persistedDevicesSchema.parse({
      devices: [
        {
          id: "local-1",
          name: "Local Device",
          config: {
            kind: "local",
            appServerPort: 45231,
            workspaceRoot: "/tmp/workspace"
          },
          connected: false,
          connection: null,
          lastError: null,
          extraField: "preserved"
        }
      ],
      importedFrom: "tauri"
    });

    expect(parsed.devices).toHaveLength(1);
    expect(parsed.devices[0].config.kind).toBe("local");
    expect((parsed.devices[0] as Record<string, unknown>).extraField).toBe("preserved");
  });

  it("accepts forward-compatible persisted search index payloads", () => {
    const parsed = persistedSearchIndexSchema.parse({
      version: 1,
      lastUpdatedAtMs: 123,
      sessions: [
        {
          sessionKey: "device::thread",
          threadId: "thread",
          deviceId: "device",
          sessionTitle: "Title",
          deviceLabel: "Device",
          deviceAddress: "local",
          updatedAt: "2026-03-12T00:00:00.000Z",
          messages: [
            {
              messageId: "msg-1",
              role: "user",
              content: "Hello",
              createdAt: "2026-03-12T00:00:00.000Z"
            }
          ],
          futureField: "ok"
        }
      ]
    });

    expect(parsed.sessions[0].messages[0].messageId).toBe("msg-1");
    expect((parsed.sessions[0] as Record<string, unknown>).futureField).toBe("ok");
  });

  it("rejects unexpected fields in preferences", () => {
    expect(() =>
      preferencesSchema.parse({
        version: 1,
        themePreference: "dark",
        extra: "nope"
      })
    ).toThrow();
  });

  it("accepts valid migration state and safe IPC errors", () => {
    const migrationState = migrationStateSchema.parse({
      version: 1,
      tauriImport: {
        status: "pending",
        lastAttemptedAt: "2026-03-12T00:00:00.000Z",
        importedDeviceCount: 0,
        importedSearchSessionCount: 0
      }
    });
    const errorEnvelope = ipcErrorEnvelopeSchema.parse({
      version: 1,
      code: "device/not-found",
      message: "Device not found",
      retryable: false,
      details: {
        deviceId: "local-1"
      }
    });

    expect(migrationState.tauriImport.status).toBe("pending");
    expect(errorEnvelope.code).toBe("device/not-found");
  });

  it("parses search payload and bootstrap contracts", () => {
    const searchPayload = searchIndexThreadPayloadSchema.parse({
      sessionKey: "device::thread",
      threadId: "thread",
      deviceId: "device",
      sessionTitle: "Session",
      deviceLabel: "Device",
      deviceAddress: "127.0.0.1",
      updatedAt: "2026-03-12T00:00:00.000Z",
      messages: [
        {
          id: "message-1",
          role: "assistant",
          content: "World",
          createdAt: "2026-03-12T00:00:00.000Z"
        }
      ]
    });
    const searchRequest = searchQueryRequestSchema.parse({
      query: "world",
      threshold: 0.9,
      maxSessions: 10
    });
    const bootstrapStatus = searchBootstrapStatusSchema.parse({
      indexedSessions: 1,
      indexedMessages: 2,
      lastUpdatedAtMs: 5
    });

    expect(searchPayload.messages[0].role).toBe("assistant");
    expect(searchRequest.maxSessions).toBe(10);
    expect(bootstrapStatus.indexedMessages).toBe(2);
  });
});
