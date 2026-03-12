import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { NodeHarnessRuntimeContract } from "../../../scripts/harness/resolveRuntimeContract";
import { runElectronHarness } from "../electronRunner";
import { runMockAppScenario } from "./mockAppScenario";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "codex-mock-scenario-"));
  tempDirs.push(dir);
  return dir;
};

const makeContract = (runId: string): NodeHarnessRuntimeContract =>
  ({
    version: 1,
    mode: "mock",
    target: "dev",
    run: {
      runId,
      startedAtIso: "2026-03-12T12:00:00.000Z",
      startedAtEpochMs: Date.parse("2026-03-12T12:00:00.000Z")
    },
    artifacts: {
      root: "diagnostics",
      runsDirectoryName: "runs",
      runDirectoryName: `${runId}--mock--dev`,
      runRelativeDirectory: `runs/${runId}--mock--dev`,
      rootAbsolutePath: "",
      runsAbsolutePath: "",
      runAbsolutePath: ""
    },
    timeout: {
      attachMs: 5_000,
      bootstrapMs: 7_500,
      scenarioMs: 10_000,
      finalizeMs: 2_000,
      totalMs: 15_000
    },
    retention: {
      cleanupOnStart: true,
      keepLatestRuns: 5,
      maxRuns: 40,
      maxAgeMs: 1000
    },
    exitCodes: {
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
    },
    sources: {
      mode: "default",
      target: "default",
      runId: "default",
      artifactRoot: "default"
    }
  }) as NodeHarnessRuntimeContract;

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("mock app scenario", () => {
  it(
    "passes the end-to-end mock UI scenario against the actual Electron app",
    async () => {
      const userDataDir = await createTempDir();
      const result = await runElectronHarness({
        appRoot: resolve(process.cwd()),
        userDataDir,
        contract: makeContract("t7-mock-scenario"),
        entryScriptPath: resolve(process.cwd(), "out/main/index.js"),
        afterAttach: runMockAppScenario
      });

      expect(result.status).toBe("passed");
      expect(result.milestones).toEqual(
        expect.arrayContaining([
          "bootstrap.ready",
          "main.window.created",
          "preload.ready",
          "renderer.first-render"
        ])
      );
    },
    25_000
  );
});
