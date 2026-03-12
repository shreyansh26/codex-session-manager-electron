import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diagnosticsFileLayout } from "../../src/shared/diagnostics/contracts";
import type { NodeHarnessRuntimeContract } from "../../scripts/harness/resolveRuntimeContract";
import {
  resolveElectronLaunchConfig,
  runElectronHarness
} from "./electronRunner";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "codex-electron-runner-"));
  tempDirs.push(dir);
  return dir;
};

const makeContract = (overrides: Partial<NodeHarnessRuntimeContract> = {}): NodeHarnessRuntimeContract =>
  ({
    version: 1,
    mode: "mock",
    target: "dev",
    run: {
      runId: "runner-test",
      startedAtIso: "2026-03-12T12:00:00.000Z",
      startedAtEpochMs: Date.parse("2026-03-12T12:00:00.000Z")
    },
    artifacts: {
      root: "diagnostics",
      runsDirectoryName: "runs",
      runDirectoryName: "runner-test--mock--dev",
      runRelativeDirectory: "runs/runner-test--mock--dev",
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
    },
    ...overrides
  }) as NodeHarnessRuntimeContract;

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("resolveElectronLaunchConfig", () => {
  it("builds a dev launch against the unpackaged main entry", async () => {
    const appRoot = await createTempDir();
    const outDir = join(appRoot, "out", "main");
    await mkdir(outDir, { recursive: true });
    await writeFile(join(appRoot, "package.json"), "{}\n", "utf8");
    await writeFile(join(outDir, "index.js"), "console.log('ok')\n", "utf8");

    const config = await resolveElectronLaunchConfig({
      appRoot,
      userDataDir: join(appRoot, ".user-data"),
      contract: makeContract()
    });

    expect(config.args).toEqual([join(appRoot, "out", "main", "index.js")]);
    expect(config.env.HARNESS_MODE).toBe("mock");
    expect(config.env.HARNESS_USER_DATA_DIR).toBe(join(appRoot, ".user-data"));
  });
});

