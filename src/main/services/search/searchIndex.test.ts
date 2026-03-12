import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SearchIndex, normalizeForSearch } from "./searchIndex";
import { SearchIndexService } from "./searchIndexService";

const tempDirectories: string[] = [];

const createTempDir = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "codex-search-"));
  tempDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const buildIndex = () => {
  const index = new SearchIndex({ nowMs: () => 42 });

  index.upsertThread({
    sessionKey: "device-a::thread-a",
    threadId: "thread-a",
    deviceId: "device-a",
    sessionTitle: "Electron Search",
    deviceLabel: "Local",
    deviceAddress: "local",
    updatedAt: "2026-03-12T00:00:00.000Z",
    messages: [
      {
        id: "message-a1",
        role: "assistant",
        content: "Implement search ranking for the Electron desktop app",
        createdAt: "2026-03-12T00:00:00.000Z"
      },
      {
        id: "message-a2",
        role: "user",
        content: "Search ranking should stay stable after reload",
        createdAt: "2026-03-12T00:01:00.000Z"
      }
    ]
  });

  index.upsertThread({
    sessionKey: "device-b::thread-b",
    threadId: "thread-b",
    deviceId: "device-b",
    sessionTitle: "SSH Runtime",
    deviceLabel: "Remote",
    deviceAddress: "ssh://example",
    updatedAt: "2026-03-12T00:02:00.000Z",
    messages: [
      {
        id: "message-b1",
        role: "assistant",
        content: "SSH runtime reconnect support and tunnel cleanup",
        createdAt: "2026-03-12T00:02:00.000Z"
      }
    ]
  });

  index.upsertThread({
    sessionKey: "device-c::thread-c",
    threadId: "thread-c",
    deviceId: "device-c",
    sessionTitle: "Electron UI",
    deviceLabel: "Local",
    deviceAddress: "local",
    updatedAt: "2026-03-12T00:03:00.000Z",
    messages: [
      {
        id: "message-c1",
        role: "assistant",
        content: "Electron theme toggle and renderer polish",
        createdAt: "2026-03-12T00:03:00.000Z"
      }
    ]
  });

  return index;
};

describe("SearchIndex", () => {
  it("normalizes search text like the Rust implementation", () => {
    expect(normalizeForSearch(" Electron, Search!!!  ")).toBe("electron search");
    expect(normalizeForSearch("SSH\tRuntime\nCleanup")).toBe("ssh runtime cleanup");
  });

  it("returns stable ranking order and hit counts for a representative query corpus", () => {
    const index = buildIndex();

    const result = index.query({
      query: "search ranking",
      threshold: 0.9,
      maxSessions: 10
    });

    expect(result.totalHits).toBe(2);
    expect(result.sessionHits.map((entry) => entry.sessionKey)).toEqual([
      "device-a::thread-a"
    ]);
    expect(result.sessionHits[0].hitCount).toBe(2);
  });

  it("requires direct substring containment for short queries", () => {
    const index = buildIndex();

    const result = index.query({
      query: "ssh",
      threshold: 0.9,
      maxSessions: 10
    });

    expect(result.totalHits).toBe(1);
    expect(result.sessionHits[0].sessionKey).toBe("device-b::thread-b");
  });

  it("updates bootstrap counts and performs idempotent device removal", () => {
    const index = buildIndex();

    expect(index.bootstrapStatus()).toEqual({
      indexedSessions: 3,
      indexedMessages: 4,
      lastUpdatedAtMs: 42
    });
    expect(index.removeDevice("device-b")).toBe(1);
    expect(index.removeDevice("device-b")).toBe(0);
    expect(index.bootstrapStatus()).toEqual({
      indexedSessions: 2,
      indexedMessages: 3,
      lastUpdatedAtMs: 42
    });
  });
});

describe("SearchIndexService", () => {
  it("persists and reloads indexed sessions", async () => {
    const tempDir = await createTempDir();
    const searchIndexPath = join(tempDir, "search-index-v1.json");

    const service = await SearchIndexService.create({
      searchIndexPath,
      nowMs: () => 100
    });

    await service.upsertThread({
      sessionKey: "device-a::thread-a",
      threadId: "thread-a",
      deviceId: "device-a",
      sessionTitle: "Electron Search",
      deviceLabel: "Local",
      deviceAddress: "local",
      updatedAt: "2026-03-12T00:00:00.000Z",
      messages: [
        {
          id: "message-a1",
          role: "assistant",
          content: "Implement search ranking for the Electron desktop app",
          createdAt: "2026-03-12T00:00:00.000Z"
        }
      ]
    });

    const reloadedService = await SearchIndexService.create({
      searchIndexPath,
      nowMs: () => 200
    });
    const result = reloadedService.query({
      query: "search ranking",
      threshold: 0.9,
      maxSessions: 10
    });

    expect(result.totalHits).toBe(1);
    expect(result.sessionHits[0].sessionKey).toBe("device-a::thread-a");
    expect(reloadedService.bootstrapStatus().indexedSessions).toBe(1);
  });
});
