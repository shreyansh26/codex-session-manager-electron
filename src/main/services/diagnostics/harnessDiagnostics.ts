import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  diagnosticsRuntimeStateSchema,
  metricsSnapshotSchema,
  type FailureCategory,
  lifecycleEventSchema,
  type LifecycleEventName
} from "../../../shared/diagnostics/contracts";
import {
  parseHarnessRuntimeContract,
  type HarnessMode,
  type HarnessTarget
} from "../../../shared/harness/runContract";
import { writeJsonFileAtomic } from "../storage/jsonFileStore";

const REDACTED_KEYS = new Set([
  "stack",
  "identityFile",
  "workspaceRoot",
  "codexBin",
  "sourceRoot",
  "homeDir",
  "appDataDir",
  "cwd"
]);

export interface HarnessDiagnostics {
  isEnabled: () => boolean;
  getRunId: () => string | null;
  recordLifecycle: (
    event: LifecycleEventName,
    severity?: "info" | "warn" | "error",
    metadata?: Record<string, unknown>
  ) => Promise<void>;
  recordFailure: (
    event: LifecycleEventName,
    error: unknown,
    metadata?: Record<string, unknown>
  ) => Promise<FailureCategory>;
  snapshotState: (label: string, state: unknown) => Promise<void>;
  getFailureCategory: () => FailureCategory | null;
}

interface ActiveHarnessContext {
  runId: string;
  diagnosticsRoot: string;
  runRelativeDirectory: string;
  mode: HarnessMode;
  target: HarnessTarget;
  startedAt: string;
}

interface StateSnapshotPayload {
  schemaVersion: 1;
  runId: string;
  label: string;
  timestamp: string;
  state: unknown;
}

class NoopHarnessDiagnostics implements HarnessDiagnostics {
  isEnabled(): boolean {
    return false;
  }

  getRunId(): string | null {
    return null;
  }

  async recordLifecycle(): Promise<void> {}

  async recordFailure(): Promise<FailureCategory> {
    return "uncategorized";
  }

  async snapshotState(): Promise<void> {}

  getFailureCategory(): FailureCategory | null {
    return null;
  }
}

class ActiveHarnessDiagnostics implements HarnessDiagnostics {
  private failureCategory: FailureCategory | null = null;
  private readonly milestones = new Set<LifecycleEventName>();
  private lastEvent:
    | ReturnType<typeof lifecycleEventSchema.parse>
    | null = null;
  private readonly metrics = {
    lifecycleEvents: 0,
    errorEvents: 0,
    snapshotsWritten: 0
  };

  constructor(
    private readonly context: ActiveHarnessContext,
    private readonly nowIso: () => string = () => new Date().toISOString()
  ) {}

  isEnabled(): boolean {
    return true;
  }

  getRunId(): string | null {
    return this.context.runId;
  }

  async recordLifecycle(
    event: LifecycleEventName,
    severity: "info" | "warn" | "error" = "info",
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const payload = lifecycleEventSchema.parse({
      schemaVersion: 1,
      runId: this.context.runId,
      timestamp: this.nowIso(),
      event,
      severity,
      ...(metadata ? { metadata: sanitizeDiagnosticsValue(metadata) } : {})
    });
    if (isMilestoneEvent(event)) {
      this.milestones.add(event);
    }
    this.lastEvent = payload;
    this.metrics.lifecycleEvents += 1;
    if (severity === "error") {
      this.metrics.errorEvents += 1;
    }
    await this.appendJsonLine("logs.jsonl", payload);
    await this.writeRuntimeState("running");
    await this.writeMetrics();
  }

  async recordFailure(
    event: LifecycleEventName,
    error: unknown,
    metadata?: Record<string, unknown>
  ): Promise<FailureCategory> {
    const category = classifyFailure(event, error);
    this.failureCategory = category;
    await this.recordLifecycle(event, "error", {
      failureCategory: category,
      error: toErrorSummary(error),
      ...metadata
    });
    return category;
  }

  async snapshotState(label: string, state: unknown): Promise<void> {
    const fileName = `${sanitizeSnapshotLabel(label)}.json`;
    const snapshot: StateSnapshotPayload = {
      schemaVersion: 1,
      runId: this.context.runId,
      label,
      timestamp: this.nowIso(),
      state: sanitizeDiagnosticsValue(state)
    };
    await writeJsonFileAtomic(
      join(
        this.context.diagnosticsRoot,
        this.context.runRelativeDirectory,
        "snapshots",
        fileName
      ),
      snapshot
    );
    this.metrics.snapshotsWritten += 1;
    await this.writeRuntimeState("running");
    await this.writeMetrics();
  }

