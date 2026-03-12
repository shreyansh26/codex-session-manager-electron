export const HARNESS_RUNTIME_CONTRACT_VERSION = 1 as const;

export const HARNESS_MODE_VALUES = ["mock", "real"] as const;
export type HarnessMode = (typeof HARNESS_MODE_VALUES)[number];

export const HARNESS_TARGET_VALUES = ["dev", "packaged"] as const;
export type HarnessTarget = (typeof HARNESS_TARGET_VALUES)[number];

export const HARNESS_EXIT_CODES = Object.freeze({
  success: 0,
  invalidContractInput: 2,
  prerequisiteMissing: 3,
  launchFailure: 4,
  attachTimeout: 5,
  bootstrapTimeout: 6,
  scenarioTimeout: 7,
  assertionFailure: 8,
  appCrash: 9,
  artifactWriteFailure: 10,
  cleanupFailure: 11,
  unknownFailure: 12
});

export type HarnessExitCode = (typeof HARNESS_EXIT_CODES)[keyof typeof HARNESS_EXIT_CODES];

export interface HarnessTimeoutPolicy {
  attachMs: number;
  bootstrapMs: number;
  scenarioMs: number;
  finalizeMs: number;
  totalMs: number;
}

export interface HarnessRetentionPolicy {
  cleanupOnStart: boolean;
  keepLatestRuns: number;
  maxRuns: number;
  maxAgeMs: number;
}

export interface HarnessRunMetadata {
  runId: string;
  startedAtIso: string;
  startedAtEpochMs: number;
}

export interface HarnessArtifactContract {
  root: string;
  runsDirectoryName: "runs";
  runDirectoryName: string;
  runRelativeDirectory: string;
}

export type HarnessInputSource = "cli" | "env" | "default";

export interface HarnessInputSources {
  mode: HarnessInputSource;
  target: HarnessInputSource;
  runId: HarnessInputSource;
  artifactRoot: HarnessInputSource;
}

export interface HarnessRuntimeContract {
  version: typeof HARNESS_RUNTIME_CONTRACT_VERSION;
  mode: HarnessMode;
  target: HarnessTarget;
  run: HarnessRunMetadata;
  artifacts: HarnessArtifactContract;
  timeout: HarnessTimeoutPolicy;
  retention: HarnessRetentionPolicy;
  exitCodes: typeof HARNESS_EXIT_CODES;
  sources: HarnessInputSources;
}

export interface ParseHarnessRuntimeContractInput {
  argv?: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
  now?: Date;
}

export interface HarnessStoredRunRecord {
  directoryName: string;
  startedAtEpochMs: number;
}

export const DEFAULT_HARNESS_MODE: HarnessMode = "mock";
export const DEFAULT_HARNESS_TARGET: HarnessTarget = "dev";
export const DEFAULT_HARNESS_ARTIFACT_ROOT = "diagnostics";

export const DEFAULT_HARNESS_TIMEOUT_POLICY: HarnessTimeoutPolicy = Object.freeze({
  attachMs: 15_000,
  bootstrapMs: 20_000,
  scenarioMs: 30_000,
  finalizeMs: 10_000,
  totalMs: 90_000
});

export const DEFAULT_HARNESS_RETENTION_POLICY: HarnessRetentionPolicy = Object.freeze({
  cleanupOnStart: true,
  keepLatestRuns: 5,
  maxRuns: 40,
  maxAgeMs: 7 * 24 * 60 * 60 * 1000
});

const RUN_ID_MAX_LENGTH = 64;

const CLI_OPTION_KEYS = new Set([
  "run-id",
  "mode",
  "target",
  "artifact-root",
  "timeout-attach-ms",
  "timeout-bootstrap-ms",
  "timeout-scenario-ms",
  "timeout-finalize-ms",
  "timeout-total-ms",
  "retention-cleanup-on-start",
  "retention-keep-latest-runs",
  "retention-max-runs",
  "retention-max-age-hours"
]);

interface ParsedCliOptions {
  runId?: string;
  mode?: string;
  target?: string;
  artifactRoot?: string;
  timeoutAttachMs?: string;
  timeoutBootstrapMs?: string;
  timeoutScenarioMs?: string;
  timeoutFinalizeMs?: string;
  timeoutTotalMs?: string;
  retentionCleanupOnStart?: string;
  retentionKeepLatestRuns?: string;
  retentionMaxRuns?: string;
  retentionMaxAgeHours?: string;
}

