import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchIndexService } from "../search/searchIndexService";
import { AppBootstrap } from "./appBootstrap";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "codex-bootstrap-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AppBootstrap", () => {
  it("runs import and search bootstrap exactly once", async () => {
    const dir = await createTempDir();
    const importMock = vi.fn(async () => ({
      status: "skipped" as const,
      importedDeviceCount: 0,
      importedSearchSessionCount: 0,
      warnings: []
    }));
    const diagnostics = {
      recordLifecycle: vi.fn(async () => undefined),
      recordFailure: vi.fn(async () => "uncategorized" as const),
      snapshotState: vi.fn(async () => undefined),
      isEnabled: vi.fn(() => true),
      getRunId: vi.fn(() => "run-1"),
      getFailureCategory: vi.fn(() => null)
    };
    const searchService = {} as SearchIndexService;
    const createSearchIndexService = vi.fn(async () => searchService);

    const bootstrap = new AppBootstrap({
      userDataDir: dir,
      homeDir: dir,
      appDataDir: dir,
      cwd: dir,
      diagnostics,
      runImport: importMock,
      createSearchIndexService
    });

    const [first, second] = await Promise.all([
      bootstrap.ensureReady(),
      bootstrap.ensureReady()
    ]);

    expect(first).toBe(second);
    expect(bootstrap.getStatus()).toBe("ready");
    expect(importMock).toHaveBeenCalledTimes(1);
    expect(createSearchIndexService).toHaveBeenCalledTimes(1);
    expect(first.logFilePath.endsWith("/logs/main.log")).toBe(true);
    expect(diagnostics.recordLifecycle).toHaveBeenCalledWith(
      "bootstrap.ready",
      "info",
      expect.objectContaining({
        importStatus: "skipped"
      })
    );
  });
});