  getFailureCategory(): FailureCategory | null {
    return this.failureCategory;
  }

  private async appendJsonLine(relativePath: string, payload: unknown): Promise<void> {
    const target = join(
      this.context.diagnosticsRoot,
      this.context.runRelativeDirectory,
      relativePath
    );
    await mkdir(dirname(target), { recursive: true });
    await appendFile(target, `${JSON.stringify(payload)}\n`, "utf8");
  }

  private async writeRuntimeState(status: "idle" | "running" | "failed"): Promise<void> {
    await writeJsonFileAtomic(
      join(
        this.context.diagnosticsRoot,
        this.context.runRelativeDirectory,
        "runtime-state.json"
      ),
      diagnosticsRuntimeStateSchema.parse({
        schemaVersion: 1,
        runId: this.context.runId,
        mode: this.context.mode,
        target: this.context.target,
        status,
        startedAt: this.context.startedAt,
        updatedAt: this.nowIso(),
        milestones: [...this.milestones],
        ...(this.failureCategory ? { failureCategory: this.failureCategory } : {}),
        notes: [],
        ...(this.lastEvent ? { lastEvent: this.lastEvent } : {})
      })
    );
  }

  private async writeMetrics(): Promise<void> {
    await writeJsonFileAtomic(
      join(
        this.context.diagnosticsRoot,
        this.context.runRelativeDirectory,
        "metrics.json"
      ),
      metricsSnapshotSchema.parse({
        schemaVersion: 1,
        runId: this.context.runId,
        timestamp: this.nowIso(),
        metrics: this.metrics
      })
    );
  }
}

export const createHarnessDiagnostics = (options: {
  userDataDir: string;
  env?: Readonly<Record<string, string | undefined>>;
  nowIso?: () => string;
}): HarnessDiagnostics => {
  const env = options.env ?? process.env;
  const runId = env.HARNESS_RUN_ID?.trim();
  if (!runId) {
    return new NoopHarnessDiagnostics();
  }

  const contract = parseHarnessRuntimeContract({ env });
  return new ActiveHarnessDiagnostics(
    {
      runId: contract.run.runId,
      diagnosticsRoot: join(options.userDataDir, contract.artifacts.root),
      runRelativeDirectory: contract.artifacts.runRelativeDirectory,
      mode: contract.mode,
      target: contract.target,
      startedAt: contract.run.startedAtIso
    },
    options.nowIso
  );
};

const isMilestoneEvent = (event: LifecycleEventName): boolean =>
  event === "main.window.created" ||
  event === "preload.ready" ||
  event === "bootstrap.ready" ||
  event === "renderer.first-render";

export const classifyFailure = (
  event: LifecycleEventName,
  error: unknown
): FailureCategory => {
  const message = normalizeFailureText(error);

  if (event === "main.render-process-gone") {
    return "renderer-crash";
  }
  if (event === "main.process-error" && message.includes("bootstrap")) {
    return "bootstrap-timeout";
  }
  if (event === "renderer.page-error" && message.includes("preload")) {
    return "preload-missing";
  }
  if (message.includes("ipc handler timed out") || message.includes("ipc timeout")) {
    return "ipc-timeout";
  }
  if (message.includes("bootstrap") && message.includes("timed out")) {
    return "bootstrap-timeout";
  }
  if (event === "renderer.console-error") {
    return "console-error";
  }
  if (event === "renderer.page-error" && message.includes("blank")) {
    return "blank-screen";
  }
  return "uncategorized";
};

export const sanitizeDiagnosticsValue = (
  value: unknown,
  seen = new WeakSet<object>()
): unknown => {
  if (value instanceof Error) {
    return toErrorSummary(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDiagnosticsValue(entry, seen));
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        REDACTED_KEYS.has(key)
          ? "[REDACTED]"
          : sanitizeDiagnosticsValue(entry, seen)
      ])
    );
  }

  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }

  return value;
};

const sanitizeSnapshotLabel = (label: string): string =>
  label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "") || "snapshot";

const normalizeFailureText = (value: unknown): string =>
  value instanceof Error
    ? `${value.name} ${value.message}`.toLowerCase()
    : String(value).toLowerCase();

const toErrorSummary = (error: unknown): Record<string, unknown> =>
  error instanceof Error
    ? {
        name: error.name,
        message: error.message
      }
    : {
        message: String(error)
      };