export class HarnessContractError extends Error {
  readonly key: string;

  constructor(key: string, message: string) {
    super(message);
    this.name = "HarnessContractError";
    this.key = key;
  }
}

const cliKeyToProperty = (key: string): keyof ParsedCliOptions => {
  switch (key) {
    case "run-id":
      return "runId";
    case "mode":
      return "mode";
    case "target":
      return "target";
    case "artifact-root":
      return "artifactRoot";
    case "timeout-attach-ms":
      return "timeoutAttachMs";
    case "timeout-bootstrap-ms":
      return "timeoutBootstrapMs";
    case "timeout-scenario-ms":
      return "timeoutScenarioMs";
    case "timeout-finalize-ms":
      return "timeoutFinalizeMs";
    case "timeout-total-ms":
      return "timeoutTotalMs";
    case "retention-cleanup-on-start":
      return "retentionCleanupOnStart";
    case "retention-keep-latest-runs":
      return "retentionKeepLatestRuns";
    case "retention-max-runs":
      return "retentionMaxRuns";
    case "retention-max-age-hours":
      return "retentionMaxAgeHours";
    default:
      throw new HarnessContractError("cli", `Unsupported CLI option: --${key}`);
  }
};

const parseCliOptions = (argv: readonly string[]): ParsedCliOptions => {
  const options: ParsedCliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new HarnessContractError(
        "cli",
        `Unexpected positional argument: ${token}. Expected --key value pairs.`
      );
    }

    const withoutPrefix = token.slice(2);
    const eqIndex = withoutPrefix.indexOf("=");

    const key = eqIndex >= 0 ? withoutPrefix.slice(0, eqIndex) : withoutPrefix;
    if (!CLI_OPTION_KEYS.has(key)) {
      throw new HarnessContractError("cli", `Unsupported CLI option: --${key}`);
    }

    const optionProperty = cliKeyToProperty(key);
    let value: string | undefined;

    if (eqIndex >= 0) {
      value = withoutPrefix.slice(eqIndex + 1);
    } else {
      const nextToken = argv[index + 1];
      if (nextToken && !nextToken.startsWith("--")) {
        value = nextToken;
        index += 1;
      } else if (key === "retention-cleanup-on-start") {
        value = "true";
      }
    }

    if (value === undefined) {
      throw new HarnessContractError("cli", `Option --${key} requires a value.`);
    }

    options[optionProperty] = value;
  }

  return options;
};

const normalizeArtifactRoot = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new HarnessContractError("artifactRoot", "Artifact root must not be empty.");
  }
  return trimmed.replace(/[\\/]+$/g, "");
};

const normalizeRunId = (value: string): string => {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");

  if (sanitized.length === 0) {
    throw new HarnessContractError("runId", "Run ID must contain at least one alphanumeric character.");
  }

  if (sanitized.length > RUN_ID_MAX_LENGTH) {
    throw new HarnessContractError(
      "runId",
      `Run ID must be ${RUN_ID_MAX_LENGTH} characters or fewer after normalization.`
    );
  }

  return sanitized;
};

const parseEnumValue = <T extends string>(
  rawValue: string,
  values: readonly T[],
  key: string
): T => {
  if (values.includes(rawValue as T)) {
    return rawValue as T;
  }

  throw new HarnessContractError(
    key,
    `Invalid ${key}: ${rawValue}. Expected one of: ${values.join(", ")}.`
  );
};

const parsePositiveInt = (value: string, key: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HarnessContractError(key, `Invalid ${key}: ${value}. Expected a positive integer.`);
  }
  return parsed;
};

const parseBooleanValue = (value: string, key: string): boolean => {
  if (/^(1|true|yes|on)$/i.test(value)) {
    return true;
  }
  if (/^(0|false|no|off)$/i.test(value)) {
    return false;
  }

  throw new HarnessContractError(
    key,
    `Invalid ${key}: ${value}. Expected true/false, 1/0, yes/no, or on/off.`
  );
};

const formatRunTimestamp = (date: Date): string =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .toLowerCase();

const buildDefaultRunId = (date: Date): string => `run-${formatRunTimestamp(date)}`;

const pickString = (
  cliValue: string | undefined,
  envValue: string | undefined,
  fallback: string
): { value: string; source: HarnessInputSource } => {
  if (cliValue !== undefined) {
    return { value: cliValue, source: "cli" };
  }
  if (envValue !== undefined) {
    return { value: envValue, source: "env" };
  }
  return { value: fallback, source: "default" };
};

