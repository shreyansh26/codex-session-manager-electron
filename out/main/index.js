import { nativeTheme, app, BrowserWindow, shell, ipcMain } from "electron";
import { dirname, join } from "node:path";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile, rename, unlink, copyFile, appendFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, createConnection } from "node:net";
import { setTimeout as setTimeout$1 } from "node:timers/promises";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const DEVICE_STORE_VERSION = 1;
const SEARCH_INDEX_STORE_VERSION = 1;
const PREFERENCES_STORE_VERSION = 1;
const MIGRATION_STATE_VERSION = 1;
const IPC_ERROR_ENVELOPE_VERSION = 1;
z.enum(["local", "ssh"]);
const chatRoleSchema = z.enum(["user", "assistant", "system", "tool"]);
const themeModeSchema = z.enum(["light", "dark"]);
const themePreferenceSchema = themeModeSchema;
const themePreferenceStateSchema = z.object({
  preference: themePreferenceSchema,
  resolved: themeModeSchema
}).strict();
const deviceConnectionSchema = z.object({
  endpoint: z.string().min(1),
  transport: z.string().min(1),
  connectedAtMs: z.number().int().nonnegative(),
  localServerPid: z.number().int().positive().optional(),
  sshRemotePid: z.number().int().positive().optional(),
  sshForwardPid: z.number().int().positive().optional()
}).passthrough();
const localDeviceConfigSchema = z.object({
  kind: z.literal("local"),
  appServerPort: z.number().int().positive().optional(),
  codexBin: z.string().min(1).optional(),
  workspaceRoot: z.string().min(1).optional()
}).passthrough();
const sshDeviceConfigSchema = z.object({
  kind: z.literal("ssh"),
  host: z.string().min(1),
  user: z.string().min(1),
  sshPort: z.number().int().positive(),
  identityFile: z.string().min(1).optional(),
  remoteAppServerPort: z.number().int().positive(),
  localForwardPort: z.number().int().positive().optional(),
  codexBin: z.string().min(1).optional(),
  workspaceRoot: z.string().min(1).optional()
}).passthrough();
const deviceConfigSchema = z.discriminatedUnion("kind", [
  localDeviceConfigSchema,
  sshDeviceConfigSchema
]);
const deviceRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  config: deviceConfigSchema,
  connected: z.boolean(),
  connection: deviceConnectionSchema.nullish(),
  lastError: z.string().min(1).nullish()
}).passthrough();
const deviceAddLocalRequestSchema = z.object({
  name: z.string().min(1).optional(),
  appServerPort: z.number().int().positive().optional(),
  codexBin: z.string().min(1).optional(),
  workspaceRoot: z.string().min(1).optional()
}).strict();
const deviceAddSshRequestSchema = z.object({
  name: z.string().min(1).optional(),
  host: z.string().min(1),
  user: z.string().min(1),
  sshPort: z.number().int().positive().optional(),
  identityFile: z.string().min(1).optional(),
  remoteAppServerPort: z.number().int().positive().optional(),
  localForwardPort: z.number().int().positive().optional(),
  codexBin: z.string().min(1).optional(),
  workspaceRoot: z.string().min(1).optional()
}).strict();
const deviceIdRequestSchema = z.object({
  deviceId: z.string().min(1)
});
const persistedDevicesSchema = z.object({
  version: z.literal(DEVICE_STORE_VERSION).optional(),
  devices: z.array(deviceRecordSchema)
}).passthrough();
const searchIndexMessagePayloadSchema = z.object({
  id: z.string().min(1),
  role: chatRoleSchema,
  content: z.string(),
  createdAt: z.string().min(1)
}).passthrough();
const searchIndexThreadPayloadSchema = z.object({
  sessionKey: z.string().min(1),
  threadId: z.string().min(1),
  deviceId: z.string().min(1),
  sessionTitle: z.string(),
  deviceLabel: z.string(),
  deviceAddress: z.string(),
  updatedAt: z.string(),
  messages: z.array(searchIndexMessagePayloadSchema)
}).passthrough();
const persistedSearchMessageSchema = z.object({
  messageId: z.string().min(1),
  role: chatRoleSchema,
  content: z.string(),
  createdAt: z.string().min(1)
}).passthrough();
const persistedSearchSessionSchema = z.object({
  sessionKey: z.string().min(1),
  threadId: z.string().min(1),
  deviceId: z.string().min(1),
  sessionTitle: z.string(),
  deviceLabel: z.string(),
  deviceAddress: z.string(),
  updatedAt: z.string(),
  messages: z.array(persistedSearchMessageSchema)
}).passthrough();
const persistedSearchIndexSchema = z.object({
  version: z.literal(SEARCH_INDEX_STORE_VERSION),
  lastUpdatedAtMs: z.number().int().nonnegative().optional(),
  sessions: z.array(persistedSearchSessionSchema)
}).passthrough();
const searchQueryRequestSchema = z.object({
  query: z.string(),
  deviceId: z.string().min(1).optional(),
  threshold: z.number().min(0).max(1).optional(),
  maxSessions: z.number().int().min(1).max(120).optional()
}).passthrough();
const searchSessionHitSchema = z.object({
  sessionKey: z.string().min(1),
  threadId: z.string().min(1),
  deviceId: z.string().min(1),
  sessionTitle: z.string(),
  deviceLabel: z.string(),
  deviceAddress: z.string(),
  updatedAt: z.string(),
  maxScore: z.number(),
  hitCount: z.number().int().nonnegative()
}).passthrough();
z.object({
  query: z.string(),
  totalHits: z.number().int().nonnegative(),
  sessionHits: z.array(searchSessionHitSchema)
}).passthrough();
z.object({
  indexedSessions: z.number().int().nonnegative(),
  indexedMessages: z.number().int().nonnegative(),
  lastUpdatedAtMs: z.number().int().nonnegative().optional()
}).passthrough();
const preferencesSchema = z.object({
  version: z.literal(PREFERENCES_STORE_VERSION),
  themePreference: themePreferenceSchema
}).strict();
const tauriImportStatusSchema = z.enum([
  "pending",
  "completed",
  "failed",
  "skipped"
]);
const migrationStateSchema = z.object({
  version: z.literal(MIGRATION_STATE_VERSION),
  tauriImport: z.object({
    status: tauriImportStatusSchema,
    lastAttemptedAt: z.string().min(1).optional(),
    completedAt: z.string().min(1).optional(),
    sourceRoot: z.string().min(1).optional(),
    importedDeviceCount: z.number().int().nonnegative().default(0),
    importedSearchSessionCount: z.number().int().nonnegative().default(0),
    errorCode: z.string().min(1).optional()
  }).strict()
}).strict();
const ipcErrorEnvelopeSchema = z.object({
  version: z.literal(IPC_ERROR_ENVELOPE_VERSION),
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean().optional(),
  details: z.record(z.string(), z.string()).optional()
}).strict();
const pathExists = async (filePath) => {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    return !isMissingFileError(error);
  }
};
const readJsonFile = async (filePath, schema) => {
  try {
    const raw = await readFile(filePath, "utf8");
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
};
const writeJsonFileAtomic = async (filePath, data) => {
  await writeFileAtomic(filePath, `${JSON.stringify(data, null, 2)}
`, "utf8");
};
const writeFileAtomic = async (filePath, data, encoding) => {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now().toString(36)}-${randomUUID()}`;
  try {
    if (typeof data === "string") {
      await writeFile(temporaryPath, data, encoding ?? "utf8");
    } else {
      await writeFile(temporaryPath, data);
    }
    await rename(temporaryPath, filePath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
    }
    throw error;
  }
};
const backupFileIfExists = async (filePath, backupPath) => {
  try {
    await copyFile(filePath, backupPath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
};
const isMissingFileError = (error) => error instanceof Error && "code" in error && error.code === "ENOENT";
const DEFAULT_THRESHOLD = 0.9;
const DEFAULT_MAX_SESSIONS = 10;
const MIN_FUZZY_QUERY_CHARS = 4;
const MAX_WINDOW_TOKEN_SCAN = 220;
const ALPHA_NUMERIC_CHARACTER = /[\p{L}\p{N}]/u;
const WHITESPACE_CHARACTER = /\s/u;
class SearchIndex {
  sessions = /* @__PURE__ */ new Map();
  indexedMessageCount = 0;
  lastUpdatedAtMs;
  nowMs;
  constructor(options = {}) {
    this.nowMs = options.nowMs ?? (() => Date.now());
  }
  static async loadFromPath(filePath, options = {}) {
    const persisted = await readJsonFile(filePath, persistedSearchIndexSchema);
    if (!persisted) {
      return new SearchIndex(options);
    }
    return SearchIndex.fromPersisted(persisted, options);
  }
  static fromPersisted(persisted, options = {}) {
    const parsed = persistedSearchIndexSchema.parse(persisted);
    const index = new SearchIndex(options);
    index.lastUpdatedAtMs = parsed.lastUpdatedAtMs;
    for (const persistedSession of parsed.sessions) {
      const messages = /* @__PURE__ */ new Map();
      for (const message of persistedSession.messages) {
        if (!message.messageId.trim()) {
          continue;
        }
        const normalized = normalizeForSearch(message.content);
        const tokens = tokenize(normalized);
        messages.set(message.messageId, {
          messageId: message.messageId,
          role: message.role,
          content: message.content,
          contentNormalized: normalized,
          tokens,
          tokenSet: new Set(tokens),
          createdAt: message.createdAt
        });
      }
      index.indexedMessageCount += messages.size;
      index.sessions.set(persistedSession.sessionKey, {
        sessionKey: persistedSession.sessionKey,
        threadId: persistedSession.threadId,
        deviceId: persistedSession.deviceId,
        sessionTitle: persistedSession.sessionTitle,
        deviceLabel: persistedSession.deviceLabel,
        deviceAddress: persistedSession.deviceAddress,
        updatedAt: persistedSession.updatedAt,
        messages
      });
    }
    return index;
  }
  async persistToPath(filePath) {
    await writeJsonFileAtomic(filePath, this.toPersisted());
  }
  upsertThread(payload) {
    if (!payload.sessionKey.trim()) {
      return;
    }
    const previousCount = this.sessions.get(payload.sessionKey)?.messages.size ?? 0;
    const messages = /* @__PURE__ */ new Map();
    for (const message of payload.messages) {
      if (!message.id.trim()) {
        continue;
      }
      const normalized = normalizeForSearch(message.content);
      const tokens = tokenize(normalized);
      messages.set(message.id, {
        messageId: message.id,
        role: message.role,
        content: message.content,
        contentNormalized: normalized,
        tokens,
        tokenSet: new Set(tokens),
        createdAt: message.createdAt
      });
    }
    this.indexedMessageCount = Math.max(0, this.indexedMessageCount - previousCount);
    this.indexedMessageCount += messages.size;
    this.sessions.set(payload.sessionKey, {
      sessionKey: payload.sessionKey,
      threadId: payload.threadId,
      deviceId: payload.deviceId,
      sessionTitle: payload.sessionTitle,
      deviceLabel: payload.deviceLabel,
      deviceAddress: payload.deviceAddress,
      updatedAt: payload.updatedAt,
      messages
    });
    this.lastUpdatedAtMs = this.nowMs();
  }
  removeDevice(deviceId) {
    const keysToRemove = [];
    for (const [sessionKey, session] of this.sessions) {
      if (session.deviceId === deviceId) {
        keysToRemove.push(sessionKey);
      }
    }
    let removedSessions = 0;
    for (const sessionKey of keysToRemove) {
      const removed = this.sessions.get(sessionKey);
      if (!removed) {
        continue;
      }
      this.sessions.delete(sessionKey);
      this.indexedMessageCount = Math.max(
        0,
        this.indexedMessageCount - removed.messages.size
      );
      removedSessions += 1;
    }
    if (removedSessions > 0) {
      this.lastUpdatedAtMs = this.nowMs();
    }
    return removedSessions;
  }
  query(request) {
    const trimmedQuery = request.query.trim();
    if (!trimmedQuery) {
      return {
        query: trimmedQuery,
        totalHits: 0,
        sessionHits: []
      };
    }
    const normalizedQuery = normalizeForSearch(trimmedQuery);
    if (!normalizedQuery) {
      return {
        query: trimmedQuery,
        totalHits: 0,
        sessionHits: []
      };
    }
    const queryTokens = tokenize(normalizedQuery);
    const queryTokenSet = new Set(queryTokens);
    const threshold = clamp(request.threshold ?? DEFAULT_THRESHOLD, 0, 1);
    const maxSessions = clampInteger(request.maxSessions ?? DEFAULT_MAX_SESSIONS, 1, 120);
    const shortQuery = Array.from(normalizedQuery).length < MIN_FUZZY_QUERY_CHARS;
    const groupedHits = /* @__PURE__ */ new Map();
    let totalHits = 0;
    for (const session of this.sessions.values()) {
      if (request.deviceId && session.deviceId !== request.deviceId) {
        continue;
      }
      for (const message of session.messages.values()) {
        const score = scoreMessage({
          normalizedQuery,
          queryTokenSet,
          queryTokenCount: queryTokens.length,
          shortQuery,
          message,
          threshold
        });
        if (score === null) {
          continue;
        }
        totalHits += 1;
        const existingGroup = groupedHits.get(session.sessionKey);
        if (existingGroup) {
          existingGroup.maxScore = Math.max(existingGroup.maxScore, score);
          existingGroup.hitCount += 1;
          continue;
        }
        groupedHits.set(session.sessionKey, {
          sessionKey: session.sessionKey,
          threadId: session.threadId,
          deviceId: session.deviceId,
          sessionTitle: session.sessionTitle,
          deviceLabel: session.deviceLabel,
          deviceAddress: session.deviceAddress,
          updatedAt: session.updatedAt,
          maxScore: score,
          hitCount: 1
        });
      }
    }
    const sessionHits = [...groupedHits.values()];
    sessionHits.sort((left, right) => {
      if (right.maxScore !== left.maxScore) {
        return right.maxScore - left.maxScore;
      }
      if (right.hitCount !== left.hitCount) {
        return right.hitCount - left.hitCount;
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    });
    return {
      query: trimmedQuery,
      totalHits,
      sessionHits: sessionHits.slice(0, maxSessions)
    };
  }
  bootstrapStatus() {
    return {
      indexedSessions: this.sessions.size,
      indexedMessages: this.indexedMessageCount,
      ...this.lastUpdatedAtMs !== void 0 ? { lastUpdatedAtMs: this.lastUpdatedAtMs } : {}
    };
  }
  toPersisted() {
    const sessions = [...this.sessions.values()].sort(
      (left, right) => left.sessionKey.localeCompare(right.sessionKey) || left.threadId.localeCompare(right.threadId)
    ).map((session) => ({
      sessionKey: session.sessionKey,
      threadId: session.threadId,
      deviceId: session.deviceId,
      sessionTitle: session.sessionTitle,
      deviceLabel: session.deviceLabel,
      deviceAddress: session.deviceAddress,
      updatedAt: session.updatedAt,
      messages: [...session.messages.values()].sort(
        (left, right) => left.createdAt.localeCompare(right.createdAt) || left.messageId.localeCompare(right.messageId)
      ).map((message) => ({
        messageId: message.messageId,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt
      }))
    }));
    return persistedSearchIndexSchema.parse({
      version: SEARCH_INDEX_STORE_VERSION,
      ...this.lastUpdatedAtMs !== void 0 ? { lastUpdatedAtMs: this.lastUpdatedAtMs } : {},
      sessions
    });
  }
}
const normalizeForSearch = (value) => {
  let normalized = "";
  for (const character of value) {
    if (ALPHA_NUMERIC_CHARACTER.test(character)) {
      normalized += character.toLowerCase();
      continue;
    }
    if (WHITESPACE_CHARACTER.test(character)) {
      normalized += " ";
    }
  }
  return normalized.split(/\s+/).filter(Boolean).join(" ");
};
const tokenize = (value) => value.split(/\s+/).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
const minTokenOverlap = (queryTokenCount) => {
  if (queryTokenCount <= 1) {
    return 1;
  }
  if (queryTokenCount <= 3) {
    return 2;
  }
  return Math.floor((queryTokenCount * 60 + 99) / 100);
};
const scoreMessage = ({
  normalizedQuery,
  queryTokenSet,
  queryTokenCount,
  shortQuery,
  message,
  threshold
}) => {
  if (!normalizedQuery || !message.contentNormalized) {
    return null;
  }
  const contains = message.contentNormalized.includes(normalizedQuery);
  if (shortQuery && !contains) {
    return null;
  }
  if (!contains) {
    let overlap = 0;
    for (const token of queryTokenSet) {
      if (message.tokenSet.has(token)) {
        overlap += 1;
      }
    }
    if (overlap < minTokenOverlap(queryTokenCount)) {
      return null;
    }
  }
  let score = contains ? 1 : normalizedLevenshtein(normalizedQuery, message.contentNormalized);
  if (!contains) {
    score = Math.max(
      score,
      bestWindowSimilarity(normalizedQuery, queryTokenCount, message.tokens)
    );
  }
  return score >= threshold ? score : null;
};
const bestWindowSimilarity = (normalizedQuery, queryTokenCount, messageTokens) => {
  if (messageTokens.length === 0) {
    return 0;
  }
  const tokenScanLimit = Math.min(messageTokens.length, MAX_WINDOW_TOKEN_SCAN);
  if (tokenScanLimit === 0) {
    return 0;
  }
  const targetTokens = Math.max(queryTokenCount, 1);
  const minWindow = Math.max(targetTokens - 1, 1);
  const maxWindow = Math.min(targetTokens + 2, tokenScanLimit);
  let best = 0;
  for (let windowSize = minWindow; windowSize <= maxWindow; windowSize += 1) {
    if (windowSize > tokenScanLimit) {
      break;
    }
    for (let start = 0; start <= tokenScanLimit - windowSize; start += 1) {
      const candidate = messageTokens.slice(start, start + windowSize).join(" ");
      const score = normalizedLevenshtein(normalizedQuery, candidate);
      if (score > best) {
        best = score;
        if (best >= 0.999) {
          return best;
        }
      }
    }
  }
  return best;
};
const normalizedLevenshtein = (left, right) => {
  if (left === right) {
    return 1;
  }
  const leftChars = Array.from(left);
  const rightChars = Array.from(right);
  const maxLength = Math.max(leftChars.length, rightChars.length);
  if (maxLength === 0) {
    return 1;
  }
  if (leftChars.length === 0 || rightChars.length === 0) {
    return 0;
  }
  const distance = levenshteinDistance(leftChars, rightChars);
  return 1 - distance / maxLength;
};
const levenshteinDistance = (left, right) => {
  const previous = new Array(right.length + 1);
  const current = new Array(right.length + 1);
  for (let column = 0; column <= right.length; column += 1) {
    previous[column] = column;
  }
  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + substitutionCost
      );
    }
    for (let column = 0; column <= right.length; column += 1) {
      previous[column] = current[column];
    }
  }
  return previous[right.length];
};
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const clampInteger = (value, min, max) => Math.trunc(clamp(value, min, max));
class SearchIndexService {
  constructor(searchIndexPath, index) {
    this.searchIndexPath = searchIndexPath;
    this.index = index;
  }
  static async create(options) {
    const index = await SearchIndex.loadFromPath(options.searchIndexPath, {
      nowMs: options.nowMs
    });
    return new SearchIndexService(options.searchIndexPath, index);
  }
  async upsertThread(payload) {
    const parsed = searchIndexThreadPayloadSchema.parse(payload);
    this.index.upsertThread(parsed);
    await this.index.persistToPath(this.searchIndexPath);
  }
  async removeDevice(deviceId) {
    const removedSessions = this.index.removeDevice(deviceId);
    if (removedSessions === 0) {
      return removedSessions;
    }
    await this.index.persistToPath(this.searchIndexPath);
    return removedSessions;
  }
  query(request) {
    const parsed = searchQueryRequestSchema.parse(request);
    return this.index.query(parsed);
  }
  bootstrapStatus() {
    return this.index.bootstrapStatus();
  }
}
const TAURI_STATE_DIRECTORY = "codex-session-monitor";
const uniquePaths = (paths) => {
  const result = [];
  for (const candidate of paths) {
    if (!candidate) {
      continue;
    }
    if (!result.includes(candidate)) {
      result.push(candidate);
    }
  }
  return result;
};
const getElectronStatePaths = (userDataDir) => ({
  rootDir: userDataDir,
  devicesPath: join(userDataDir, "devices.json"),
  searchIndexPath: join(userDataDir, "search-index-v1.json"),
  preferencesPath: join(userDataDir, "preferences.json"),
  migrationStatePath: join(userDataDir, "migration-state.json"),
  logDir: join(userDataDir, "logs")
});
const resolveTauriCandidateRoots = (options = {}) => {
  const home = options.homeDir ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  return uniquePaths([
    options.dataLocalDir ? join(options.dataLocalDir, TAURI_STATE_DIRECTORY) : null,
    home ? join(home, TAURI_STATE_DIRECTORY) : null,
    cwd ? join(cwd, TAURI_STATE_DIRECTORY) : null
  ]);
};
const resolveTauriDevicesPath = (rootDir) => join(rootDir, "devices.json");
const resolveTauriSearchIndexPath = (rootDir) => join(rootDir, "search-index-v1.json");
const resolveBackupPath = (filePath, suffix) => {
  const dir = dirname(filePath);
  const fileName = filePath.split("/").at(-1) ?? "state.json";
  return join(dir, `${fileName}.${suffix}.bak`);
};
const noopLogger = {
  warn: () => void 0,
  info: () => void 0
};
const importTauriState = async (options) => {
  const logger = options.logger ?? noopLogger;
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  const electronPaths = getElectronStatePaths(options.electronUserDataDir);
  const existingMigrationState = await safeReadMigrationState(
    electronPaths.migrationStatePath,
    logger
  );
  if (existingMigrationState && (existingMigrationState.tauriImport.status === "completed" || existingMigrationState.tauriImport.status === "skipped")) {
    return toImportResult(existingMigrationState);
  }
  const alreadyInitialized = await hasExistingElectronState(electronPaths);
  if (alreadyInitialized && !existingMigrationState) {
    const skippedState = buildMigrationState({
      status: "skipped",
      now,
      errorCode: "already-initialized"
    });
    await writeJsonFileAtomic(electronPaths.migrationStatePath, skippedState);
    return toImportResult(skippedState);
  }
  const sourceRoot = await findTauriSourceRoot(options);
  if (!sourceRoot) {
    const skippedState = buildMigrationState({
      status: "skipped",
      now,
      errorCode: "tauri-source-missing"
    });
    await writeJsonFileAtomic(electronPaths.migrationStatePath, skippedState);
    return toImportResult(skippedState);
  }
  const pendingState = buildMigrationState({
    status: "pending",
    now,
    sourceRoot
  });
  await writeJsonFileAtomic(electronPaths.migrationStatePath, pendingState);
  const warnings = [];
  const importedDevices = await safeReadPersistedDevices(
    resolveTauriDevicesPath(sourceRoot),
    warnings,
    logger
  );
  const importedSearchIndex = await safeReadPersistedSearchIndex(
    resolveTauriSearchIndexPath(sourceRoot),
    warnings,
    logger
  );
  let importedDeviceCount = 0;
  let importedSearchSessionCount = 0;
  try {
    if (importedDevices) {
      const sanitizedDevices = sanitizePersistedDevices(importedDevices);
      await maybeBackupTarget(electronPaths.devicesPath, now);
      await writeJsonFileAtomic(electronPaths.devicesPath, sanitizedDevices);
      importedDeviceCount = sanitizedDevices.devices.length;
    }
    if (importedSearchIndex) {
      await maybeBackupTarget(electronPaths.searchIndexPath, now);
      await writeJsonFileAtomic(electronPaths.searchIndexPath, importedSearchIndex);
      importedSearchSessionCount = importedSearchIndex.sessions.length;
    }
  } catch (error) {
    const failureState = buildMigrationState({
      status: "failed",
      now,
      sourceRoot,
      importedDeviceCount,
      importedSearchSessionCount,
      errorCode: toErrorCode(error)
    });
    await writeJsonFileAtomic(electronPaths.migrationStatePath, failureState);
    logger.warn("Failed to import Tauri state", {
      sourceRoot,
      error: formatError(error)
    });
    return {
      ...toImportResult(failureState),
      warnings
    };
  }
  const status = importedDeviceCount > 0 || importedSearchSessionCount > 0 ? "completed" : "failed";
  const state = buildMigrationState({
    status,
    now,
    sourceRoot,
    importedDeviceCount,
    importedSearchSessionCount,
    errorCode: status === "failed" ? "tauri-source-invalid" : void 0
  });
  await writeJsonFileAtomic(electronPaths.migrationStatePath, state);
  if (status === "failed") {
    logger.warn("No valid Tauri state could be imported", {
      sourceRoot,
      warnings
    });
  } else {
    logger.info("Imported Tauri state into Electron store", {
      sourceRoot,
      importedDeviceCount,
      importedSearchSessionCount
    });
  }
  return {
    ...toImportResult(state),
    warnings
  };
};
const safeReadMigrationState = async (filePath, logger) => {
  try {
    return await readJsonFile(filePath, migrationStateSchema);
  } catch (error) {
    logger.warn("Ignoring invalid Electron migration state", {
      filePath,
      error: formatError(error)
    });
    return null;
  }
};
const hasExistingElectronState = async (electronPaths) => {
  const existing = await Promise.all([
    pathExists(electronPaths.devicesPath),
    pathExists(electronPaths.searchIndexPath),
    pathExists(electronPaths.preferencesPath),
    pathExists(electronPaths.migrationStatePath)
  ]);
  return existing.some(Boolean);
};
const findTauriSourceRoot = async (options) => {
  for (const candidateRoot of resolveTauriCandidateRoots(options)) {
    const [hasDevices, hasSearchIndex] = await Promise.all([
      pathExists(resolveTauriDevicesPath(candidateRoot)),
      pathExists(resolveTauriSearchIndexPath(candidateRoot))
    ]);
    if (hasDevices || hasSearchIndex) {
      return candidateRoot;
    }
  }
  return null;
};
const safeReadPersistedDevices = async (filePath, warnings, logger) => {
  try {
    return await readJsonFile(filePath, persistedDevicesSchema);
  } catch (error) {
    const warning = `Invalid Tauri devices payload at ${filePath}`;
    warnings.push(warning);
    logger.warn(warning, {
      error: formatError(error)
    });
    return null;
  }
};
const safeReadPersistedSearchIndex = async (filePath, warnings, logger) => {
  try {
    return await readJsonFile(filePath, persistedSearchIndexSchema);
  } catch (error) {
    const warning = `Invalid Tauri search index payload at ${filePath}`;
    warnings.push(warning);
    logger.warn(warning, {
      error: formatError(error)
    });
    return null;
  }
};
const sanitizePersistedDevices = (persistedDevices) => ({
  ...persistedDevices,
  devices: [...persistedDevices.devices].map((device) => sanitizeImportedDevice(device)).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
});
const sanitizeImportedDevice = (device) => ({
  ...device,
  connected: false,
  connection: null,
  lastError: null
});
const maybeBackupTarget = async (filePath, now) => {
  if (!await pathExists(filePath)) {
    return;
  }
  const suffix = now().toISOString().replaceAll(":", "-");
  await backupFileIfExists(filePath, resolveBackupPath(filePath, suffix));
};
const buildMigrationState = ({
  status,
  now,
  sourceRoot,
  importedDeviceCount = 0,
  importedSearchSessionCount = 0,
  errorCode
}) => migrationStateSchema.parse({
  version: 1,
  tauriImport: {
    status,
    lastAttemptedAt: now().toISOString(),
    ...status === "completed" ? { completedAt: now().toISOString() } : {},
    ...sourceRoot ? { sourceRoot } : {},
    importedDeviceCount,
    importedSearchSessionCount,
    ...errorCode ? { errorCode } : {}
  }
});
const toImportResult = (state) => ({
  status: state.tauriImport.status,
  sourceRoot: state.tauriImport.sourceRoot,
  importedDeviceCount: state.tauriImport.importedDeviceCount,
  importedSearchSessionCount: state.tauriImport.importedSearchSessionCount,
  warnings: []
});
const formatError = (error) => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};
const toErrorCode = (error) => {
  if (error instanceof Error && "code" in error) {
    return String(error.code ?? "unknown");
  }
  if (isZodError(error)) {
    return "schema-parse-failed";
  }
  return "unknown";
};
const isZodError = (error) => typeof error === "object" && error !== null && "name" in error && error.name === "ZodError";
const REDACTED_KEYS$1 = /* @__PURE__ */ new Set([
  "identityFile",
  "host",
  "user",
  "codexBin",
  "workspaceRoot",
  "sourceRoot"
]);
class FileLogger {
  constructor(filePath, nowIso = () => (/* @__PURE__ */ new Date()).toISOString()) {
    this.filePath = filePath;
    this.nowIso = nowIso;
  }
  async info(message, metadata) {
    await this.write("info", message, metadata);
  }
  async warn(message, metadata) {
    await this.write("warn", message, metadata);
  }
  async error(message, metadata) {
    await this.write("error", message, metadata);
  }
  getFilePath() {
    return this.filePath;
  }
  async readContents() {
    return readFile(this.filePath, "utf8");
  }
  async write(level, message, metadata) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const payload = {
      timestamp: this.nowIso(),
      level,
      message,
      ...metadata ? { metadata: redactMetadata(metadata) } : {}
    };
    await appendFile(this.filePath, `${JSON.stringify(payload)}
`, "utf8");
  }
}
const redactMetadata = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => redactMetadata(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        REDACTED_KEYS$1.has(key) ? "[REDACTED]" : redactMetadata(entry)
      ])
    );
  }
  return value;
};
class AppBootstrap {
  constructor(options) {
    this.options = options;
  }
  status = "idle";
  readyPromise = null;
  context = null;
  getStatus() {
    return this.status;
  }
  getContext() {
    return this.context;
  }
  async ensureReady() {
    if (this.readyPromise) {
      return this.readyPromise;
    }
    this.status = "running";
    this.readyPromise = this.bootstrap();
    return this.readyPromise;
  }
  async bootstrap() {
    const statePaths = getElectronStatePaths(this.options.userDataDir);
    const logger = this.options.logger ?? new FileLogger(join(statePaths.logDir, "main.log"));
    const createSearchIndexService = this.options.createSearchIndexService ?? SearchIndexService.create;
    const runImport = this.options.runImport ?? importTauriState;
    const diagnostics = this.options.diagnostics;
    await logger.info("bootstrap-start", {
      userDataDir: this.options.userDataDir
    });
    try {
      const importResult = await runImport({
        electronUserDataDir: this.options.userDataDir,
        dataLocalDir: this.options.appDataDir,
        homeDir: this.options.homeDir,
        cwd: this.options.cwd,
        logger: {
          info: (message, metadata) => logger.info(message, metadata),
          warn: (message, metadata) => logger.warn(message, metadata)
        }
      });
      const searchIndexService = await createSearchIndexService({
        searchIndexPath: statePaths.searchIndexPath
      });
      this.context = {
        statePaths,
        searchIndexService,
        importResult,
        logFilePath: logger.getFilePath()
      };
      this.status = "ready";
      await diagnostics?.recordLifecycle("bootstrap.ready", "info", {
        importStatus: importResult.status,
        importedDeviceCount: importResult.importedDeviceCount,
        importedSearchSessionCount: importResult.importedSearchSessionCount
      });
      await logger.info("bootstrap-ready", {
        importStatus: importResult.status,
        importedDeviceCount: importResult.importedDeviceCount,
        importedSearchSessionCount: importResult.importedSearchSessionCount,
        logFilePath: logger.getFilePath()
      });
      return this.context;
    } catch (error) {
      this.status = "failed";
      await diagnostics?.recordFailure("bootstrap.ready", error);
      await logger.error("bootstrap-failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}
const DIAGNOSTICS_SCHEMA_VERSION = 1;
const failureCategorySchema = z.enum([
  "blank-screen",
  "preload-missing",
  "bootstrap-timeout",
  "renderer-crash",
  "renderer-never-attached",
  "ipc-timeout",
  "console-error",
  "uncategorized"
]);
const lifecycleEventNameSchema = z.enum([
  "main.window.created",
  "main.process-error",
  "preload.ready",
  "bootstrap.ready",
  "renderer.first-render",
  "renderer.console-error",
  "renderer.page-error",
  "main.render-process-gone",
  "ipc.request",
  "ipc.response",
  "theme.changed",
  "device.changed",
  "search.changed"
]);
const diagnosticsMetadataSchema = z.record(z.string(), z.unknown());
const lifecycleEventSchema = z.object({
  schemaVersion: z.literal(DIAGNOSTICS_SCHEMA_VERSION),
  runId: z.string().min(1),
  timestamp: z.string().min(1),
  event: lifecycleEventNameSchema,
  severity: z.enum(["info", "warn", "error"]),
  metadata: diagnosticsMetadataSchema.optional()
});
z.object({
  event: lifecycleEventNameSchema,
  severity: z.enum(["info", "warn", "error"]).optional(),
  metadata: diagnosticsMetadataSchema.optional()
});
const metricsSnapshotSchema = z.object({
  schemaVersion: z.literal(DIAGNOSTICS_SCHEMA_VERSION),
  runId: z.string().min(1),
  timestamp: z.string().min(1),
  metrics: z.record(z.string(), z.number())
});
z.object({
  schemaVersion: z.literal(DIAGNOSTICS_SCHEMA_VERSION),
  runId: z.string().min(1),
  spanId: z.string().min(1),
  parentSpanId: z.string().min(1).optional(),
  name: z.string().min(1),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1).optional(),
  attributes: diagnosticsMetadataSchema.optional()
});
z.object({
  schemaVersion: z.literal(DIAGNOSTICS_SCHEMA_VERSION),
  runId: z.string().min(1),
  timestamp: z.string().min(1),
  label: z.string().min(1),
  state: z.unknown()
});
const diagnosticsRuntimeStateSchema = z.object({
  schemaVersion: z.literal(DIAGNOSTICS_SCHEMA_VERSION),
  runId: z.string().min(1),
  mode: z.enum(["mock", "real"]),
  target: z.enum(["dev", "packaged"]),
  status: z.enum(["idle", "running", "failed"]),
  startedAt: z.string().min(1),
  updatedAt: z.string().min(1),
  milestones: z.array(lifecycleEventNameSchema),
  failureCategory: failureCategorySchema.optional(),
  notes: z.array(z.string()).default([]),
  lastEvent: lifecycleEventSchema.optional()
});
const artifactReferenceSchema = z.object({
  path: z.string().min(1),
  label: z.string().min(1).optional()
});
z.object({
  schemaVersion: z.literal(DIAGNOSTICS_SCHEMA_VERSION),
  runId: z.string().min(1),
  timestamp: z.string().min(1),
  label: z.string().min(1),
  state: z.unknown()
});
z.object({
  label: z.string().min(1),
  state: z.unknown()
});
z.object({
  schemaVersion: z.literal(DIAGNOSTICS_SCHEMA_VERSION),
  runId: z.string().min(1),
  mode: z.enum(["mock", "real"]),
  target: z.enum(["dev", "packaged"]),
  status: z.enum(["passed", "failed", "skipped"]),
  failureCategory: failureCategorySchema.optional(),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  milestones: z.array(lifecycleEventNameSchema),
  screenshot: artifactReferenceSchema.optional(),
  domSnapshot: artifactReferenceSchema.optional(),
  stateSnapshot: artifactReferenceSchema.optional(),
  notes: z.array(z.string()).default([])
});
const HARNESS_RUNTIME_CONTRACT_VERSION = 1;
const HARNESS_MODE_VALUES = ["mock", "real"];
const HARNESS_TARGET_VALUES = ["dev", "packaged"];
const HARNESS_EXIT_CODES = Object.freeze({
  success: 0,
  invalidContractInput: 2,
  prerequisiteMissing: 3,
  launchFailure: 4,
  attachTimeout: 5,
  bootstrapTimeout: 6,
  scenarioTimeout: 7,
  assertionFailure: 8,
  appCrash: 9,
  artifactWriteFailure: 10,
  cleanupFailure: 11,
  unknownFailure: 12
});
const DEFAULT_HARNESS_MODE = "mock";
const DEFAULT_HARNESS_TARGET = "dev";
const DEFAULT_HARNESS_ARTIFACT_ROOT = "diagnostics";
const DEFAULT_HARNESS_TIMEOUT_POLICY = Object.freeze({
  attachMs: 15e3,
  bootstrapMs: 2e4,
  scenarioMs: 3e4,
  finalizeMs: 1e4,
  totalMs: 9e4
});
const DEFAULT_HARNESS_RETENTION_POLICY = Object.freeze({
  cleanupOnStart: true,
  keepLatestRuns: 5,
  maxRuns: 40,
  maxAgeMs: 7 * 24 * 60 * 60 * 1e3
});
const RUN_ID_MAX_LENGTH = 64;
const CLI_OPTION_KEYS = /* @__PURE__ */ new Set([
  "run-id",
  "mode",
  "target",
  "artifact-root",
  "timeout-attach-ms",
  "timeout-bootstrap-ms",
  "timeout-scenario-ms",
  "timeout-finalize-ms",
  "timeout-total-ms",
  "retention-cleanup-on-start",
  "retention-keep-latest-runs",
  "retention-max-runs",
  "retention-max-age-hours"
]);
class HarnessContractError extends Error {
  key;
  constructor(key, message) {
    super(message);
    this.name = "HarnessContractError";
    this.key = key;
  }
}
const cliKeyToProperty = (key) => {
  switch (key) {
    case "run-id":
      return "runId";
    case "mode":
      return "mode";
    case "target":
      return "target";
    case "artifact-root":
      return "artifactRoot";
    case "timeout-attach-ms":
      return "timeoutAttachMs";
    case "timeout-bootstrap-ms":
      return "timeoutBootstrapMs";
    case "timeout-scenario-ms":
      return "timeoutScenarioMs";
    case "timeout-finalize-ms":
      return "timeoutFinalizeMs";
    case "timeout-total-ms":
      return "timeoutTotalMs";
    case "retention-cleanup-on-start":
      return "retentionCleanupOnStart";
    case "retention-keep-latest-runs":
      return "retentionKeepLatestRuns";
    case "retention-max-runs":
      return "retentionMaxRuns";
    case "retention-max-age-hours":
      return "retentionMaxAgeHours";
    default:
      throw new HarnessContractError("cli", `Unsupported CLI option: --${key}`);
  }
};
const parseCliOptions = (argv) => {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new HarnessContractError(
        "cli",
        `Unexpected positional argument: ${token}. Expected --key value pairs.`
      );
    }
    const withoutPrefix = token.slice(2);
    const eqIndex = withoutPrefix.indexOf("=");
    const key = eqIndex >= 0 ? withoutPrefix.slice(0, eqIndex) : withoutPrefix;
    if (!CLI_OPTION_KEYS.has(key)) {
      throw new HarnessContractError("cli", `Unsupported CLI option: --${key}`);
    }
    const optionProperty = cliKeyToProperty(key);
    let value;
    if (eqIndex >= 0) {
      value = withoutPrefix.slice(eqIndex + 1);
    } else {
      const nextToken = argv[index + 1];
      if (nextToken && !nextToken.startsWith("--")) {
        value = nextToken;
        index += 1;
      } else if (key === "retention-cleanup-on-start") {
        value = "true";
      }
    }
    if (value === void 0) {
      throw new HarnessContractError("cli", `Option --${key} requires a value.`);
    }
    options[optionProperty] = value;
  }
  return options;
};
const normalizeArtifactRoot = (value) => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new HarnessContractError("artifactRoot", "Artifact root must not be empty.");
  }
  return trimmed.replace(/[\\/]+$/g, "");
};
const normalizeRunId = (value) => {
  const sanitized = value.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "-").replace(/-{2,}/g, "-").replace(/^[._-]+|[._-]+$/g, "");
  if (sanitized.length === 0) {
    throw new HarnessContractError("runId", "Run ID must contain at least one alphanumeric character.");
  }
  if (sanitized.length > RUN_ID_MAX_LENGTH) {
    throw new HarnessContractError(
      "runId",
      `Run ID must be ${RUN_ID_MAX_LENGTH} characters or fewer after normalization.`
    );
  }
  return sanitized;
};
const parseEnumValue = (rawValue, values, key) => {
  if (values.includes(rawValue)) {
    return rawValue;
  }
  throw new HarnessContractError(
    key,
    `Invalid ${key}: ${rawValue}. Expected one of: ${values.join(", ")}.`
  );
};
const parsePositiveInt = (value, key) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HarnessContractError(key, `Invalid ${key}: ${value}. Expected a positive integer.`);
  }
  return parsed;
};
const parseBooleanValue = (value, key) => {
  if (/^(1|true|yes|on)$/i.test(value)) {
    return true;
  }
  if (/^(0|false|no|off)$/i.test(value)) {
    return false;
  }
  throw new HarnessContractError(
    key,
    `Invalid ${key}: ${value}. Expected true/false, 1/0, yes/no, or on/off.`
  );
};
const formatRunTimestamp = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").toLowerCase();
const buildDefaultRunId = (date) => `run-${formatRunTimestamp(date)}`;
const pickString = (cliValue, envValue, fallback) => {
  if (cliValue !== void 0) {
    return { value: cliValue, source: "cli" };
  }
  if (envValue !== void 0) {
    return { value: envValue, source: "env" };
  }
  return { value: fallback, source: "default" };
};
const pickNumber = (cliValue, envValue, fallback, key) => {
  if (cliValue !== void 0) {
    return parsePositiveInt(cliValue, key);
  }
  if (envValue !== void 0) {
    return parsePositiveInt(envValue, key);
  }
  return fallback;
};
const pickBoolean = (cliValue, envValue, fallback, key) => {
  if (cliValue !== void 0) {
    return parseBooleanValue(cliValue, key);
  }
  if (envValue !== void 0) {
    return parseBooleanValue(envValue, key);
  }
  return fallback;
};
const joinPathSegments = (...segments) => segments.join("/");
const resolveTimeoutPolicy = (cliOptions, env) => {
  const timeout = {
    attachMs: pickNumber(
      cliOptions.timeoutAttachMs,
      env.HARNESS_TIMEOUT_ATTACH_MS,
      DEFAULT_HARNESS_TIMEOUT_POLICY.attachMs,
      "timeout.attachMs"
    ),
    bootstrapMs: pickNumber(
      cliOptions.timeoutBootstrapMs,
      env.HARNESS_TIMEOUT_BOOTSTRAP_MS,
      DEFAULT_HARNESS_TIMEOUT_POLICY.bootstrapMs,
      "timeout.bootstrapMs"
    ),
    scenarioMs: pickNumber(
      cliOptions.timeoutScenarioMs,
      env.HARNESS_TIMEOUT_SCENARIO_MS,
      DEFAULT_HARNESS_TIMEOUT_POLICY.scenarioMs,
      "timeout.scenarioMs"
    ),
    finalizeMs: pickNumber(
      cliOptions.timeoutFinalizeMs,
      env.HARNESS_TIMEOUT_FINALIZE_MS,
      DEFAULT_HARNESS_TIMEOUT_POLICY.finalizeMs,
      "timeout.finalizeMs"
    ),
    totalMs: pickNumber(
      cliOptions.timeoutTotalMs,
      env.HARNESS_TIMEOUT_TOTAL_MS,
      DEFAULT_HARNESS_TIMEOUT_POLICY.totalMs,
      "timeout.totalMs"
    )
  };
  if (timeout.totalMs < timeout.attachMs + timeout.bootstrapMs + timeout.scenarioMs) {
    throw new HarnessContractError(
      "timeout.totalMs",
      "timeout.totalMs must be greater than or equal to attach+bootstrap+scenario timeouts."
    );
  }
  return timeout;
};
const resolveRetentionPolicy = (cliOptions, env) => {
  const keepLatestRuns = pickNumber(
    cliOptions.retentionKeepLatestRuns,
    env.HARNESS_RETENTION_KEEP_LATEST_RUNS,
    DEFAULT_HARNESS_RETENTION_POLICY.keepLatestRuns,
    "retention.keepLatestRuns"
  );
  const maxRuns = pickNumber(
    cliOptions.retentionMaxRuns,
    env.HARNESS_RETENTION_MAX_RUNS,
    DEFAULT_HARNESS_RETENTION_POLICY.maxRuns,
    "retention.maxRuns"
  );
  const maxAgeHours = pickNumber(
    cliOptions.retentionMaxAgeHours,
    env.HARNESS_RETENTION_MAX_AGE_HOURS,
    DEFAULT_HARNESS_RETENTION_POLICY.maxAgeMs / (60 * 60 * 1e3),
    "retention.maxAgeHours"
  );
  if (keepLatestRuns > maxRuns) {
    throw new HarnessContractError(
      "retention.keepLatestRuns",
      "retention.keepLatestRuns must be less than or equal to retention.maxRuns."
    );
  }
  return {
    cleanupOnStart: pickBoolean(
      cliOptions.retentionCleanupOnStart,
      env.HARNESS_RETENTION_CLEANUP_ON_START,
      DEFAULT_HARNESS_RETENTION_POLICY.cleanupOnStart,
      "retention.cleanupOnStart"
    ),
    keepLatestRuns,
    maxRuns,
    maxAgeMs: maxAgeHours * 60 * 60 * 1e3
  };
};
const buildRunDirectoryName = ({
  runId,
  mode,
  target
}) => `${runId}--${mode}--${target}`;
const parseHarnessRuntimeContract = (input = {}) => {
  const argv = input.argv ?? [];
  const env = input.env ?? {};
  const now = input.now ?? /* @__PURE__ */ new Date();
  const cliOptions = parseCliOptions(argv);
  const modeValue = pickString(cliOptions.mode, env.HARNESS_MODE, DEFAULT_HARNESS_MODE);
  const targetValue = pickString(
    cliOptions.target,
    env.HARNESS_TARGET,
    DEFAULT_HARNESS_TARGET
  );
  const runIdValue = pickString(
    cliOptions.runId,
    env.HARNESS_RUN_ID,
    buildDefaultRunId(now)
  );
  const artifactRootValue = pickString(
    cliOptions.artifactRoot,
    env.HARNESS_ARTIFACT_ROOT,
    DEFAULT_HARNESS_ARTIFACT_ROOT
  );
  const mode = parseEnumValue(modeValue.value, HARNESS_MODE_VALUES, "mode");
  const target = parseEnumValue(targetValue.value, HARNESS_TARGET_VALUES, "target");
  const runId = normalizeRunId(runIdValue.value);
  const runDirectoryName = buildRunDirectoryName({ runId, mode, target });
  const artifactRoot = normalizeArtifactRoot(artifactRootValue.value);
  return {
    version: HARNESS_RUNTIME_CONTRACT_VERSION,
    mode,
    target,
    run: {
      runId,
      startedAtIso: now.toISOString(),
      startedAtEpochMs: now.getTime()
    },
    artifacts: {
      root: artifactRoot,
      runsDirectoryName: "runs",
      runDirectoryName,
      runRelativeDirectory: joinPathSegments("runs", runDirectoryName)
    },
    timeout: resolveTimeoutPolicy(cliOptions, env),
    retention: resolveRetentionPolicy(cliOptions, env),
    exitCodes: HARNESS_EXIT_CODES,
    sources: {
      mode: modeValue.source,
      target: targetValue.source,
      runId: runIdValue.source,
      artifactRoot: artifactRootValue.source
    }
  };
};
const REDACTED_KEYS = /* @__PURE__ */ new Set([
  "stack",
  "identityFile",
  "workspaceRoot",
  "codexBin",
  "sourceRoot",
  "homeDir",
  "appDataDir",
  "cwd"
]);
class NoopHarnessDiagnostics {
  isEnabled() {
    return false;
  }
  getRunId() {
    return null;
  }
  async recordLifecycle() {
  }
  async recordFailure() {
    return "uncategorized";
  }
  async snapshotState() {
  }
  getFailureCategory() {
    return null;
  }
}
class ActiveHarnessDiagnostics {
  constructor(context, nowIso = () => (/* @__PURE__ */ new Date()).toISOString()) {
    this.context = context;
    this.nowIso = nowIso;
  }
  failureCategory = null;
  milestones = /* @__PURE__ */ new Set();
  lastEvent = null;
  metrics = {
    lifecycleEvents: 0,
    errorEvents: 0,
    snapshotsWritten: 0
  };
  isEnabled() {
    return true;
  }
  getRunId() {
    return this.context.runId;
  }
  async recordLifecycle(event, severity = "info", metadata) {
    const payload = lifecycleEventSchema.parse({
      schemaVersion: 1,
      runId: this.context.runId,
      timestamp: this.nowIso(),
      event,
      severity,
      ...metadata ? { metadata: sanitizeDiagnosticsValue(metadata) } : {}
    });
    if (isMilestoneEvent(event)) {
      this.milestones.add(event);
    }
    this.lastEvent = payload;
    this.metrics.lifecycleEvents += 1;
    if (severity === "error") {
      this.metrics.errorEvents += 1;
    }
    await this.appendJsonLine("logs.jsonl", payload);
    await this.writeRuntimeState("running");
    await this.writeMetrics();
  }
  async recordFailure(event, error, metadata) {
    const category = classifyFailure(event, error);
    this.failureCategory = category;
    await this.recordLifecycle(event, "error", {
      failureCategory: category,
      error: toErrorSummary(error),
      ...metadata
    });
    return category;
  }
  async snapshotState(label, state) {
    const fileName = `${sanitizeSnapshotLabel(label)}.json`;
    const snapshot = {
      schemaVersion: 1,
      runId: this.context.runId,
      label,
      timestamp: this.nowIso(),
      state: sanitizeDiagnosticsValue(state)
    };
    await writeJsonFileAtomic(
      join(
        this.context.diagnosticsRoot,
        this.context.runRelativeDirectory,
        "snapshots",
        fileName
      ),
      snapshot
    );
    this.metrics.snapshotsWritten += 1;
    await this.writeRuntimeState("running");
    await this.writeMetrics();
  }
  getFailureCategory() {
    return this.failureCategory;
  }
  async appendJsonLine(relativePath, payload) {
    const target = join(
      this.context.diagnosticsRoot,
      this.context.runRelativeDirectory,
      relativePath
    );
    await mkdir(dirname(target), { recursive: true });
    await appendFile(target, `${JSON.stringify(payload)}
`, "utf8");
  }
  async writeRuntimeState(status) {
    await writeJsonFileAtomic(
      join(
        this.context.diagnosticsRoot,
        this.context.runRelativeDirectory,
        "runtime-state.json"
      ),
      diagnosticsRuntimeStateSchema.parse({
        schemaVersion: 1,
        runId: this.context.runId,
        mode: this.context.mode,
        target: this.context.target,
        status,
        startedAt: this.context.startedAt,
        updatedAt: this.nowIso(),
        milestones: [...this.milestones],
        ...this.failureCategory ? { failureCategory: this.failureCategory } : {},
        notes: [],
        ...this.lastEvent ? { lastEvent: this.lastEvent } : {}
      })
    );
  }
  async writeMetrics() {
    await writeJsonFileAtomic(
      join(
        this.context.diagnosticsRoot,
        this.context.runRelativeDirectory,
        "metrics.json"
      ),
      metricsSnapshotSchema.parse({
        schemaVersion: 1,
        runId: this.context.runId,
        timestamp: this.nowIso(),
        metrics: this.metrics
      })
    );
  }
}
const createHarnessDiagnostics = (options) => {
  const env = options.env ?? process.env;
  const runId = env.HARNESS_RUN_ID?.trim();
  if (!runId) {
    return new NoopHarnessDiagnostics();
  }
  const contract = parseHarnessRuntimeContract({ env });
  return new ActiveHarnessDiagnostics(
    {
      runId: contract.run.runId,
      diagnosticsRoot: join(options.userDataDir, contract.artifacts.root),
      runRelativeDirectory: contract.artifacts.runRelativeDirectory,
      mode: contract.mode,
      target: contract.target,
      startedAt: contract.run.startedAtIso
    },
    options.nowIso
  );
};
const isMilestoneEvent = (event) => event === "main.window.created" || event === "preload.ready" || event === "bootstrap.ready" || event === "renderer.first-render";
const classifyFailure = (event, error) => {
  const message = normalizeFailureText(error);
  if (event === "main.render-process-gone") {
    return "renderer-crash";
  }
  if (event === "main.process-error" && message.includes("bootstrap")) {
    return "bootstrap-timeout";
  }
  if (event === "renderer.page-error" && message.includes("preload")) {
    return "preload-missing";
  }
  if (message.includes("ipc handler timed out") || message.includes("ipc timeout")) {
    return "ipc-timeout";
  }
  if (message.includes("bootstrap") && message.includes("timed out")) {
    return "bootstrap-timeout";
  }
  if (event === "renderer.console-error") {
    return "console-error";
  }
  if (event === "renderer.page-error" && message.includes("blank")) {
    return "blank-screen";
  }
  return "uncategorized";
};
const sanitizeDiagnosticsValue = (value, seen = /* @__PURE__ */ new WeakSet()) => {
  if (value instanceof Error) {
    return toErrorSummary(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDiagnosticsValue(entry, seen));
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        REDACTED_KEYS.has(key) ? "[REDACTED]" : sanitizeDiagnosticsValue(entry, seen)
      ])
    );
  }
  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }
  return value;
};
const sanitizeSnapshotLabel = (label) => label.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "") || "snapshot";
const normalizeFailureText = (value) => value instanceof Error ? `${value.name} ${value.message}`.toLowerCase() : String(value).toLowerCase();
const toErrorSummary = (error) => error instanceof Error ? {
  name: error.name,
  message: error.message
} : {
  message: String(error)
};
const DEFAULT_SSH_PORT = 22;
const DEFAULT_REMOTE_APP_SERVER_PORT = 45231;
class DeviceStore {
  constructor(devicesPath) {
    this.devicesPath = devicesPath;
  }
  async list() {
    const persisted = await readJsonFile(this.devicesPath, persistedDevicesSchema);
    if (!persisted) {
      return [];
    }
    return sanitizeDevices(persisted.devices);
  }
  async save(devices) {
    const payload = {
      devices: sanitizeDevices(devices)
    };
    await writeJsonFileAtomic(this.devicesPath, payload);
  }
  createLocalDevice(request) {
    return {
      id: resolveDeviceId("local", request.name),
      name: request.name ?? "Local Device",
      config: {
        kind: "local",
        appServerPort: request.appServerPort,
        codexBin: request.codexBin,
        workspaceRoot: request.workspaceRoot
      },
      connected: false,
      connection: null,
      lastError: null
    };
  }
  createSshDevice(request) {
    return {
      id: resolveDeviceId("ssh", `${request.user}-${request.host}`),
      name: request.name ?? `${request.user}@${request.host}`,
      config: {
        kind: "ssh",
        host: request.host,
        user: request.user,
        sshPort: request.sshPort ?? DEFAULT_SSH_PORT,
        identityFile: request.identityFile,
        remoteAppServerPort: request.remoteAppServerPort ?? DEFAULT_REMOTE_APP_SERVER_PORT,
        localForwardPort: request.localForwardPort,
        codexBin: request.codexBin,
        workspaceRoot: request.workspaceRoot
      },
      connected: false,
      connection: null,
      lastError: null
    };
  }
}
const sanitizeDevices = (devices) => [...devices].map((device) => ({
  ...device,
  connected: false,
  connection: null,
  lastError: null
})).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
const resolveDeviceId = (kind, seed) => {
  if (process.env.HARNESS_MODE !== "mock") {
    return randomUUID();
  }
  if (kind === "local") {
    return "mock-local-device";
  }
  const normalizedSeed = (seed ?? "device").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `mock-ssh-${normalizedSeed || "device"}`;
};
const DEFAULT_APP_SERVER_APPROVAL_CONFIG = 'approval_policy="never"';
const DEFAULT_APP_SERVER_SANDBOX_CONFIG = 'sandbox_mode="danger-full-access"';
class RuntimeError extends Error {
  code;
  details;
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
class ManagedChild {
  role;
  child;
  constructor(options) {
    this.role = options.role;
    this.child = spawn(options.command, options.args, {
      cwd: options.cwd,
      stdio: "ignore",
      detached: options.detached ?? platform() !== "win32"
    });
  }
  get pid() {
    return this.child.pid;
  }
  async assertRunning() {
    if (this.child.exitCode !== null) {
      throw new RuntimeError("process-exited", `${this.role} exited before becoming ready`, {
        role: this.role,
        exitCode: this.child.exitCode
      });
    }
  }
  async shutdown() {
    if (this.child.exitCode !== null) {
      return;
    }
    try {
      if (platform() === "win32") {
        this.child.kill();
      } else if (this.child.pid) {
        process.kill(-this.child.pid, "SIGTERM");
      } else {
        this.child.kill("SIGTERM");
      }
    } catch {
    }
    const exited = await waitForExit(this.child, 1500);
    if (exited) {
      return;
    }
    try {
      if (platform() === "win32") {
        this.child.kill("SIGKILL");
      } else if (this.child.pid) {
        process.kill(-this.child.pid, "SIGKILL");
      } else {
        this.child.kill("SIGKILL");
      }
    } catch {
    }
    await waitForExit(this.child, 1500);
  }
}
const quoteShell = (value) => {
  if (!value) {
    return "''";
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
};
const buildAppServerProcessArgs = (listenUri) => [
  "app-server",
  "-c",
  DEFAULT_APP_SERVER_APPROVAL_CONFIG,
  "-c",
  DEFAULT_APP_SERVER_SANDBOX_CONFIG,
  "--listen",
  listenUri
];
const buildAppServerShellCommand = (listenUri) => `app-server -c ${quoteShell(DEFAULT_APP_SERVER_APPROVAL_CONFIG)} -c ${quoteShell(DEFAULT_APP_SERVER_SANDBOX_CONFIG)} --listen ${quoteShell(listenUri)}`;
const buildUnixCodexLaunchCommand = ({
  listenUri,
  codexBin
}) => {
  const appServerCommand = buildAppServerShellCommand(listenUri);
  if (codexBin) {
    const lastSlash = codexBin.lastIndexOf("/");
    const codexDir = lastSlash > 0 ? codexBin.slice(0, lastSlash) : null;
    if (codexDir) {
      return `PATH=${quoteShell(codexDir)}:$PATH ${quoteShell(codexBin)} ${appServerCommand}`;
    }
    return `${quoteShell(codexBin)} ${appServerCommand}`;
  }
  return [
    `if command -v codex >/dev/null 2>&1; then codex ${appServerCommand};`,
    `elif [ -x /opt/homebrew/bin/codex ]; then PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/codex ${appServerCommand};`,
    `elif [ -x /usr/local/bin/codex ]; then PATH=/usr/local/bin:$PATH /usr/local/bin/codex ${appServerCommand};`,
    `elif [ -x "$HOME/.local/bin/codex" ]; then PATH="$HOME/.local/bin:$PATH" "$HOME/.local/bin/codex" ${appServerCommand};`,
    `elif command -v fnm >/dev/null 2>&1 && eval "$(fnm env --shell bash)" >/dev/null 2>&1 && command -v codex >/dev/null 2>&1; then codex ${appServerCommand};`,
    `elif [ -d "$HOME/.local/state/fnm_multishells" ] && latest_fnm_codex=$(ls -t "$HOME"/.local/state/fnm_multishells/*/bin/codex 2>/dev/null | head -n 1) && [ -n "$latest_fnm_codex" ]; then PATH="$(dirname "$latest_fnm_codex"):$PATH" "$latest_fnm_codex" ${appServerCommand};`,
    `elif [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 && command -v codex >/dev/null 2>&1; then codex ${appServerCommand};`,
    `else echo 'codex binary not found on PATH/homebrew/local/fnm/nvm; set explicit local codex path in device config' >&2; exit 127; fi`
  ].join(" ");
};
const allocatePort = async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new RuntimeError("port-allocate-failed", "Failed to allocate a local port.");
  }
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
};
const isTcpPortOpen = async (port) => new Promise((resolve) => {
  const socket = createConnection({ host: "127.0.0.1", port });
  socket.once("connect", () => {
    socket.destroy();
    resolve(true);
  });
  socket.once("error", () => {
    resolve(false);
  });
});
const resolveListenPort = async (requestedPort) => {
  if (!requestedPort) {
    return allocatePort();
  }
  if (!await isTcpPortOpen(requestedPort)) {
    return requestedPort;
  }
  return allocatePort();
};
const websocketUpgradeSucceeds = async (localPort) => new Promise((resolve) => {
  const socket = createConnection({ host: "127.0.0.1", port: localPort });
  const timer = setTimeout(() => {
    socket.destroy();
    resolve(false);
  }, 1500);
  socket.once("connect", () => {
    const request = `GET / HTTP/1.1\r
Host: 127.0.0.1:${localPort}\r
Upgrade: websocket\r
Connection: Upgrade\r
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r
Sec-WebSocket-Version: 13\r
\r
`;
    socket.write(request);
  });
  socket.once("data", (buffer) => {
    clearTimeout(timer);
    const response = buffer.toString("utf8");
    socket.destroy();
    resolve(response.startsWith("HTTP/1.1 101") || response.includes(" 101 "));
  });
  socket.once("error", () => {
    clearTimeout(timer);
    resolve(false);
  });
});
const waitForEndpointReady = async ({
  endpoint,
  localPort,
  timeoutMs,
  assertProcesses
}) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await websocketUpgradeSucceeds(localPort)) {
      return;
    }
    if (assertProcesses) {
      for (const assertion of assertProcesses) {
        await assertion();
      }
    }
    await setTimeout$1(180);
  }
  throw new RuntimeError("endpoint-not-ready", `Endpoint did not become ready: ${endpoint}`, {
    endpoint,
    timeoutMs
  });
};
const waitForExit = async (child, timeoutMs) => {
  if (child.exitCode !== null) {
    return true;
  }
  const exitPromise = once(child, "exit").then(() => true).catch(() => true);
  const timeoutPromise = setTimeout$1(timeoutMs).then(() => false);
  return Promise.race([exitPromise, timeoutPromise]);
};
class LocalRuntimeManager {
  status = "idle";
  process = null;
  endpoint = null;
  nowMs;
  resolveListenPortFn;
  createManagedChildFn;
  waitForEndpointReadyFn;
  constructor(options = {}) {
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.resolveListenPortFn = options.resolveListenPort ?? resolveListenPort;
    this.createManagedChildFn = options.createManagedChild ?? ((spawnOptions) => new ManagedChild(spawnOptions));
    this.waitForEndpointReadyFn = options.waitForEndpointReady ?? waitForEndpointReady;
  }
  getStatus() {
    return this.status;
  }
  async start(config) {
    if (this.status === "starting" || this.status === "connected") {
      await this.stop();
    }
    this.status = "starting";
    const localPort = await this.resolveListenPortFn(config.appServerPort);
    const endpoint = `ws://127.0.0.1:${localPort}`;
    const process2 = this.createManagedChildFn(
      buildLocalSpawnOptions(config, endpoint)
    );
    this.process = process2;
    this.endpoint = endpoint;
    try {
      await this.waitForEndpointReadyFn({
        endpoint,
        localPort,
        timeoutMs: 1e4,
        assertProcesses: [() => process2.assertRunning()]
      });
    } catch (error) {
      this.status = "failed";
      await process2.shutdown();
      this.process = null;
      throw enhanceRuntimeError(error, endpoint);
    }
    this.status = "connected";
    return {
      endpoint,
      connection: {
        endpoint,
        transport: "websocket",
        connectedAtMs: this.nowMs(),
        ...process2.pid ? { localServerPid: process2.pid } : {}
      }
    };
  }
  async stop() {
    if (!this.process) {
      this.status = "idle";
      this.endpoint = null;
      return;
    }
    this.status = "disconnecting";
    const existingProcess = this.process;
    this.process = null;
    this.endpoint = null;
    await existingProcess.shutdown();
    this.status = "idle";
  }
}
const buildLocalSpawnOptions = (config, endpoint) => {
  if (platform() === "win32") {
    return {
      role: "local-app-server",
      command: config.codexBin ?? "codex",
      args: buildAppServerProcessArgs(endpoint),
      cwd: config.workspaceRoot
    };
  }
  return {
    role: "local-app-server",
    command: "bash",
    args: ["-lc", buildUnixCodexLaunchCommand({ listenUri: endpoint, codexBin: config.codexBin })],
    cwd: config.workspaceRoot
  };
};
const enhanceRuntimeError = (error, endpoint) => {
  if (error instanceof RuntimeError) {
    return error;
  }
  return new RuntimeError("local-runtime-failed", `Local runtime failed for ${endpoint}`, {
    endpoint,
    cause: error instanceof Error ? error.message : String(error)
  });
};
const MOCK_CONNECTED_AT_MS = Date.UTC(2026, 2, 12, 9, 30, 0, 0);
class MockRuntimeManager {
  endpoint = null;
  async start(config) {
    const endpoint = buildMockEndpoint(config);
    this.endpoint = endpoint;
    return {
      endpoint,
      connection: {
        endpoint,
        transport: "mock-jsonrpc",
        connectedAtMs: MOCK_CONNECTED_AT_MS
      }
    };
  }
  async stop() {
    this.endpoint = null;
  }
}
const buildMockEndpoint = (config) => {
  if (config.kind === "local") {
    const workspace = sanitizeEndpointSegment(
      config.workspaceRoot ?? "mock-local-device"
    );
    return `mock://local/${workspace}`;
  }
  const host = sanitizeEndpointSegment(config.host);
  const user = sanitizeEndpointSegment(config.user);
  return `mock://ssh/${user}@${host}:${config.sshPort}`;
};
const sanitizeEndpointSegment = (value) => value.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._/@:-]/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "") || "mock";
class SshRuntimeManager {
  status = "idle";
  forwarder = null;
  remoteServer = null;
  nowMs;
  resolveListenPortFn;
  createManagedChildFn;
  waitForEndpointReadyFn;
  constructor(options = {}) {
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.resolveListenPortFn = options.resolveListenPort ?? resolveListenPort;
    this.createManagedChildFn = options.createManagedChild ?? ((spawnOptions) => new ManagedChild(spawnOptions));
    this.waitForEndpointReadyFn = options.waitForEndpointReady ?? waitForEndpointReady;
  }
  getStatus() {
    return this.status;
  }
  async start(config) {
    if (this.status === "starting" || this.status === "connected") {
      await this.stop();
    }
    this.status = "starting";
    const localForwardPort = await this.resolveListenPortFn(config.localForwardPort);
    const endpoint = `ws://127.0.0.1:${localForwardPort}`;
    const target = `${config.user}@${config.host}`;
    const forwarder = this.createManagedChildFn(
      buildSshForwarderSpawnOptions(config, target, localForwardPort)
    );
    this.forwarder = forwarder;
    try {
      await this.waitForEndpointReadyFn({
        endpoint,
        localPort: localForwardPort,
        timeoutMs: 4e3,
        assertProcesses: [() => forwarder.assertRunning()]
      });
      this.status = "connected";
      return {
        endpoint,
        connection: {
          endpoint,
          transport: "websocket",
          connectedAtMs: this.nowMs(),
          ...forwarder.pid ? { sshForwardPid: forwarder.pid } : {}
        }
      };
    } catch (error) {
      if (!(error instanceof RuntimeError) || error.code !== "endpoint-not-ready") {
        this.status = "failed";
        await this.stop();
        throw error;
      }
    }
    const remoteServer = this.createManagedChildFn(
      buildSshRemoteSpawnOptions(config, target)
    );
    this.remoteServer = remoteServer;
    try {
      await this.waitForEndpointReadyFn({
        endpoint,
        localPort: localForwardPort,
        timeoutMs: 3e4,
        assertProcesses: [
          () => forwarder.assertRunning(),
          () => remoteServer.assertRunning()
        ]
      });
    } catch (error) {
      this.status = "failed";
      await this.stop();
      throw enhanceSshRuntimeError(error, endpoint);
    }
    this.status = "connected";
    return {
      endpoint,
      connection: {
        endpoint,
        transport: "websocket",
        connectedAtMs: this.nowMs(),
        ...remoteServer.pid ? { sshRemotePid: remoteServer.pid } : {},
        ...forwarder.pid ? { sshForwardPid: forwarder.pid } : {}
      }
    };
  }
  async stop() {
    this.status = this.forwarder || this.remoteServer ? "disconnecting" : "idle";
    const forwarder = this.forwarder;
    const remoteServer = this.remoteServer;
    this.forwarder = null;
    this.remoteServer = null;
    if (forwarder) {
      await forwarder.shutdown();
    }
    if (remoteServer) {
      await remoteServer.shutdown();
    }
    this.status = "idle";
  }
}
const buildSshBaseArgs = (config) => {
  const args = [
    "-p",
    String(config.sshPort),
    "-o",
    "BatchMode=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3"
  ];
  if (config.identityFile) {
    args.push("-i", config.identityFile);
  }
  return args;
};
const buildSshForwarderSpawnOptions = (config, target, localForwardPort) => ({
  role: "ssh-forwarder",
  command: "ssh",
  args: [
    ...buildSshBaseArgs(config),
    "-N",
    "-o",
    "ExitOnForwardFailure=yes",
    "-L",
    `${localForwardPort}:127.0.0.1:${config.remoteAppServerPort}`,
    target
  ]
});
const buildRemoteAppServerCommand = (config) => {
  const listenUri = `ws://127.0.0.1:${config.remoteAppServerPort}`;
  const appServerCommand = buildAppServerShellCommand(listenUri);
  const launchCommand = config.codexBin ? buildExplicitCodexLaunch(config.codexBin, appServerCommand) : buildDefaultCodexLaunch(appServerCommand);
  const staleCleanupCommand = [
    `for pid in $(ss -ltnp 2>/dev/null | sed -n 's/.*127\\\\.0\\\\.0\\\\.1:${config.remoteAppServerPort}.*pid=\\\\([0-9]\\\\+\\\\).*/\\\\1/p' | sort -u); do`,
    'cmd=$(ps -p "$pid" -o args= 2>/dev/null || true);',
    'case "$cmd" in *codex*) kill "$pid" >/dev/null 2>&1 || true ;; esac;',
    "done"
  ].join(" ");
  const command = `${staleCleanupCommand}; ${launchCommand}`;
  if (!config.workspaceRoot) {
    return command;
  }
  return `cd ${quoteShell(config.workspaceRoot)} && ${command}`;
};
const buildSshRemoteSpawnOptions = (config, target) => ({
  role: "ssh-remote-app-server",
  command: "ssh",
  args: [
    ...buildSshBaseArgs(config),
    target,
    `bash -lc ${quoteShell(buildRemoteAppServerCommand(config))}`
  ]
});
const buildExplicitCodexLaunch = (codexBin, appServerCommand) => {
  const lastSlash = codexBin.lastIndexOf("/");
  const codexDir = lastSlash > 0 ? codexBin.slice(0, lastSlash) : null;
  if (codexDir) {
    return `PATH=${quoteShell(codexDir)}:$PATH ${quoteShell(codexBin)} ${appServerCommand}`;
  }
  return `${quoteShell(codexBin)} ${appServerCommand}`;
};
const buildDefaultCodexLaunch = (appServerCommand) => [
  `if command -v codex >/dev/null 2>&1; then codex ${appServerCommand};`,
  `elif [ -x /opt/homebrew/bin/codex ]; then PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/codex ${appServerCommand};`,
  `elif [ -x /usr/local/bin/codex ]; then PATH=/usr/local/bin:$PATH /usr/local/bin/codex ${appServerCommand};`,
  `elif [ -x "$HOME/.local/bin/codex" ]; then PATH="$HOME/.local/bin:$PATH" "$HOME/.local/bin/codex" ${appServerCommand};`,
  `elif command -v fnm >/dev/null 2>&1 && eval "$(fnm env --shell bash)" >/dev/null 2>&1 && command -v codex >/dev/null 2>&1; then codex ${appServerCommand};`,
  `elif [ -d "$HOME/.local/state/fnm_multishells" ] && latest_fnm_codex=$(ls -t "$HOME"/.local/state/fnm_multishells/*/bin/codex 2>/dev/null | head -n 1) && [ -n "$latest_fnm_codex" ]; then PATH="$(dirname "$latest_fnm_codex"):$PATH" "$latest_fnm_codex" ${appServerCommand};`,
  `elif [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 && command -v codex >/dev/null 2>&1; then codex ${appServerCommand};`,
  `else echo 'codex binary not found on PATH/homebrew/local/fnm/nvm; set explicit codex path in device config' >&2; exit 127; fi`
].join(" ");
const enhanceSshRuntimeError = (error, endpoint) => {
  if (error instanceof RuntimeError) {
    return error;
  }
  return new RuntimeError("ssh-runtime-failed", `SSH runtime failed for ${endpoint}`, {
    endpoint,
    cause: error instanceof Error ? error.message : String(error)
  });
};
class DeviceService {
  constructor(store, searchIndexService, env) {
    this.store = store;
    this.searchIndexService = searchIndexService;
    this.env = env;
  }
  devices = /* @__PURE__ */ new Map();
  runtimes = /* @__PURE__ */ new Map();
  static async create(store, searchIndexService, options = {}) {
    const service = new DeviceService(
      store,
      searchIndexService,
      options.env ?? process.env
    );
    const persistedDevices = await store.list();
    for (const device of persistedDevices) {
      const normalized = service.toMockDeviceIfNeeded(device);
      service.devices.set(normalized.id, normalized);
    }
    return service;
  }
  list() {
    return [...this.devices.values()].sort(
      (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    );
  }
  async addLocal(request) {
    const parsed = deviceAddLocalRequestSchema.parse(request);
    const device = this.toMockDeviceIfNeeded(this.store.createLocalDevice(parsed));
    this.devices.set(device.id, device);
    await this.persist();
    return device;
  }
  async addSsh(request) {
    const parsed = deviceAddSshRequestSchema.parse(request);
    const device = this.toMockDeviceIfNeeded(this.store.createSshDevice(parsed));
    this.devices.set(device.id, device);
    await this.persist();
    return device;
  }
  async connect(deviceId) {
    const current = this.requireDevice(deviceId);
    await this.disconnectIfNeeded(deviceId);
    const runtime = this.isMockMode() ? new MockRuntimeManager() : current.config.kind === "local" ? new LocalRuntimeManager() : new SshRuntimeManager();
    this.runtimes.set(deviceId, runtime);
    try {
      const { connection } = await runtime.start(current.config);
      const next = {
        ...current,
        connected: true,
        connection,
        lastError: null
      };
      this.devices.set(deviceId, next);
      await this.persist();
      return next;
    } catch (error) {
      this.runtimes.delete(deviceId);
      const next = {
        ...current,
        connected: false,
        connection: null,
        lastError: error instanceof Error ? error.message : String(error)
      };
      this.devices.set(deviceId, next);
      await this.persist();
      throw error;
    }
  }
  async disconnect(deviceId) {
    const current = this.requireDevice(deviceId);
    await this.disconnectIfNeeded(deviceId);
    const next = {
      ...current,
      connected: false,
      connection: null
    };
    this.devices.set(deviceId, next);
    await this.persist();
    return next;
  }
  async remove(deviceId) {
    await this.disconnectIfNeeded(deviceId);
    if (!this.devices.delete(deviceId)) {
      throw new Error(`Device not found: ${deviceId}`);
    }
    await this.persist();
    try {
      await this.searchIndexService.removeDevice(deviceId);
    } catch {
    }
    return this.list();
  }
  requireDevice(deviceId) {
    const current = this.devices.get(deviceId);
    if (!current) {
      throw new Error(`Device not found: ${deviceId}`);
    }
    return current;
  }
  async disconnectIfNeeded(deviceId) {
    const runtime = this.runtimes.get(deviceId);
    if (!runtime) {
      return;
    }
    this.runtimes.delete(deviceId);
    await runtime.stop();
  }
  async persist() {
    await this.store.save(this.list());
  }
  isMockMode() {
    return this.env.HARNESS_MODE === "mock";
  }
  toMockDeviceIfNeeded(device) {
    if (!this.isMockMode()) {
      return device;
    }
    return {
      ...device,
      id: buildDeterministicMockDeviceId(device.config),
      lastError: null
    };
  }
}
const buildDeterministicMockDeviceId = (config) => {
  if (config.kind === "local") {
    return "mock-local-device";
  }
  const host = config.host.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const user = config.user.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `mock-ssh-${user}-${host}`.replace(/-+/g, "-");
};
class ThemeService {
  constructor(preferencesPath) {
    this.preferencesPath = preferencesPath;
    nativeTheme.on("updated", () => {
      void this.emit();
    });
  }
  listeners = /* @__PURE__ */ new Set();
  preference = null;
  initialized = false;
  async initialize() {
    if (this.initialized) {
      return;
    }
    const persisted = await readJsonFile(this.preferencesPath, preferencesSchema);
    this.preference = persisted?.themePreference ?? null;
    this.syncNativeTheme();
    this.initialized = true;
  }
  async getPreference() {
    await this.initialize();
    return this.currentState();
  }
  async setPreference(preference) {
    await this.initialize();
    this.preference = preference;
    this.syncNativeTheme();
    const payload = {
      version: 1,
      themePreference: preference
    };
    await writeJsonFileAtomic(this.preferencesPath, preferencesSchema.parse(payload));
    await this.emit();
    return this.currentState();
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  async emit() {
    const state = this.currentState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
  currentState() {
    const resolved = nativeTheme.shouldUseDarkColors ? "dark" : "light";
    return themePreferenceStateSchema.parse({
      preference: this.preference ?? resolved,
      resolved
    });
  }
  syncNativeTheme() {
    nativeTheme.themeSource = this.preference ?? "system";
  }
}
const diagnosticsLifecycleRequestSchema = z.object({
  event: lifecycleEventNameSchema,
  severity: z.enum(["info", "warn", "error"]).optional(),
  metadata: diagnosticsMetadataSchema.optional()
});
const diagnosticsStateSnapshotRequestSchema = z.object({
  label: z.string().min(1),
  state: z.unknown()
});
const IPC_CHANNELS = {
  devicesList: "devices:list",
  devicesAddLocal: "devices:addLocal",
  devicesAddSsh: "devices:addSsh",
  devicesConnect: "devices:connect",
  devicesDisconnect: "devices:disconnect",
  devicesRemove: "devices:remove",
  searchUpsertThread: "search:upsertThread",
  searchRemoveDevice: "search:removeDevice",
  searchQuery: "search:query",
  searchBootstrapStatus: "search:bootstrapStatus",
  themeGetPreference: "theme:getPreference",
  themeSetPreference: "theme:setPreference",
  themeUpdated: "theme:updated",
  diagnosticsRecordLifecycle: "diagnostics:recordLifecycle",
  diagnosticsSnapshotState: "diagnostics:snapshotState"
};
const registerIpcHandlers = ({
  ipcMain: ipcMain2,
  deviceService,
  searchIndexService,
  themeService,
  diagnostics,
  getWindows = () => []
}) => {
  const handle = (channel, action, options) => {
    ipcMain2.handle(channel, async (_event, payload) => {
      const startedAt = Date.now();
      await diagnostics?.recordLifecycle("ipc.request", "info", {
        channel
      });
      try {
        const result = await Promise.race([
          Promise.resolve(action(payload)),
          new Promise(
            (_, reject) => setTimeout(() => reject(new Error("IPC handler timed out")), 3e4)
          )
        ]);
        await diagnostics?.recordLifecycle("ipc.response", "info", {
          channel,
          durationMs: Date.now() - startedAt,
          status: "ok"
        });
        if (options?.successEvent) {
          await diagnostics?.recordLifecycle(options.successEvent, "info", {
            channel
          });
        }
        return result;
      } catch (error) {
        await diagnostics?.recordFailure("ipc.response", error, {
          channel,
          durationMs: Date.now() - startedAt
        });
        const envelope = ipcErrorEnvelopeSchema.parse({
          version: 1,
          code: "ipc/handler-failed",
          message: error instanceof Error ? error.message : String(error),
          retryable: false
        });
        throw new Error(JSON.stringify(envelope));
      }
    });
  };
  handle(IPC_CHANNELS.devicesList, () => deviceService.list());
  handle(
    IPC_CHANNELS.devicesAddLocal,
    (payload) => deviceService.addLocal(deviceAddLocalRequestSchema.parse(payload)),
    { successEvent: "device.changed" }
  );
  handle(
    IPC_CHANNELS.devicesAddSsh,
    (payload) => deviceService.addSsh(deviceAddSshRequestSchema.parse(payload)),
    { successEvent: "device.changed" }
  );
  handle(
    IPC_CHANNELS.devicesConnect,
    (payload) => deviceService.connect(deviceIdRequestSchema.parse(payload).deviceId),
    { successEvent: "device.changed" }
  );
  handle(
    IPC_CHANNELS.devicesDisconnect,
    (payload) => deviceService.disconnect(deviceIdRequestSchema.parse(payload).deviceId),
    { successEvent: "device.changed" }
  );
  handle(
    IPC_CHANNELS.devicesRemove,
    (payload) => deviceService.remove(deviceIdRequestSchema.parse(payload).deviceId),
    { successEvent: "device.changed" }
  );
  handle(
    IPC_CHANNELS.searchUpsertThread,
    (payload) => searchIndexService.upsertThread(searchIndexThreadPayloadSchema.parse(payload)),
    { successEvent: "search.changed" }
  );
  handle(
    IPC_CHANNELS.searchRemoveDevice,
    (payload) => searchIndexService.removeDevice(deviceIdRequestSchema.parse(payload).deviceId),
    { successEvent: "search.changed" }
  );
  handle(
    IPC_CHANNELS.searchQuery,
    (payload) => searchIndexService.query(searchQueryRequestSchema.parse(payload)),
    { successEvent: "search.changed" }
  );
  handle(IPC_CHANNELS.searchBootstrapStatus, () => searchIndexService.bootstrapStatus());
  handle(IPC_CHANNELS.themeGetPreference, () => themeService.getPreference());
  handle(IPC_CHANNELS.themeSetPreference, async (payload) => {
    const state = await themeService.setPreference(themePreferenceSchema.parse(payload));
    for (const window of getWindows()) {
      window.webContents.send(IPC_CHANNELS.themeUpdated, state);
    }
    return state;
  }, { successEvent: "theme.changed" });
  handle(IPC_CHANNELS.diagnosticsRecordLifecycle, (payload) => {
    const request = diagnosticsLifecycleRequestSchema.parse(payload);
    return diagnostics?.recordLifecycle(
      request.event,
      request.severity,
      request.metadata
    );
  });
  handle(IPC_CHANNELS.diagnosticsSnapshotState, (payload) => {
    const request = diagnosticsStateSnapshotRequestSchema.parse(payload);
    return diagnostics?.snapshotState(request.label, request.state);
  });
};
let bootstrap = null;
const resolveUserDataDir = () => process.env.HARNESS_USER_DATA_DIR?.trim() || app.getPath("userData");
function createMainWindow(diagnostics) {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: "Codex Session Monitor",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });
  window.once("ready-to-show", () => {
    window.show();
  });
  void diagnostics?.recordLifecycle("main.window.created", "info", {
    width: 1280,
    height: 820
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    void diagnostics?.recordFailure(
      "main.render-process-gone",
      new Error(details.reason || "render process gone"),
      {
        exitCode: details.exitCode,
        reason: details.reason
      }
    );
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return window;
}
app.whenReady().then(async () => {
  const userDataDir = resolveUserDataDir();
  const diagnostics = createHarnessDiagnostics({
    userDataDir
  });
  bootstrap = new AppBootstrap({
    userDataDir,
    homeDir: app.getPath("home"),
    appDataDir: app.getPath("appData"),
    cwd: process.cwd(),
    diagnostics
  });
  process.on("uncaughtException", (error) => {
    void diagnostics.recordFailure("main.process-error", error);
  });
  process.on("unhandledRejection", (error) => {
    void diagnostics.recordFailure("main.process-error", error);
  });
  const bootstrapContext = await bootstrap.ensureReady();
  const deviceStore = new DeviceStore(bootstrapContext.statePaths.devicesPath);
  const deviceService = await DeviceService.create(
    deviceStore,
    bootstrapContext.searchIndexService
  );
  const themeService = new ThemeService(bootstrapContext.statePaths.preferencesPath);
  await themeService.initialize();
  registerIpcHandlers({
    ipcMain,
    deviceService,
    searchIndexService: bootstrapContext.searchIndexService,
    themeService,
    diagnostics,
    getWindows: () => BrowserWindow.getAllWindows()
  });
  createMainWindow(diagnostics);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(diagnostics);
    }
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
