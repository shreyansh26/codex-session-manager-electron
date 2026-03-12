import { resolve } from "node:path";
import { runElectronHarness } from "../../test/harness/electronRunner";
import { runChronologyScenario } from "../../test/harness/scenarios/chronologyScenario";
import {
  resolveHarnessRuntimeContract,
  type NodeHarnessRuntimeContract
} from "./resolveRuntimeContract";

export interface RunChronologySmokeOptions {
  appRoot: string;
  contract: NodeHarnessRuntimeContract;
  runHarness?: typeof runElectronHarness;
  entryScriptPath?: string;
  packagedExecutablePath?: string;
  userDataDir?: string;
}

export const runChronologySmoke = async ({
  appRoot,
  contract,
  runHarness = runElectronHarness,
  entryScriptPath,
  packagedExecutablePath,
  userDataDir
}: RunChronologySmokeOptions): Promise<number> => {
  const result = await runHarness({
    appRoot,
    contract,
    ...(entryScriptPath ? { entryScriptPath } : {}),
    ...(packagedExecutablePath ? { packagedExecutablePath } : {}),
    ...(userDataDir ? { userDataDir } : {}),
    env: {
      HARNESS_MODE: "mock",
      HARNESS_TARGET: contract.target,
      HARNESS_RUN_ID: contract.run.runId
    },
    afterAttach: runChronologyScenario
  });

  return result.status === "passed"
    ? contract.exitCodes.success
    : contract.exitCodes.assertionFailure;
};

const resolveCliEntryScript = (argv: string[], cwd: string): string => {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--entry" && argv[index + 1]) {
      return resolve(cwd, argv[index + 1]);
    }
  }

  return resolve(cwd, "out/main/index.js");
};

const resolveCliOptionValue = (
  argv: string[],
  flag: string,
  cwd: string
): string | undefined => {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === flag && argv[index + 1]) {
      return resolve(cwd, argv[index + 1]);
    }
    if (token.startsWith(`${flag}=`)) {
      return resolve(cwd, token.slice(flag.length + 1));
    }
  }
  return undefined;
};

const stripCliHarnessOptions = (argv: string[]): string[] => {
  const localFlags = new Set([
    "--entry",
    "--packaged-executable-path",
    "--app-root",
    "--user-data-dir"
  ]);

  return argv.filter((token, index, tokens) => {
    if (localFlags.has(token)) {
      return false;
    }
    if (index > 0 && localFlags.has(tokens[index - 1])) {
      return false;
    }
    for (const flag of localFlags) {
      if (token.startsWith(`${flag}=`)) {
        return false;
      }
    }
    return true;
  });
};

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const rawArgv = process.argv.slice(2);
  const argv = stripCliHarnessOptions(rawArgv);
  const contract = resolveHarnessRuntimeContract({
    cwd: process.cwd(),
    argv,
    env: {
      ...process.env,
      HARNESS_MODE: "mock"
    }
  });
  const exitCode = await runChronologySmoke({
    appRoot:
      resolveCliOptionValue(rawArgv, "--app-root", process.cwd()) ?? resolve(process.cwd()),
    contract,
    entryScriptPath: resolveCliEntryScript(rawArgv, process.cwd()),
    packagedExecutablePath: resolveCliOptionValue(
      rawArgv,
      "--packaged-executable-path",
      process.cwd()
    ),
    userDataDir: resolveCliOptionValue(rawArgv, "--user-data-dir", process.cwd())
  });
  process.exitCode = exitCode;
}
