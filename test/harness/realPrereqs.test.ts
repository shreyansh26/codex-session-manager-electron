import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveHarnessRuntimeContract } from "../../scripts/harness/resolveRuntimeContract";
import {
  detectRealPrereqs,
  writeRealPrereqSummary
} from "../../scripts/harness/realPrereqs";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "codex-real-prereqs-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe("detectRealPrereqs", () => {
  it("returns ready when binaries exist and auth is available from env", () => {
    const report = detectRealPrereqs({
      env: {
        OPENAI_API_KEY: "sk-test"
      },
      runCommand: (command, args) => {
        if (command === "which" && (args[0] === "codex" || args[0] === "ssh")) {
          return {
            status: 0,
            stdout: `/usr/bin/${args[0]}\n`,
            stderr: ""
          };
        }
        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      }
    });

    expect(report.status).toBe("ready");
    expect(report.checks.map((check) => check.status)).toEqual([
      "present",
      "present",
      "present"
    ]);
  });

  it("returns a structured skip when codex is missing", () => {
    const report = detectRealPrereqs({
      runCommand: (command, args) => {
        if (command === "which" && args[0] === "codex") {
          return { status: 1, stdout: "", stderr: "not found" };
        }
        if (command === "which" && args[0] === "ssh") {
          return { status: 0, stdout: "/usr/bin/ssh\n", stderr: "" };
        }
        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      }
    });

    expect(report).toMatchObject({
      status: "skipped",
      skipReasonCode: "codex-missing"
    });
  });

  it("returns a structured unauthenticated skip when codex auth is missing", () => {
    const report = detectRealPrereqs({
      runCommand: (command, args) => {
        if (command === "which") {
          return { status: 0, stdout: `/usr/bin/${args[0]}\n`, stderr: "" };
        }
        if (command === "codex" && args.join(" ") === "auth status") {
          return { status: 1, stdout: "", stderr: "not logged in" };
        }
        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      }
    });

    expect(report).toMatchObject({
      status: "skipped",
      skipReasonCode: "auth-missing"
    });
    expect(report.checks.at(-1)).toMatchObject({
      name: "auth",
      status: "unauthenticated"
    });
  });

  it("returns an unsupported skip when the CLI cannot report auth status", () => {
    const report = detectRealPrereqs({
      runCommand: (command, args) => {
        if (command === "which") {
          return { status: 0, stdout: `/usr/bin/${args[0]}\n`, stderr: "" };
        }
        if (command === "codex" && args.join(" ") === "auth status") {
          return { status: 1, stdout: "", stderr: "unknown command: auth" };
        }
        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      }
    });

    expect(report).toMatchObject({
      status: "skipped",
      skipReasonCode: "unsupported-environment"
    });
    expect(report.checks.at(-1)).toMatchObject({
      name: "auth",
      status: "unsupported"
    });
  });

  it("writes skipped prerequisite results into the shared harness summary layout", async () => {
    const userDataDir = await createTempDir();
    const contract = resolveHarnessRuntimeContract({
      cwd: userDataDir,
      env: {
        HARNESS_RUN_ID: "real-prereq-skip",
        HARNESS_MODE: "real",
        HARNESS_TARGET: "dev"
      }
    });
    const report = detectRealPrereqs({
      runCommand: (command, args) => {
        if (command === "which" && args[0] === "codex") {
          return { status: 1, stdout: "", stderr: "not found" };
        }
        if (command === "which" && args[0] === "ssh") {
          return { status: 0, stdout: "/usr/bin/ssh\n", stderr: "" };
        }
        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      }
    });

    const summaryPath = await writeRealPrereqSummary({
      contract,
      userDataDir,
      report
    });
    const summaryRaw = await readFile(summaryPath, "utf8");

    expect(summaryRaw).toContain("\"status\": \"skipped\"");
    expect(summaryRaw).toContain("codex:missing");
  });
});
