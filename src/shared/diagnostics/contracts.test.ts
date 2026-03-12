import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readJsonFile, writeJsonFileAtomic } from "../../main/services/storage/jsonFileStore";
import {
  DIAGNOSTICS_SCHEMA_VERSION,
  lifecycleEventSchema,
  resolveRunArtifactLayout,
  runSummarySchema
} from "./contracts";

const tempDirectories: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "codex-diagnostics-"));
  tempDirectories.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("diagnostics contracts", () => {
  it("round-trips valid lifecycle and summary payloads", () => {
    const lifecycle = lifecycleEventSchema.parse({
      schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
      runId: "run-123",
      timestamp: "2026-03-12T00:00:00.000Z",
      event: "bootstrap.ready",
      severity: "info",
      metadata: {
        step: "bootstrap"
      }
    });
    const summary = runSummarySchema.parse({
      schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
      runId: "run-123",
      mode: "mock",
      target: "dev",
      status: "failed",
      failureCategory: "blank-screen",
      startedAt: "2026-03-12T00:00:00.000Z",
      finishedAt: "2026-03-12T00:00:10.000Z",
      milestones: ["main.window.created", "preload.ready"],
      notes: ["renderer never painted"]
    });

    expect(lifecycle.event).toBe("bootstrap.ready");
    expect(summary.failureCategory).toBe("blank-screen");
  });

  it("rejects unsupported schema versions", () => {
    expect(() =>
      runSummarySchema.parse({
        schemaVersion: 999,
        runId: "run-123",
        mode: "mock",
        target: "dev",
        status: "passed",
        startedAt: "2026-03-12T00:00:00.000Z",
        finishedAt: "2026-03-12T00:00:01.000Z",
        milestones: []
      })
    ).toThrow();
  });

  it("resolves deterministic artifact paths", () => {
    expect(resolveRunArtifactLayout("run-abc")).toEqual({
      runDirectory: "runs/run-abc",
      logsFile: "runs/run-abc/logs.jsonl",
      metricsFile: "runs/run-abc/metrics.json",
      spansFile: "runs/run-abc/spans.jsonl",
      summaryFile: "runs/run-abc/summary.json",
      screenshotsDirectory: "runs/run-abc/screenshots",
      domDirectory: "runs/run-abc/dom",
      snapshotsDirectory: "runs/run-abc/snapshots"
    });
  });

  it("writes and reads summary payloads atomically", async () => {
    const dir = await createTempDir();
    const summaryPath = join(dir, "summary.json");
    const payload = runSummarySchema.parse({
      schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
      runId: "run-123",
      mode: "mock",
      target: "dev",
      status: "passed",
      startedAt: "2026-03-12T00:00:00.000Z",
      finishedAt: "2026-03-12T00:00:01.000Z",
      milestones: ["main.window.created"],
      notes: []
    });

    await writeJsonFileAtomic(summaryPath, payload);
    const raw = await readFile(summaryPath, "utf8");
    const parsed = await readJsonFile(summaryPath, runSummarySchema);

    expect(raw.endsWith("\n")).toBe(true);
    expect(parsed).toEqual(payload);
  });
});
