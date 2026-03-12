import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyFailure,
  createHarnessDiagnostics,
  sanitizeDiagnosticsValue
} from "./harnessDiagnostics";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "codex-harness-diag-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe("createHarnessDiagnostics", () => {
  it("writes lifecycle events and state snapshots when HARNESS_RUN_ID is set", async () => {
    const dir = await createTempDir();
    const diagnostics = createHarnessDiagnostics({
      userDataDir: dir,
      env: {
        HARNESS_RUN_ID: "diag-run",
        HARNESS_MODE: "mock",
        HARNESS_TARGET: "dev"
      },
      nowIso: () => "2026-03-12T00:00:00.000Z"
    });

    await diagnostics.recordLifecycle("main.window.created", "info", {
      cwd: "/Users/demo/project",
      count: 1
    });
    await diagnostics.snapshotState("renderer store", {
      deviceCount: 1
    });

    const logContents = await readFile(
      join(dir, "diagnostics", "runs", "diag-run--mock--dev", "logs.jsonl"),
      "utf8"
    );
    expect(logContents).toContain("\"event\":\"main.window.created\"");
    expect(logContents).toContain("\"cwd\":\"[REDACTED]\"");

    const snapshotContents = await readFile(
      join(
        dir,
        "diagnostics",
        "runs",
        "diag-run--mock--dev",
        "snapshots",
        "renderer-store.json"
      ),
      "utf8"
    );
    expect(snapshotContents).toContain("\"deviceCount\": 1");
  });

  it("categorizes fatal paths and persists the failure category", async () => {
    const dir = await createTempDir();
    const diagnostics = createHarnessDiagnostics({
      userDataDir: dir,
      env: {
        HARNESS_RUN_ID: "diag-run",
        HARNESS_MODE: "mock",
        HARNESS_TARGET: "dev"
      }
    });

    const category = await diagnostics.recordFailure(
      "main.render-process-gone",
      new Error("Renderer process exited")
    );

    expect(category).toBe("renderer-crash");
    expect(diagnostics.getFailureCategory()).toBe("renderer-crash");
  });

  it("becomes a no-op when harness mode is not active", async () => {
    const dir = await createTempDir();
    const diagnostics = createHarnessDiagnostics({
      userDataDir: dir,
      env: {}
    });

    await diagnostics.recordLifecycle("main.window.created");
    await diagnostics.snapshotState("noop", { ok: true });

    expect(diagnostics.isEnabled()).toBe(false);
    expect(diagnostics.getRunId()).toBeNull();
  });
});

describe("classifyFailure", () => {
  it("maps known timeout and console conditions to stable categories", () => {
    expect(
      classifyFailure("renderer.console-error", new Error("Something exploded"))
    ).toBe("console-error");
    expect(
      classifyFailure("ipc.response", new Error("IPC handler timed out"))
    ).toBe("ipc-timeout");
    expect(
      classifyFailure("renderer.page-error", new Error("Preload script failed"))
    ).toBe("preload-missing");
  });
});

describe("sanitizeDiagnosticsValue", () => {
  it("survives circular metadata and redacts sensitive keys", () => {
    const value: Record<string, unknown> = {
      workspaceRoot: "/Users/demo/project"
    };
    value.self = value;

    expect(sanitizeDiagnosticsValue(value)).toEqual({
      workspaceRoot: "[REDACTED]",
      self: "[Circular]"
    });
  });
});
