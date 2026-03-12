import { z } from "zod";

export const DIAGNOSTICS_SCHEMA_VERSION = 1 as const;

export const failureCategorySchema = z.enum([
  "blank-screen",
  "preload-missing",
  "bootstrap-timeout",
  "renderer-crash",
  "renderer-never-attached",
  "ipc-timeout",
  "console-error",
  "uncategorized"
]);
export type FailureCategory = z.infer<typeof failureCategorySchema>;

export const lifecycleEventNameSchema = z.enum([
  "main.window.created",
  "main.process-error",
  "preload.ready",
  "bootstrap.ready",
  "renderer.first-render",
  "renderer.console-error",
  "renderer.page-error",
  "main.render-process-gone",
  "ipc.request",
  "ipc.response",
  "theme.changed",
  "device.changed",
  "search.changed"
]);
export type LifecycleEventName = z.infer<typeof lifecycleEventNameSchema>;

export const diagnosticsMetadataSchema = z.record(z.string(), z.unknown());

export const lifecycleEventSchema = z.object({
  schemaVersion: z.literal(DIAGNOSTICS_SCHEMA_VERSION),
  runId: z.string().min(1),
  timestamp: z.string().min(1),
  event: lifecycleEventNameSchema,
  severity: z.enum(["info", "warn", "error"]),
  metadata: diagnosticsMetadataSchema.optional()
});
export type LifecycleEvent = z.infer<typeof lifecycleEventSchema>;

export const diagnosticsLifecycleRecordRequestSchema = z.object({
  event: lifecycleEventNameSchema,
  severity: z.enum(["info", "warn", "error"]).optional(),
  metadata: diagnosticsMetadataSchema.optional()
});
export type DiagnosticsLifecycleRecordRequest = z.infer<
  typeof diagnosticsLifecycleRecordRequestSchema
>;

export const metricsSnapshotSchema = z.object({
  schemaVersion: z.literal(DIAGNOSTICS_SCHEMA_VERSION),
  runId: z.string().min(1),
  timestamp: z.string().min(1),
  metrics: z.record(z.string(), z.number())
});
export type MetricsSnapshot = z.infer<typeof metricsSnapshotSchema>;

export const spanRecordSchema = z.object({
  schemaVersion: z.literal(DIAGNOSTICS_SCHEMA_VERSION),
  runId: z.string().min(1),
  spanId: z.string().min(1),
  parentSpanId: z.string().min(1).optional(),
  name: z.string().min(1),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1).optional(),
  attributes: diagnosticsMetadataSchema.optional()
});
export type SpanRecord = z.infer<typeof spanRecordSchema>;

export const diagnosticsStateSnapshotSchema = z.object({
  schemaVersion: z.literal(DIAGNOSTICS_SCHEMA_VERSION),
  runId: z.string().min(1),
  timestamp: z.string().min(1),
  label: z.string().min(1),
  state: z.unknown()
});
export type DiagnosticsStateSnapshot = z.infer<typeof diagnosticsStateSnapshotSchema>;

export const diagnosticsRuntimeStateSchema = z.object({
  schemaVersion: z.literal(DIAGNOSTICS_SCHEMA_VERSION),
  runId: z.string().min(1),
  mode: z.enum(["mock", "real"]),
  target: z.enum(["dev", "packaged"]),
  status: z.enum(["idle", "running", "failed"]),
  startedAt: z.string().min(1),
  updatedAt: z.string().min(1),
  milestones: z.array(lifecycleEventNameSchema),
  failureCategory: failureCategorySchema.optional(),
  notes: z.array(z.string()).default([]),
  lastEvent: lifecycleEventSchema.optional()
});
export type DiagnosticsRuntimeState = z.infer<typeof diagnosticsRuntimeStateSchema>;

export const artifactReferenceSchema = z.object({
  path: z.string().min(1),
  label: z.string().min(1).optional()
});
export type ArtifactReference = z.infer<typeof artifactReferenceSchema>;

export const stateSnapshotSchema = z.object({
  schemaVersion: z.literal(DIAGNOSTICS_SCHEMA_VERSION),
  runId: z.string().min(1),
  timestamp: z.string().min(1),
  label: z.string().min(1),
  state: z.unknown()
});
export type StateSnapshot = z.infer<typeof stateSnapshotSchema>;

export const diagnosticsStateSnapshotRequestSchema = z.object({
  label: z.string().min(1),
  state: z.unknown()
});
export type DiagnosticsStateSnapshotRequest = z.infer<
  typeof diagnosticsStateSnapshotRequestSchema
>;

export const runSummarySchema = z.object({
  schemaVersion: z.literal(DIAGNOSTICS_SCHEMA_VERSION),
  runId: z.string().min(1),
  mode: z.enum(["mock", "real"]),
  target: z.enum(["dev", "packaged"]),
  status: z.enum(["passed", "failed", "skipped"]),
  failureCategory: failureCategorySchema.optional(),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  milestones: z.array(lifecycleEventNameSchema),
  screenshot: artifactReferenceSchema.optional(),
  domSnapshot: artifactReferenceSchema.optional(),
  stateSnapshot: artifactReferenceSchema.optional(),
  notes: z.array(z.string()).default([])
});
export type RunSummary = z.infer<typeof runSummarySchema>;

export const diagnosticsFileLayout = {
  runsDirectory: "runs",
  logsFile: "logs.jsonl",
  metricsFile: "metrics.json",
  spansFile: "spans.jsonl",
  summaryFile: "summary.json",
  screenshotsDirectory: "screenshots",
  domDirectory: "dom",
  snapshotsDirectory: "snapshots",
  runtimeStateFile: "runtime-state.json"
} as const;

export const resolveRunArtifactLayout = (runId: string) => ({
  runDirectory: `${diagnosticsFileLayout.runsDirectory}/${runId}`,
  logsFile: `${diagnosticsFileLayout.runsDirectory}/${runId}/${diagnosticsFileLayout.logsFile}`,
  metricsFile: `${diagnosticsFileLayout.runsDirectory}/${runId}/${diagnosticsFileLayout.metricsFile}`,
  spansFile: `${diagnosticsFileLayout.runsDirectory}/${runId}/${diagnosticsFileLayout.spansFile}`,
  summaryFile: `${diagnosticsFileLayout.runsDirectory}/${runId}/${diagnosticsFileLayout.summaryFile}`,
  screenshotsDirectory: `${diagnosticsFileLayout.runsDirectory}/${runId}/${diagnosticsFileLayout.screenshotsDirectory}`,
  domDirectory: `${diagnosticsFileLayout.runsDirectory}/${runId}/${diagnosticsFileLayout.domDirectory}`,
  snapshotsDirectory: `${diagnosticsFileLayout.runsDirectory}/${runId}/${diagnosticsFileLayout.snapshotsDirectory}`
});
