import { z } from "zod";

/**
 * Forward-compatibility policy:
 * - Imported Tauri-derived data (`devices.json`, `search-index-v1.json`, search payloads)
 *   uses `.passthrough()` so new fields from older/newer producers do not block import.
 * - Electron-owned control files and renderer-visible error envelopes use `.strict()` to
 *   avoid silent contract drift.
 */

export const DEVICE_STORE_VERSION = 1 as const;
export const SEARCH_INDEX_STORE_VERSION = 1 as const;
export const PREFERENCES_STORE_VERSION = 1 as const;
export const MIGRATION_STATE_VERSION = 1 as const;
export const IPC_ERROR_ENVELOPE_VERSION = 1 as const;

export const deviceKindSchema = z.enum(["local", "ssh"]);
export type DeviceKind = z.infer<typeof deviceKindSchema>;

export const chatRoleSchema = z.enum(["user", "assistant", "system", "tool"]);
export type ChatRole = z.infer<typeof chatRoleSchema>;

export const themeModeSchema = z.enum(["light", "dark"]);
export type ThemeMode = z.infer<typeof themeModeSchema>;

export const themePreferenceSchema = themeModeSchema;
export type ThemePreference = z.infer<typeof themePreferenceSchema>;

export const themePreferenceStateSchema = z
  .object({
    preference: themePreferenceSchema,
    resolved: themeModeSchema
  })
  .strict();
export type ThemePreferenceState = z.infer<typeof themePreferenceStateSchema>;

export const deviceConnectionSchema = z
  .object({
    endpoint: z.string().min(1),
    transport: z.string().min(1),
    connectedAtMs: z.number().int().nonnegative(),
    localServerPid: z.number().int().positive().optional(),
    sshRemotePid: z.number().int().positive().optional(),
    sshForwardPid: z.number().int().positive().optional()
  })
  .passthrough();
export type DeviceConnectionRecord = z.infer<typeof deviceConnectionSchema>;

export const localDeviceConfigSchema = z
  .object({
    kind: z.literal("local"),
    appServerPort: z.number().int().positive().optional(),
    codexBin: z.string().min(1).optional(),
    workspaceRoot: z.string().min(1).optional()
  })
  .passthrough();
export type LocalDeviceConfigRecord = z.infer<typeof localDeviceConfigSchema>;

export const sshDeviceConfigSchema = z
  .object({
    kind: z.literal("ssh"),
    host: z.string().min(1),
    user: z.string().min(1),
    sshPort: z.number().int().positive(),
    identityFile: z.string().min(1).optional(),
    remoteAppServerPort: z.number().int().positive(),
    localForwardPort: z.number().int().positive().optional(),
    codexBin: z.string().min(1).optional(),
    workspaceRoot: z.string().min(1).optional()
  })
  .passthrough();
export type SshDeviceConfigRecord = z.infer<typeof sshDeviceConfigSchema>;

export const deviceConfigSchema = z.discriminatedUnion("kind", [
  localDeviceConfigSchema,
  sshDeviceConfigSchema
]);
export type DeviceConfigRecord = z.infer<typeof deviceConfigSchema>;

export const deviceRecordSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    config: deviceConfigSchema,
    connected: z.boolean(),
    connection: deviceConnectionSchema.nullish(),
    lastError: z.string().min(1).nullish()
  })
  .passthrough();
export type DeviceRecordSchemaType = z.infer<typeof deviceRecordSchema>;

export const deviceAddLocalRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    appServerPort: z.number().int().positive().optional(),
    codexBin: z.string().min(1).optional(),
    workspaceRoot: z.string().min(1).optional()
  })
  .strict();
export type DeviceAddLocalRequestRecord = z.infer<typeof deviceAddLocalRequestSchema>;

export const deviceAddSshRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    host: z.string().min(1),
    user: z.string().min(1),
    sshPort: z.number().int().positive().optional(),
    identityFile: z.string().min(1).optional(),
    remoteAppServerPort: z.number().int().positive().optional(),
    localForwardPort: z.number().int().positive().optional(),
    codexBin: z.string().min(1).optional(),
    workspaceRoot: z.string().min(1).optional()
  })
  .strict();
export type DeviceAddSshRequestRecord = z.infer<typeof deviceAddSshRequestSchema>;

export const deviceIdRequestSchema = z.object({
  deviceId: z.string().min(1)
});
export type DeviceIdRequestRecord = z.infer<typeof deviceIdRequestSchema>;

export const persistedDevicesSchema = z
  .object({
    version: z.literal(DEVICE_STORE_VERSION).optional(),
    devices: z.array(deviceRecordSchema)
  })
  .passthrough();
export type PersistedDevices = z.infer<typeof persistedDevicesSchema>;

export const searchIndexMessagePayloadSchema = z
  .object({
    id: z.string().min(1),
    role: chatRoleSchema,
    content: z.string(),
    createdAt: z.string().min(1)
  })
  .passthrough();
