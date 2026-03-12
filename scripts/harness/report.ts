import { join, resolve } from "node:path";
import {
  findLatestRunDirectory,
  readRunnerState,
  readRunSummary,
  readRuntimeState,
  resolveArtifactRoot
} from "./common.ts";

export interface HarnessReport {
  runDirectory: string;
  status: "passed" | "failed" | "skipped";
  probableCause: string;
  failureCategory?: string;
  missingMilestones: string[];
  notes: string[];
}

export const buildHarnessReport = async (options: {
  appRoot: string;
  artifactRoot?: string;
  runDirectoryName?: string;
}): Promise<HarnessReport> => {
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

  const missingMilestones = [
    "main.window.created",
    "preload.ready",
    "bootstrap.ready",
    "renderer.first-render"
  ].filter((milestone) => !summary.milestones.includes(milestone as never));

  return {
    runDirectory,
    status: summary.status,
    ...(summary.failureCategory ? { failureCategory: summary.failureCategory } : {}),
    probableCause: inferProbableCause(
      summary.status,
      summary.failureCategory,
      missingMilestones,
      summary.notes,
      runnerState
    ),
    missingMilestones,
    notes: runtimeState?.notes?.length ? runtimeState.notes : summary.notes
  };
};

const inferProbableCause = (
  status: HarnessReport["status"],
  failureCategory: string | undefined,
  missingMilestones: string[],
  notes: string[],
  runnerState: { state?: unknown } | null
): string => {
  if (status === "passed") {
    return "Run completed successfully.";
  }
  if (status === "skipped") {
    return notes.find((note) => note.startsWith("skipReasonCode:")) ?? "skipped";
  }
  if (failureCategory) {
    return failureCategory;
  }
  if (missingMilestones.includes("preload.ready")) {
    return "preload-missing";
  }
  if (missingMilestones.includes("renderer.first-render")) {
    return "blank-screen";
  }
  if (notes.some((note) => note.includes("skipReasonCode:"))) {
    return notes.find((note) => note.includes("skipReasonCode:")) ?? "skipped";
  }
  if (runnerState?.state) {
    return "Runner state snapshot is available for inspection.";
  }
  return "uncategorized";
};

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const runDirectoryName = process.argv[2];
  const report = await buildHarnessReport({
    appRoot: resolve(process.cwd()),
    runDirectoryName
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
