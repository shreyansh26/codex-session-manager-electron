import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { NodeHarnessRuntimeContract } from "../../scripts/harness/resolveRuntimeContract";
import { runElectronHarness } from "./electronRunner";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "codex-electron-runner-int-"));
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
      attachMs: 2_000,
      bootstrapMs: 2_000,
      scenarioMs: 5_000,
      finalizeMs: 2_000,
      totalMs: 8_000
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

describe("runElectronHarness integration", () => {
  it(
    "launches a real Electron fixture and attaches to the first window",
    async () => {
      if (process.env.HARNESS_RUN_ELECTRON_INTEGRATION !== "1") {
        return;
      }
      const userDataDir = await createTempDir();
      const fixtureRoot = join(process.cwd(), "test", "harness", "fixtures");

      const result = await runElectronHarness({
        appRoot: fixtureRoot,
        userDataDir,
        contract: makeContract("fixture-success"),
        entryScriptPath: join(fixtureRoot, "electron-smoke-main.cjs")
      });

      expect(result.status).toBe("passed");
      expect(result.attached).toBe(true);
      expect(result.windowTitle).toBe("Harness Fixture");
      expect(
        result.windowConsole.some((entry) => entry.text.includes("fixture-renderer-ready"))
      ).toBe(true);

      const summary = JSON.parse(await readFile(result.summaryPath, "utf8")) as {
        status: string;
      };
      expect(summary.status).toBe("passed");
    },
    20_000
  );

  it(
    "returns a structured attach failure when Electron never opens a window",
    async () => {
      if (process.env.HARNESS_RUN_ELECTRON_INTEGRATION !== "1") {
        return;
      }
      const userDataDir = await createTempDir();
      const fixtureRoot = join(process.cwd(), "test", "harness", "fixtures");

      const result = await runElectronHarness({
        appRoot: fixtureRoot,
        userDataDir,
        contract: makeContract("fixture-no-window"),
        entryScriptPath: join(fixtureRoot, "electron-no-window-main.cjs"),
        attachTimeoutMs: 500
      });

      expect(result.status).toBe("failed");
      expect(result.failureCategory).toBe("renderer-never-attached");

      const summary = JSON.parse(await readFile(result.summaryPath, "utf8")) as {
        status: string;
        failureCategory: string;
      };
      expect(summary.status).toBe("failed");
      expect(summary.failureCategory).toBe("renderer-never-attached");
    },
    20_000
  );
});
