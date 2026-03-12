import { resolve } from "node:path";
import { runElectronHarness } from "../../test/harness/electronRunner";
import { detectRealPrereqs, writeRealPrereqSummary } from "./realPrereqs";
import {
  resolveHarnessRuntimeContract,
  type NodeHarnessRuntimeContract
} from "./resolveRuntimeContract";

export interface RunRealSmokeOptions {
  appRoot: string;
  contract: NodeHarnessRuntimeContract;
  runHarness?: typeof runElectronHarness;
  detectPrereqs?: typeof detectRealPrereqs;
  writeSkipSummary?: typeof writeRealPrereqSummary;
}

export const runRealSmoke = async ({
  appRoot,
  contract,
  runHarness = runElectronHarness,
  detectPrereqs = detectRealPrereqs,
  writeSkipSummary = writeRealPrereqSummary
}: RunRealSmokeOptions): Promise<number> => {
  const prereqReport = detectPrereqs({
    env: process.env
  });

  if (prereqReport.status !== "ready") {
    await writeSkipSummary({
      contract,
      userDataDir: resolve(appRoot, ".harness"),
      report: prereqReport
    });
    return contract.exitCodes.prerequisiteMissing;
  }

  const result = await runHarness({
    appRoot,
    contract,
    env: {
      HARNESS_MODE: "real",
      HARNESS_TARGET: contract.target,
      HARNESS_RUN_ID: contract.run.runId
    }
  });

  return result.status === "passed"
    ? contract.exitCodes.success
    : contract.exitCodes.unknownFailure;
};

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const contract = resolveHarnessRuntimeContract({
    cwd: process.cwd(),
    argv: process.argv.slice(2),
    env: {
      ...process.env,
      HARNESS_MODE: "real"
    }
  });
  const exitCode = await runRealSmoke({
    appRoot: resolve(process.cwd()),
    contract
  });
  process.exitCode = exitCode;
}
