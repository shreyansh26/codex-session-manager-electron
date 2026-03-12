import {
  SEARCH_INDEX_STORE_VERSION,
  persistedSearchIndexSchema,
  type PersistedSearchIndex,
  type SearchBootstrapStatusRecord,
  type SearchIndexThreadPayloadRecord,
  type SearchQueryRequestRecord,
  type SearchQueryResponseRecord,
  type SearchSessionHitRecord
} from "../../../shared/schema/contracts";
import { readJsonFile, writeJsonFileAtomic } from "../storage/jsonFileStore";

const DEFAULT_THRESHOLD = 0.9;
const DEFAULT_MAX_SESSIONS = 10;
const MIN_FUZZY_QUERY_CHARS = 4;
const MAX_WINDOW_TOKEN_SCAN = 220;

interface IndexedMessage {
  messageId: string;
  role: SearchIndexThreadPayloadRecord["messages"][number]["role"];
  content: string;
  contentNormalized: string;
  tokens: string[];
  tokenSet: Set<string>;
  createdAt: string;
}

interface SessionEntry {
  sessionKey: string;
  threadId: string;
  deviceId: string;
  sessionTitle: string;
  deviceLabel: string;
  deviceAddress: string;
  updatedAt: string;
  messages: Map<string, IndexedMessage>;
}

export interface SearchIndexOptions {
  nowMs?: () => number;
}

interface SearchScoreInput {
  normalizedQuery: string;
  queryTokenSet: Set<string>;
  queryTokenCount: number;
  shortQuery: boolean;
  message: IndexedMessage;
  threshold: number;
}

const ALPHA_NUMERIC_CHARACTER = /[\p{L}\p{N}]/u;
const WHITESPACE_CHARACTER = /\s/u;

export class SearchIndex {
  private readonly sessions = new Map<string, SessionEntry>();
  private indexedMessageCount = 0;
  private lastUpdatedAtMs: number | undefined;
  private readonly nowMs: () => number;

  constructor(options: SearchIndexOptions = {}) {
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  static async loadFromPath(
    filePath: string,
    options: SearchIndexOptions = {}
  ): Promise<SearchIndex> {
    const persisted = await readJsonFile(filePath, persistedSearchIndexSchema);
    if (!persisted) {
      return new SearchIndex(options);
    }
    return SearchIndex.fromPersisted(persisted, options);
  }

  static fromPersisted(
    persisted: PersistedSearchIndex,
    options: SearchIndexOptions = {}
  ): SearchIndex {
    const parsed = persistedSearchIndexSchema.parse(persisted);
    const index = new SearchIndex(options);
    index.lastUpdatedAtMs = parsed.lastUpdatedAtMs;

    for (const persistedSession of parsed.sessions) {
      const messages = new Map<string, IndexedMessage>();
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

  async persistToPath(filePath: string): Promise<void> {
    await writeJsonFileAtomic(filePath, this.toPersisted());
  }

  upsertThread(payload: SearchIndexThreadPayloadRecord): void {
    if (!payload.sessionKey.trim()) {
      return;
    }

    const previousCount = this.sessions.get(payload.sessionKey)?.messages.size ?? 0;
    const messages = new Map<string, IndexedMessage>();
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

  removeDevice(deviceId: string): number {
    const keysToRemove: string[] = [];
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

  query(request: SearchQueryRequestRecord): SearchQueryResponseRecord {
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

    const groupedHits = new Map<string, SearchSessionHitRecord>();
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

  bootstrapStatus(): SearchBootstrapStatusRecord {
    return {
      indexedSessions: this.sessions.size,
      indexedMessages: this.indexedMessageCount,
      ...(this.lastUpdatedAtMs !== undefined
        ? { lastUpdatedAtMs: this.lastUpdatedAtMs }
        : {})
    };
  }

  toPersisted(): PersistedSearchIndex {
    const sessions = [...this.sessions.values()]
      .sort(
        (left, right) =>
          left.sessionKey.localeCompare(right.sessionKey) ||
          left.threadId.localeCompare(right.threadId)
      )
      .map((session) => ({
        sessionKey: session.sessionKey,
        threadId: session.threadId,
        deviceId: session.deviceId,
        sessionTitle: session.sessionTitle,
        deviceLabel: session.deviceLabel,
        deviceAddress: session.deviceAddress,
        updatedAt: session.updatedAt,
        messages: [...session.messages.values()]
          .sort(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) ||
              left.messageId.localeCompare(right.messageId)
          )
          .map((message) => ({
            messageId: message.messageId,
            role: message.role,
            content: message.content,
            createdAt: message.createdAt
          }))
      }));

    return persistedSearchIndexSchema.parse({
      version: SEARCH_INDEX_STORE_VERSION,
      ...(this.lastUpdatedAtMs !== undefined
        ? { lastUpdatedAtMs: this.lastUpdatedAtMs }
        : {}),
      sessions
    });
  }
}

export const normalizeForSearch = (value: string): string => {
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

const tokenize = (value: string): string[] =>
  value
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const minTokenOverlap = (queryTokenCount: number): number => {
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
}: SearchScoreInput): number | null => {
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

  let score = contains
    ? 1
    : normalizedLevenshtein(normalizedQuery, message.contentNormalized);

  if (!contains) {
    score = Math.max(
      score,
      bestWindowSimilarity(normalizedQuery, queryTokenCount, message.tokens)
    );
  }

  return score >= threshold ? score : null;
};

const bestWindowSimilarity = (
  normalizedQuery: string,
  queryTokenCount: number,
  messageTokens: string[]
): number => {
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

const normalizedLevenshtein = (left: string, right: string): number => {
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

const levenshteinDistance = (left: string[], right: string[]): number => {
  const previous = new Array<number>(right.length + 1);
  const current = new Array<number>(right.length + 1);

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

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const clampInteger = (value: number, min: number, max: number): number =>
  Math.trunc(clamp(value, min, max));
