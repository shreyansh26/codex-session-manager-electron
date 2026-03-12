import { join, resolve } from "node:path";
import {
  findLatestRunDirectory,
  getNestedValue,
  readNamedSnapshot,
  readRunnerState,
  readRunSummary,
  readRuntimeState,
  resolveArtifactRoot
} from "./common.ts";

export const queryHarnessArtifacts = async (options: {
  appRoot: string;
  artifactRoot?: string;
  runDirectoryName?: string;
  field: string;
}): Promise<unknown> => {
  const artifactRoot = await resolveArtifactRoot(options.appRoot, options.artifactRoot);
  const runDirectoryName =
    options.runDirectoryName ?? (await findLatestRunDirectory(artifactRoot));
  if (!runDirectoryName) {
    throw new Error(`No harness runs found under ${artifactRoot}.`);
  }

  const runDirectory = join(artifactRoot, "runs", runDirectoryName);
  const [summary, runtimeState, runnerState] = await Promise.all([
    readRunSummary(join(runDirectory, "summary.json")),
    readRuntimeState(join(runDirectory, "runtime-state.json")),
    readRunnerState(join(runDirectory, "snapshots", "runner-state.json"))
  ]);

  if (options.field.startsWith("snapshot:")) {
    const label = options.field.slice("snapshot:".length).trim();
    return readNamedSnapshot(runDirectory, label);
  }

  const value = getNestedValue(
    {
      summary,
      runtimeState,
      runnerState
    },
    options.field
  );

  return value;
};

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const field = process.argv[2];
  if (!field) {
    throw new Error("Usage: node --experimental-strip-types scripts/harness/query.ts <field>");
  }
  const runDirectoryName = process.argv[3];
  const value = await queryHarnessArtifacts({
    appRoot: resolve(process.cwd()),
    field,
    ...(runDirectoryName ? { runDirectoryName } : {})
  });
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