const pickNumber = (
  cliValue: string | undefined,
  envValue: string | undefined,
  fallback: number,
  key: string
): number => {
  if (cliValue !== undefined) {
    return parsePositiveInt(cliValue, key);
  }
  if (envValue !== undefined) {
    return parsePositiveInt(envValue, key);
  }
  return fallback;
};

const pickBoolean = (
  cliValue: string | undefined,
  envValue: string | undefined,
  fallback: boolean,
  key: string
): boolean => {
  if (cliValue !== undefined) {
    return parseBooleanValue(cliValue, key);
  }
  if (envValue !== undefined) {
    return parseBooleanValue(envValue, key);
  }
  return fallback;
};

const joinPathSegments = (...segments: string[]): string => segments.join("/");

const resolveTimeoutPolicy = (
  cliOptions: ParsedCliOptions,
  env: Readonly<Record<string, string | undefined>>
): HarnessTimeoutPolicy => {
  const timeout = {
    attachMs: pickNumber(
      cliOptions.timeoutAttachMs,
      env.HARNESS_TIMEOUT_ATTACH_MS,
      DEFAULT_HARNESS_TIMEOUT_POLICY.attachMs,
      "timeout.attachMs"
    ),
    bootstrapMs: pickNumber(
      cliOptions.timeoutBootstrapMs,
      env.HARNESS_TIMEOUT_BOOTSTRAP_MS,
      DEFAULT_HARNESS_TIMEOUT_POLICY.bootstrapMs,
      "timeout.bootstrapMs"
    ),
    scenarioMs: pickNumber(
      cliOptions.timeoutScenarioMs,
      env.HARNESS_TIMEOUT_SCENARIO_MS,
      DEFAULT_HARNESS_TIMEOUT_POLICY.scenarioMs,
      "timeout.scenarioMs"
    ),
    finalizeMs: pickNumber(
      cliOptions.timeoutFinalizeMs,
      env.HARNESS_TIMEOUT_FINALIZE_MS,
      DEFAULT_HARNESS_TIMEOUT_POLICY.finalizeMs,
      "timeout.finalizeMs"
    ),
    totalMs: pickNumber(
      cliOptions.timeoutTotalMs,
      env.HARNESS_TIMEOUT_TOTAL_MS,
      DEFAULT_HARNESS_TIMEOUT_POLICY.totalMs,
      "timeout.totalMs"
    )
  };

  if (timeout.totalMs < timeout.attachMs + timeout.bootstrapMs + timeout.scenarioMs) {
    throw new HarnessContractError(
      "timeout.totalMs",
      "timeout.totalMs must be greater than or equal to attach+bootstrap+scenario timeouts."
    );
  }

  return timeout;
};

const resolveRetentionPolicy = (
  cliOptions: ParsedCliOptions,
  env: Readonly<Record<string, string | undefined>>
): HarnessRetentionPolicy => {
  const keepLatestRuns = pickNumber(
    cliOptions.retentionKeepLatestRuns,
    env.HARNESS_RETENTION_KEEP_LATEST_RUNS,
    DEFAULT_HARNESS_RETENTION_POLICY.keepLatestRuns,
    "retention.keepLatestRuns"
  );
  const maxRuns = pickNumber(
    cliOptions.retentionMaxRuns,
    env.HARNESS_RETENTION_MAX_RUNS,
    DEFAULT_HARNESS_RETENTION_POLICY.maxRuns,
    "retention.maxRuns"
  );

  const maxAgeHours = pickNumber(
    cliOptions.retentionMaxAgeHours,
    env.HARNESS_RETENTION_MAX_AGE_HOURS,
    DEFAULT_HARNESS_RETENTION_POLICY.maxAgeMs / (60 * 60 * 1000),
    "retention.maxAgeHours"
  );

  if (keepLatestRuns > maxRuns) {
    throw new HarnessContractError(
      "retention.keepLatestRuns",
      "retention.keepLatestRuns must be less than or equal to retention.maxRuns."
    );
  }

  return {
    cleanupOnStart: pickBoolean(
      cliOptions.retentionCleanupOnStart,
      env.HARNESS_RETENTION_CLEANUP_ON_START,
      DEFAULT_HARNESS_RETENTION_POLICY.cleanupOnStart,
      "retention.cleanupOnStart"
    ),
    keepLatestRuns,
    maxRuns,
    maxAgeMs: maxAgeHours * 60 * 60 * 1000
  };
};

