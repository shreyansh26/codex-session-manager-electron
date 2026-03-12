import { describe, expect, it } from "vitest";
import {
  DEFAULT_HARNESS_ARTIFACT_ROOT,
  DEFAULT_HARNESS_MODE,
  DEFAULT_HARNESS_RETENTION_POLICY,
  DEFAULT_HARNESS_TARGET,
  DEFAULT_HARNESS_TIMEOUT_POLICY,
  HARNESS_EXIT_CODES,
  HarnessContractError,
  buildRunDirectoryName,
  parseHarnessRuntimeContract,
  selectRunDirectoriesForCleanup
} from "./runContract";

describe("harness runtime contract", () => {
  it("parses defaults into a canonical contract", () => {
    const now = new Date("2026-03-12T04:05:06.789Z");
    const contract = parseHarnessRuntimeContract({ now });

    expect(contract.mode).toBe(DEFAULT_HARNESS_MODE);
    expect(contract.target).toBe(DEFAULT_HARNESS_TARGET);
    expect(contract.run.runId).toBe("run-20260312t040506z");
    expect(contract.run.startedAtIso).toBe("2026-03-12T04:05:06.789Z");
    expect(contract.artifacts.root).toBe(DEFAULT_HARNESS_ARTIFACT_ROOT);
    expect(contract.artifacts.runDirectoryName).toBe("run-20260312t040506z--mock--dev");
    expect(contract.artifacts.runRelativeDirectory).toBe("runs/run-20260312t040506z--mock--dev");
    expect(contract.timeout).toEqual(DEFAULT_HARNESS_TIMEOUT_POLICY);
    expect(contract.retention).toEqual(DEFAULT_HARNESS_RETENTION_POLICY);
    expect(contract.exitCodes).toBe(HARNESS_EXIT_CODES);
    expect(contract.sources).toEqual({
      mode: "default",
      target: "default",
      runId: "default",
      artifactRoot: "default"
    });
  });

  it("prefers CLI values over environment values", () => {
    const contract = parseHarnessRuntimeContract({
      now: new Date("2026-03-12T08:00:00.000Z"),
      argv: [
        "--mode=mock",
        "--target",
        "dev",
        "--run-id",
        "CLI Run @ 001",
        "--artifact-root=./tmp/harness",
        "--timeout-total-ms",
        "100000",
        "--retention-max-runs",
        "20",
        "--retention-keep-latest-runs",
        "3",
        "--retention-max-age-hours",
        "48",
        "--retention-cleanup-on-start",
        "false"
      ],
      env: {
        HARNESS_MODE: "real",
        HARNESS_TARGET: "packaged",
        HARNESS_RUN_ID: "env-run",
        HARNESS_ARTIFACT_ROOT: "env-root",
        HARNESS_TIMEOUT_TOTAL_MS: "120000",
        HARNESS_RETENTION_MAX_RUNS: "60",
        HARNESS_RETENTION_KEEP_LATEST_RUNS: "6",
        HARNESS_RETENTION_MAX_AGE_HOURS: "72",
        HARNESS_RETENTION_CLEANUP_ON_START: "true"
      }
    });

    expect(contract.mode).toBe("mock");
    expect(contract.target).toBe("dev");
    expect(contract.run.runId).toBe("cli-run-001");
    expect(contract.artifacts.root).toBe("./tmp/harness");
    expect(contract.timeout.totalMs).toBe(100000);
    expect(contract.retention).toEqual({
      cleanupOnStart: false,
      keepLatestRuns: 3,
      maxRuns: 20,
      maxAgeMs: 48 * 60 * 60 * 1000
    });
    expect(contract.sources).toEqual({
      mode: "cli",
      target: "cli",
      runId: "cli",
      artifactRoot: "cli"
    });
  });

  it("supports environment-only selection and deterministic directory names", () => {
    const input = {
      now: new Date("2026-03-12T08:15:30.000Z"),
      env: {
        HARNESS_MODE: "real",
        HARNESS_TARGET: "packaged",
        HARNESS_RUN_ID: "Env_Run_42"
      }
    };

    const first = parseHarnessRuntimeContract(input);
    const second = parseHarnessRuntimeContract(input);

    expect(first.mode).toBe("real");
    expect(first.target).toBe("packaged");
    expect(first.run.runId).toBe("env_run_42");
    expect(first.artifacts.runDirectoryName).toBe("env_run_42--real--packaged");
    expect(second.artifacts.runDirectoryName).toBe(first.artifacts.runDirectoryName);
    expect(first.sources).toEqual({
      mode: "env",
      target: "env",
      runId: "env",
      artifactRoot: "default"
    });
  });

  it("throws on invalid configuration values", () => {
    expect(() =>
      parseHarnessRuntimeContract({
        argv: ["--mode", "preview"]
      })
    ).toThrowError(HarnessContractError);

    expect(() =>
      parseHarnessRuntimeContract({
        argv: ["--retention-max-runs", "2", "--retention-keep-latest-runs", "4"]
      })
    ).toThrowError(HarnessContractError);

    expect(() =>
      parseHarnessRuntimeContract({
        argv: ["--timeout-attach-ms", "1000", "--timeout-bootstrap-ms", "1000", "--timeout-scenario-ms", "1000", "--timeout-total-ms", "2000"]
      })
    ).toThrowError(HarnessContractError);
  });

  it("selects cleanup candidates from retention policy deterministically", () => {
    const now = Date.parse("2026-03-12T12:00:00.000Z");
    const toDelete = selectRunDirectoriesForCleanup(
      [
        {
          directoryName: "run-a--mock--dev",
          startedAtEpochMs: Date.parse("2026-03-10T00:00:00.000Z")
        },
        {
          directoryName: "run-b--mock--dev",
          startedAtEpochMs: Date.parse("2026-03-11T00:00:00.000Z")
        },
        {
          directoryName: "run-c--mock--dev",
          startedAtEpochMs: Date.parse("2026-03-11T12:00:00.000Z")
        },
        {
          directoryName: "run-d--mock--dev",
          startedAtEpochMs: Date.parse("2026-03-12T11:00:00.000Z")
        }
      ],
      {
        cleanupOnStart: true,
        keepLatestRuns: 1,
        maxRuns: 2,
        maxAgeMs: 36 * 60 * 60 * 1000
      },
      now
    );

    expect(toDelete).toEqual(["run-a--mock--dev", "run-b--mock--dev"]);
  });

  it("builds run directory names from canonical fields", () => {
    expect(
      buildRunDirectoryName({
        runId: "run-20260312t120000z",
        mode: "mock",
        target: "dev"
      })
    ).toBe("run-20260312t120000z--mock--dev");
  });
});
