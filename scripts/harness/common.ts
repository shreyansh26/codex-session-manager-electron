import { access, readdir, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import {
  diagnosticsRuntimeStateSchema,
  runSummarySchema,
  stateSnapshotSchema
} from "../../src/shared/diagnostics/contracts.ts";
import type { NodeHarnessRuntimeContract } from "./resolveRuntimeContract";

export interface HarnessRunFiles {
  runDirectoryPath: string;
  summaryPath: string;
  runtimeStatePath: string;
  runnerStatePath: string;
}

export const resolveRunFiles = (
  appRoot: string,
  contract: NodeHarnessRuntimeContract
): HarnessRunFiles => {
  const runDirectoryPath = join(
    resolve(appRoot, ".harness", contract.artifacts.root),
    contract.artifacts.runRelativeDirectory
  );

  return {
    runDirectoryPath,
    summaryPath: join(runDirectoryPath, "summary.json"),
    runtimeStatePath: join(runDirectoryPath, "runtime-state.json"),
    runnerStatePath: join(runDirectoryPath, "snapshots", "runner-state.json")
  };
};

export const findLatestRunDirectory = async (rootAbsolutePath: string): Promise<string | null> => {
  const runsDir = join(rootAbsolutePath, "runs");
  try {
    const entries = await readdir(runsDir, { withFileTypes: true });
    const directories = (
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            const summaryPath = join(runsDir, entry.name, "summary.json");
            try {
              await access(summaryPath, constants.R_OK);
              return {
                name: entry.name,
                modifiedAtMs: (await stat(join(runsDir, entry.name))).mtimeMs
              };
            } catch {
              return null;
            }
          })
      )
    ).filter(
      (entry): entry is { name: string; modifiedAtMs: number } => entry !== null
    );
    if (directories.length === 0) {
      return null;
    }
    directories.sort(
      (left, right) =>
        right.modifiedAtMs - left.modifiedAtMs || right.name.localeCompare(left.name)
    );
    return directories[0]?.name ?? null;
  } catch {
    return null;
  }
};

export const resolveArtifactRoot = async (
  appRoot: string,
  artifactRoot?: string
): Promise<string> => {
  const candidates = artifactRoot
    ? [resolve(appRoot, artifactRoot)]
    : [resolve(appRoot, ".harness", "diagnostics"), resolve(appRoot, "diagnostics")];

  for (const candidate of candidates) {
    try {
      const details = await stat(candidate);
      if (details.isDirectory()) {
        return candidate;
      }
    } catch {
      // Try next candidate.
    }
  }

  return candidates[0];
};

export const readRunSummary = async (summaryPath: string) =>
  runSummarySchema.parse(JSON.parse(await readFile(summaryPath, "utf8")));

export const readRuntimeState = async (runtimeStatePath: string) => {
  try {
    return diagnosticsRuntimeStateSchema.parse(
      JSON.parse(await readFile(runtimeStatePath, "utf8"))
    );
  } catch {
    return null;
  }
};

export const readRunnerState = async (runnerStatePath: string) => {
  try {
    return stateSnapshotSchema.parse(JSON.parse(await readFile(runnerStatePath, "utf8")));
  } catch {
    return null;
  }
};

export const getNestedValue = (value: unknown, pathExpression: string): unknown => {
  return pathExpression.split(".").reduce<unknown>((current, segment) => {
    if (!segment) {
      return current;
    }
    if (current && typeof current === "object" && segment in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, value);
};
