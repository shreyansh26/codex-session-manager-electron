import { describe, expect, it } from "vitest";
import { resolveHarnessRuntimeContract } from "../../scripts/harness/resolveRuntimeContract";
import { runRealSmoke } from "../../scripts/harness/smokeReal";

describe("runRealSmoke", () => {
  it("returns prerequisiteMissing and writes a skip summary when prereqs are unavailable", async () => {
    const contract = resolveHarnessRuntimeContract({
      cwd: "/tmp/codex-harness-real",
      env: {
        HARNESS_RUN_ID: "real-smoke-skip",
        HARNESS_MODE: "real",
        HARNESS_TARGET: "dev"
      }
    });

    let wroteSkip = false;
    const exitCode = await runRealSmoke({
      appRoot: "/tmp/codex-harness-real",
      contract,
      detectPrereqs: () => ({
        status: "skipped",
        skipReasonCode: "auth-missing",
        skipReason: "missing auth",
        checks: []
      }),
      writeSkipSummary: async () => {
        wroteSkip = true;
        return "/tmp/codex-harness-real/diagnostics/runs/real-smoke-skip--real--dev/summary.json";
      },
      runHarness: async () =>
        ({
          status: "passed"
        }) as never
    });

    expect(exitCode).toBe(contract.exitCodes.prerequisiteMissing);
    expect(wroteSkip).toBe(true);
  });

  it("runs the harness and returns success when prereqs are ready", async () => {
    const contract = resolveHarnessRuntimeContract({
      cwd: "/tmp/codex-harness-real",
      env: {
        HARNESS_RUN_ID: "real-smoke-ready",
        HARNESS_MODE: "real",
        HARNESS_TARGET: "dev"
      }
    });

    const exitCode = await runRealSmoke({
      appRoot: "/tmp/codex-harness-real",
      contract,
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
          status: "passed"
        }) as never
    });

    expect(exitCode).toBe(contract.exitCodes.success);
  });
});