export type SearchIndexMessagePayloadRecord = z.infer<
  typeof searchIndexMessagePayloadSchema
>;

export const searchIndexThreadPayloadSchema = z
  .object({
    sessionKey: z.string().min(1),
    threadId: z.string().min(1),
    deviceId: z.string().min(1),
    sessionTitle: z.string(),
    deviceLabel: z.string(),
    deviceAddress: z.string(),
    updatedAt: z.string(),
    messages: z.array(searchIndexMessagePayloadSchema)
  })
  .passthrough();
export type SearchIndexThreadPayloadRecord = z.infer<
  typeof searchIndexThreadPayloadSchema
>;

export const persistedSearchMessageSchema = z
  .object({
    messageId: z.string().min(1),
    role: chatRoleSchema,
    content: z.string(),
    createdAt: z.string().min(1)
  })
  .passthrough();
export type PersistedSearchMessage = z.infer<typeof persistedSearchMessageSchema>;

export const persistedSearchSessionSchema = z
  .object({
    sessionKey: z.string().min(1),
    threadId: z.string().min(1),
    deviceId: z.string().min(1),
    sessionTitle: z.string(),
    deviceLabel: z.string(),
    deviceAddress: z.string(),
    updatedAt: z.string(),
    messages: z.array(persistedSearchMessageSchema)
  })
  .passthrough();
export type PersistedSearchSession = z.infer<typeof persistedSearchSessionSchema>;

export const persistedSearchIndexSchema = z
  .object({
    version: z.literal(SEARCH_INDEX_STORE_VERSION),
    lastUpdatedAtMs: z.number().int().nonnegative().optional(),
    sessions: z.array(persistedSearchSessionSchema)
  })
  .passthrough();
export type PersistedSearchIndex = z.infer<typeof persistedSearchIndexSchema>;

export const searchQueryRequestSchema = z
  .object({
    query: z.string(),
    deviceId: z.string().min(1).optional(),
    threshold: z.number().min(0).max(1).optional(),
    maxSessions: z.number().int().min(1).max(120).optional()
  })
  .passthrough();
export type SearchQueryRequestRecord = z.infer<typeof searchQueryRequestSchema>;

export const searchSessionHitSchema = z
  .object({
    sessionKey: z.string().min(1),
    threadId: z.string().min(1),
    deviceId: z.string().min(1),
    sessionTitle: z.string(),
    deviceLabel: z.string(),
    deviceAddress: z.string(),
    updatedAt: z.string(),
    maxScore: z.number(),
    hitCount: z.number().int().nonnegative()
  })
  .passthrough();
export type SearchSessionHitRecord = z.infer<typeof searchSessionHitSchema>;

export const searchQueryResponseSchema = z
  .object({
    query: z.string(),
    totalHits: z.number().int().nonnegative(),
    sessionHits: z.array(searchSessionHitSchema)
  })
  .passthrough();
export type SearchQueryResponseRecord = z.infer<typeof searchQueryResponseSchema>;

export const searchBootstrapStatusSchema = z
  .object({
    indexedSessions: z.number().int().nonnegative(),
    indexedMessages: z.number().int().nonnegative(),
    lastUpdatedAtMs: z.number().int().nonnegative().optional()
  })
  .passthrough();
export type SearchBootstrapStatusRecord = z.infer<
  typeof searchBootstrapStatusSchema
>;

export const preferencesSchema = z
  .object({
    version: z.literal(PREFERENCES_STORE_VERSION),
    themePreference: themePreferenceSchema
  })
  .strict();
export type AppPreferences = z.infer<typeof preferencesSchema>;

export const tauriImportStatusSchema = z.enum([
  "pending",
  "completed",
  "failed",
  "skipped"
]);
export type TauriImportStatus = z.infer<typeof tauriImportStatusSchema>;

export const migrationStateSchema = z
  .object({
    version: z.literal(MIGRATION_STATE_VERSION),
    tauriImport: z
      .object({
        status: tauriImportStatusSchema,
        lastAttemptedAt: z.string().min(1).optional(),
        completedAt: z.string().min(1).optional(),
        sourceRoot: z.string().min(1).optional(),
        importedDeviceCount: z.number().int().nonnegative().default(0),
        importedSearchSessionCount: z.number().int().nonnegative().default(0),
        errorCode: z.string().min(1).optional()
      })
      .strict()
  })
  .strict();
export type MigrationState = z.infer<typeof migrationStateSchema>;

export const ipcErrorEnvelopeSchema = z
  .object({
    version: z.literal(IPC_ERROR_ENVELOPE_VERSION),
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean().optional(),
    details: z.record(z.string(), z.string()).optional()
  })
  .strict();
export type IpcErrorEnvelope = z.infer<typeof ipcErrorEnvelopeSchema>;
