import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  diagnosticsFileLayout,
  runSummarySchema
} from "../../src/shared/diagnostics/contracts.ts";
import type { NodeHarnessRuntimeContract } from "./resolveRuntimeContract.ts";
import { writeJsonFileAtomic } from "../../src/main/services/storage/jsonFileStore.ts";

export type RealPrereqReasonCode =
  | "codex-missing"
  | "ssh-missing"
  | "auth-missing"
  | "unsupported-environment";

export interface RealPrereqCheck {
  name: "codex" | "ssh" | "auth";
  status: "present" | "missing" | "unauthenticated" | "unsupported";
  detail?: string;
}

export interface RealPrereqReport {
  status: "ready" | "skipped";
  checks: RealPrereqCheck[];
  skipReasonCode?: RealPrereqReasonCode;
  skipReason?: string;
}

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export interface RealPrereqOptions {
  env?: Readonly<Record<string, string | undefined>>;
  runCommand?: (command: string, args: string[]) => CommandResult;
}

export const detectRealPrereqs = (
  options: RealPrereqOptions = {}
): RealPrereqReport => {
  const env = options.env ?? process.env;
  const runCommand = options.runCommand ?? defaultRunCommand;

  const codexBinary = detectBinary("codex", runCommand);
  const sshBinary = detectBinary("ssh", runCommand);
  const checks: RealPrereqCheck[] = [codexBinary, sshBinary];

  if (codexBinary.status !== "present") {
    return skipped(checks, "codex-missing", codexBinary.detail ?? "The codex binary is unavailable.");
  }
  if (sshBinary.status !== "present") {
    return skipped(checks, "ssh-missing", sshBinary.detail ?? "The ssh binary is unavailable.");
  }

  const authCheck = detectAuth(env, runCommand);
  checks.push(authCheck);
  if (authCheck.status !== "present") {
    return skipped(
      checks,
      authCheck.status === "unsupported" ? "unsupported-environment" : "auth-missing",
      authCheck.detail ?? "Unable to verify Codex authentication."
    );
  }

  return {
    status: "ready",
    checks
  };
};

const defaultRunCommand = (command: string, args: string[]): CommandResult => {
  const result = spawnSync(command, args, {
    encoding: "utf8"
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error } : {})
  };
};

const detectBinary = (
  name: "codex" | "ssh",
  runCommand: (command: string, args: string[]) => CommandResult
): RealPrereqCheck => {
  const result = runCommand("which", [name]);
  if (result.status === 0 && result.stdout.trim().length > 0) {
    return {
      name,
      status: "present",
      detail: result.stdout.trim()
    };
  }
  return {
    name,
    status: "missing",
    detail: result.stderr.trim() || `${name} was not found in PATH.`
  };
};

const detectAuth = (
  env: Readonly<Record<string, string | undefined>>,
  runCommand: (command: string, args: string[]) => CommandResult
): RealPrereqCheck => {
  const apiKey = env.OPENAI_API_KEY?.trim() || env.CODEX_API_KEY?.trim();
  if (apiKey) {
    return {
      name: "auth",
      status: "present",
      detail: "Detected API key in environment."
    };
  }

  const statusResult = runCommand("codex", ["auth", "status"]);
  const combined = `${statusResult.stdout}\n${statusResult.stderr}`.toLowerCase();
  if (statusResult.status === 0) {
    if (combined.includes("logged out") || combined.includes("not logged in")) {
      return {
        name: "auth",
        status: "unauthenticated",
        detail: "Codex CLI reports that the user is not logged in."
      };
    }
    return {
      name: "auth",
      status: "present",
      detail: "Codex CLI authentication looks available."
    };
  }

  if (combined.includes("unknown command") || combined.includes("usage:")) {
    return {
      name: "auth",
      status: "unsupported",
      detail: "This Codex CLI does not support `codex auth status`."
    };
  }

  if (combined.includes("not logged in") || combined.includes("login")) {
    return {
      name: "auth",
      status: "unauthenticated",
      detail: "Codex CLI requires authentication before real smoke can run."
    };
  }

  return {
    name: "auth",
    status: "unsupported",
    detail:
      statusResult.error?.message ||
      statusResult.stderr.trim() ||
      "Unable to determine Codex authentication state."
  };
};

const skipped = (
  checks: RealPrereqCheck[],
  skipReasonCode: RealPrereqReasonCode,
  skipReason: string
): RealPrereqReport => ({
  status: "skipped",
  checks,
  skipReasonCode,
  skipReason
});

export const writeRealPrereqSummary = async (options: {
  contract: NodeHarnessRuntimeContract;
  userDataDir: string;
  report: RealPrereqReport;
}): Promise<string> => {
  const summaryPath = join(
    options.userDataDir,
    options.contract.artifacts.root,
    options.contract.artifacts.runRelativeDirectory,
    diagnosticsFileLayout.summaryFile
  );

  await writeJsonFileAtomic(
    summaryPath,
    runSummarySchema.parse({
      schemaVersion: 1,
      runId: options.contract.run.runId,
      mode: options.contract.mode,
      target: options.contract.target,
      status: options.report.status === "ready" ? "passed" : "skipped",
      startedAt: options.contract.run.startedAtIso,
      finishedAt: new Date().toISOString(),
      milestones: [],
      notes: [
        ...(options.report.skipReasonCode ? [`skipReasonCode:${options.report.skipReasonCode}`] : []),
        ...(options.report.skipReason ? [`skipReason:${options.report.skipReason}`] : []),
        ...options.report.checks.map(
          (check) =>
            `${check.name}:${check.status}${check.detail ? `:${check.detail}` : ""}`
        )
      ]
    })
  );

  return summaryPath;
};