export interface BuildRunDirectoryNameInput {
  runId: string;
  mode: HarnessMode;
  target: HarnessTarget;
}

export const buildRunDirectoryName = ({
  runId,
  mode,
  target
}: BuildRunDirectoryNameInput): string => `${runId}--${mode}--${target}`;

export const parseHarnessRuntimeContract = (
  input: ParseHarnessRuntimeContractInput = {}
): HarnessRuntimeContract => {
  const argv = input.argv ?? [];
  const env = input.env ?? {};
  const now = input.now ?? new Date();

  const cliOptions = parseCliOptions(argv);

  const modeValue = pickString(cliOptions.mode, env.HARNESS_MODE, DEFAULT_HARNESS_MODE);
  const targetValue = pickString(
    cliOptions.target,
    env.HARNESS_TARGET,
    DEFAULT_HARNESS_TARGET
  );
  const runIdValue = pickString(
    cliOptions.runId,
    env.HARNESS_RUN_ID,
    buildDefaultRunId(now)
  );
  const artifactRootValue = pickString(
    cliOptions.artifactRoot,
    env.HARNESS_ARTIFACT_ROOT,
    DEFAULT_HARNESS_ARTIFACT_ROOT
  );

  const mode = parseEnumValue(modeValue.value, HARNESS_MODE_VALUES, "mode");
  const target = parseEnumValue(targetValue.value, HARNESS_TARGET_VALUES, "target");
  const runId = normalizeRunId(runIdValue.value);
  const runDirectoryName = buildRunDirectoryName({ runId, mode, target });
  const artifactRoot = normalizeArtifactRoot(artifactRootValue.value);

  return {
    version: HARNESS_RUNTIME_CONTRACT_VERSION,
    mode,
    target,
    run: {
      runId,
      startedAtIso: now.toISOString(),
      startedAtEpochMs: now.getTime()
    },
    artifacts: {
      root: artifactRoot,
      runsDirectoryName: "runs",
      runDirectoryName,
      runRelativeDirectory: joinPathSegments("runs", runDirectoryName)
    },
    timeout: resolveTimeoutPolicy(cliOptions, env),
    retention: resolveRetentionPolicy(cliOptions, env),
    exitCodes: HARNESS_EXIT_CODES,
    sources: {
      mode: modeValue.source,
      target: targetValue.source,
      runId: runIdValue.source,
      artifactRoot: artifactRootValue.source
    }
  };
};

const descendingByTime = (a: HarnessStoredRunRecord, b: HarnessStoredRunRecord): number => {
  if (a.startedAtEpochMs !== b.startedAtEpochMs) {
    return b.startedAtEpochMs - a.startedAtEpochMs;
  }
  return a.directoryName.localeCompare(b.directoryName);
};

const ascendingByTime = (a: HarnessStoredRunRecord, b: HarnessStoredRunRecord): number => {
  if (a.startedAtEpochMs !== b.startedAtEpochMs) {
    return a.startedAtEpochMs - b.startedAtEpochMs;
  }
  return a.directoryName.localeCompare(b.directoryName);
};

export const selectRunDirectoriesForCleanup = (
  runRecords: readonly HarnessStoredRunRecord[],
  retentionPolicy: HarnessRetentionPolicy,
  nowEpochMs: number
): string[] => {
  if (!retentionPolicy.cleanupOnStart || runRecords.length === 0) {
    return [];
  }

  const sortedNewest = [...runRecords].sort(descendingByTime);
  const protectedDirectories = new Set(
    sortedNewest.slice(0, retentionPolicy.keepLatestRuns).map((record) => record.directoryName)
  );

  const toDelete = new Set<string>();

  for (const record of runRecords) {
    if (protectedDirectories.has(record.directoryName)) {
      continue;
    }

    if (nowEpochMs - record.startedAtEpochMs > retentionPolicy.maxAgeMs) {
      toDelete.add(record.directoryName);
    }
  }

  let remainingCount = runRecords.length - toDelete.size;
  const sortedOldest = [...runRecords].sort(ascendingByTime);

  for (const record of sortedOldest) {
    if (remainingCount <= retentionPolicy.maxRuns) {
      break;
    }

    if (protectedDirectories.has(record.directoryName) || toDelete.has(record.directoryName)) {
      continue;
    }

    toDelete.add(record.directoryName);
    remainingCount -= 1;
  }

  return sortedOldest
    .filter((record) => toDelete.has(record.directoryName))
    .map((record) => record.directoryName);
};
