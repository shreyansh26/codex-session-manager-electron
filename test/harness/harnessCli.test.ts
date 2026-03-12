import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { NodeHarnessRuntimeContract } from "../../scripts/harness/resolveRuntimeContract";
import { buildHarnessReport } from "../../scripts/harness/report";
import { queryHarnessArtifacts } from "../../scripts/harness/query";
import { runMockSmoke } from "../../scripts/harness/smokeMock";
import { runRealSmoke } from "../../scripts/harness/smokeReal";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "codex-harness-cli-"));
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
      startedAtIso: "2026-03-12T13:00:00.000Z",
      startedAtEpochMs: Date.parse("2026-03-12T13:00:00.000Z")
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
      attachMs: 20,
      bootstrapMs: 20,
      scenarioMs: 100,
      finalizeMs: 100,
      totalMs: 100
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

describe("harness CLI helpers", () => {
  it("returns success for a green mock smoke run and maps failures to harness exit codes", async () => {
    const contract = makeContract("mock-smoke");

    const successExitCode = await runMockSmoke({
      appRoot: "/workspace/codex-app-electron",
      contract,
      runHarness: async () =>
        ({
          status: "passed"
        }) as never
    });
    const failureExitCode = await runMockSmoke({
      appRoot: "/workspace/codex-app-electron",
      contract,
      runHarness: async () =>
        ({
          status: "failed",
          failureCategory: "renderer-never-attached"
        }) as never
    });

    expect(successExitCode).toBe(0);
    expect(failureExitCode).toBe(contract.exitCodes.attachTimeout);
  });

  it("forwards packaged smoke launch options into the harness runner", async () => {
    const contract = {
      ...makeContract("mock-packaged"),
      target: "packaged" as const
    };
    const calls: Array<Record<string, unknown>> = [];

    await runMockSmoke({
      appRoot: "/workspace/codex-app-electron",
      contract,
      packagedExecutablePath:
        "/workspace/codex-app-electron/dist/mac-arm64/Codex Session Monitor.app/Contents/MacOS/Codex Session Monitor",
      userDataDir: "/tmp/codex-harness-packaged",
      runHarness: async (options) => {
        calls.push(options as unknown as Record<string, unknown>);
        return {
          status: "passed"
        } as never;
      }
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].packagedExecutablePath).toContain("Codex Session Monitor");
    expect(calls[0].userDataDir).toBe("/tmp/codex-harness-packaged");
  });

  it("builds a probable-cause report from a stored run directory", async () => {
    const appRoot = await createTempDir();
    const runDir = join(appRoot, ".harness", "diagnostics", "runs", "latest-run");
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "summary.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          runId: "latest-run",
          mode: "mock",
          target: "dev",
          status: "failed",
          startedAt: "2026-03-12T13:00:00.000Z",
          finishedAt: "2026-03-12T13:00:05.000Z",
          milestones: ["main.window.created"],
          notes: ["renderer never attached within timeout"]
        },
        null,
        2
      ),
      "utf8"
    );

    const report = await buildHarnessReport({
      appRoot,
      runDirectoryName: "latest-run"
    });

    expect(report.status).toBe("failed");
    expect(report.probableCause).toBe("preload-missing");
    expect(report.missingMilestones).toContain("preload.ready");
  });

  it("queries nested summary/runtime fields from stored artifacts", async () => {
    const appRoot = await createTempDir();
    const runDir = join(appRoot, ".harness", "diagnostics", "runs", "query-run");
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "summary.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          runId: "query-run",
          mode: "mock",
          target: "dev",
          status: "skipped",
          startedAt: "2026-03-12T13:00:00.000Z",
          finishedAt: "2026-03-12T13:00:01.000Z",
          milestones: [],
          notes: ["skipReasonCode:auth-missing"]
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(
      join(runDir, "runtime-state.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          runId: "query-run",
          mode: "mock",
          target: "dev",
          status: "failed",
          startedAt: "2026-03-12T13:00:00.000Z",
          updatedAt: "2026-03-12T13:00:01.000Z",
          milestones: ["main.window.created"],
          notes: ["runtime note"]
        },
        null,
        2
      ),
      "utf8"
    );

    const [status, note] = await Promise.all([
      queryHarnessArtifacts({
        appRoot,
        runDirectoryName: "query-run",
        field: "summary.status"
      }),
      queryHarnessArtifacts({
        appRoot,
        runDirectoryName: "query-run",
        field: "runtimeState.notes"
      })
    ]);

    expect(status).toBe("skipped");
    expect(note).toEqual(["runtime note"]);
  });

  it("returns structured skip and success exit codes for real smoke", async () => {
    const appRoot = await createTempDir();
    const contract = makeContract("real-smoke");

    const skippedCode = await runRealSmoke({
      appRoot,
      contract: {
        ...contract,
        mode: "real"
      },
      detectPrereqs: () => ({
        status: "skipped",
        checks: [{ name: "codex", status: "missing", detail: "not found" }],
        skipReasonCode: "codex-missing",
        skipReason: "codex not installed"
      }),
      writeSkipSummary: async () => join(appRoot, "diagnostics", "summary.json")
    });

    const successCode = await runRealSmoke({
      appRoot,
      contract: {
        ...contract,
        mode: "real"
      },
      detectPrereqs: () => ({
        status: "ready",
        checks: [
          { name: "codex", status: "present" },
          { name: "ssh", status: "present" },
          { name: "auth", status: "present" }
        ]
      }),
      runHarness: async () =>
        ({
          status: "passed",
          exitCode: 0
        }) as never
    });

    expect(skippedCode).toBe(contract.exitCodes.prerequisiteMissing);
    expect(successCode).toBe(0);
  });
});