describe("runElectronHarness", () => {
  it("writes a failed summary when the renderer never attaches", async () => {
    const appRoot = await createTempDir();
    const entryDir = join(appRoot, "out", "main");
    await mkdir(entryDir, { recursive: true });
    await writeFile(join(appRoot, "package.json"), "{}\n", "utf8");
    await writeFile(join(entryDir, "index.js"), "console.log('ok')\n", "utf8");

    const launch = vi.fn(async () => ({
      on: vi.fn(),
      close: vi.fn(async () => undefined),
      firstWindow: () =>
        new Promise<{
          on: (event: "console" | "pageerror", listener: (payload: unknown) => void) => void;
        }>(() => undefined)
    }));

    const userDataDir = await createTempDir();
    const result = await runElectronHarness({
      appRoot,
      userDataDir,
      contract: makeContract(),
      electronLauncher: { launch } as never
    });

    expect(result.status).toBe("failed");
    expect(result.failureCategory).toBe("renderer-never-attached");

    const summary = JSON.parse(await readFile(result.summaryPath, "utf8")) as {
      status: string;
      failureCategory: string;
    };
    expect(summary.status).toBe("failed");
    expect(summary.failureCategory).toBe("renderer-never-attached");
  });

  it("writes a passed summary and captures diagnostics milestones on success", async () => {
    const appRoot = await createTempDir();
    const entryDir = join(appRoot, "out", "main");
    await mkdir(entryDir, { recursive: true });
    await writeFile(join(appRoot, "package.json"), "{}\n", "utf8");
    await writeFile(join(entryDir, "index.js"), "console.log('ok')\n", "utf8");

    const userDataDir = await createTempDir();
    const runtimeStatePath = join(
      userDataDir,
      "diagnostics",
      "runs",
      "runner-test--mock--dev",
      diagnosticsFileLayout.runtimeStateFile
    );

    const launch = vi.fn(async () => ({
      on: vi.fn((event: string, listener: (payload: unknown) => void) => {
        if (event === "console") {
          void listener({
            type: () => "log",
            text: () => "main booted",
            args: () => [{ jsonValue: async () => "main booted" }]
          });
        }
      }),
      close: vi.fn(async () => undefined),
      firstWindow: async () => {
        await mkdir(join(userDataDir, "diagnostics", "runs", "runner-test--mock--dev"), {
          recursive: true
        });
        await writeFile(
          runtimeStatePath,
          JSON.stringify(
            {
              schemaVersion: 1,
              runId: "runner-test",
              mode: "mock",
              target: "dev",
              status: "running",
              startedAt: "2026-03-12T12:00:00.000Z",
              updatedAt: "2026-03-12T12:00:01.000Z",
              milestones: ["main.window.created", "preload.ready", "renderer.first-render"],
              notes: []
            },
            null,
            2
          ),
          "utf8"
        );

        return {
          on: vi.fn(),
          waitForLoadState: vi.fn(async () => undefined),
          title: vi.fn(async () => "Codex Session Monitor")
        };
      }
    }));

    const result = await runElectronHarness({
      appRoot,
      userDataDir,
      contract: makeContract(),
      electronLauncher: { launch } as never
    });

    expect(result.status).toBe("passed");
    expect(result.windowTitle).toBe("Codex Session Monitor");
    expect(result.diagnosticsMilestones).toContain("renderer.first-render");

    const summary = JSON.parse(await readFile(result.summaryPath, "utf8")) as {
      status: string;
      milestones: string[];
    };
    expect(summary.status).toBe("passed");
    expect(summary.milestones).toContain("preload.ready");
  });

  it("writes screenshot, DOM, state snapshot, and summary artifacts on post-attach failure", async () => {
    const appRoot = await createTempDir();
    const entryDir = join(appRoot, "out", "main");
    await mkdir(entryDir, { recursive: true });
    await writeFile(join(appRoot, "package.json"), "{}\n", "utf8");
    await writeFile(join(entryDir, "index.js"), "console.log('ok')\n", "utf8");

    const userDataDir = await createTempDir();
    const launch = vi.fn(async () => ({
      on: vi.fn(),
      close: vi.fn(async () => undefined),
      firstWindow: async () => ({
        on: vi.fn(),
        screenshot: vi.fn(async () => Buffer.from("png-bytes")),
        content: vi.fn(async () => "<html><body>fixture</body></html>"),
        evaluate: vi.fn(async () => ({ loading: false, sessions: 2 })) as <T>(
          expression: () => T | Promise<T>
        ) => Promise<T>,
        waitForLoadState: vi.fn(async () => {
          throw new Error("bootstrap timeout after attach");
        }),
        title: vi.fn(async () => "Broken Fixture")
      })
    })) as never;

    const result = await runElectronHarness({
      appRoot,
      userDataDir,
      contract: makeContract(),
      electronLauncher: { launch } as never
    });

    expect(result.status).toBe("failed");
    expect(result.failureCategory).toBe("bootstrap-timeout");
    expect(result.screenshotPath).toBe("screenshots/final.png");
    expect(result.domSnapshotPath).toBe("dom/final.html");
    expect(result.stateSnapshotPath).toBe("snapshots/runner-state.json");

    const runDir = join(
      userDataDir,
      "diagnostics",
      "runs",
      "runner-test--mock--dev"
    );
    const screenshot = await readFile(join(runDir, "screenshots", "final.png"));
    const dom = await readFile(join(runDir, "dom", "final.html"), "utf8");
    const state = await readFile(join(runDir, "snapshots", "runner-state.json"), "utf8");
    const summary = await readFile(join(runDir, "summary.json"), "utf8");

    expect(screenshot.equals(Buffer.from("png-bytes"))).toBe(true);
    expect(dom).toContain("fixture");
    expect(state).toContain("\"sessions\": 2");
    expect(summary).toContain("\"failureCategory\": \"bootstrap-timeout\"");
    expect(summary).toContain("\"stateSnapshot\"");
  });
});
