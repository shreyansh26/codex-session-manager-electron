import type { ZodError } from "zod";
import {
  migrationStateSchema,
  persistedDevicesSchema,
  persistedSearchIndexSchema,
  type DeviceRecordSchemaType,
  type MigrationState,
  type PersistedDevices,
  type PersistedSearchIndex
} from "../../../shared/schema/contracts";
import {
  backupFileIfExists,
  pathExists,
  readJsonFile,
  writeJsonFileAtomic
} from "../storage/jsonFileStore";
import {
  getElectronStatePaths,
  resolveBackupPath,
  resolveTauriCandidateRoots,
  resolveTauriDevicesPath,
  resolveTauriSearchIndexPath,
  type TauriPathResolutionOptions
} from "../storage/statePaths";

export interface MigrationLogger {
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  info: (message: string, metadata?: Record<string, unknown>) => void;
}

export interface ImportTauriStateOptions extends TauriPathResolutionOptions {
  electronUserDataDir: string;
  now?: () => Date;
  logger?: MigrationLogger;
}

export interface ImportTauriStateResult {
  status: MigrationState["tauriImport"]["status"];
  sourceRoot?: string;
  importedDeviceCount: number;
  importedSearchSessionCount: number;
  warnings: string[];
}

const noopLogger: MigrationLogger = {
  warn: () => undefined,
  info: () => undefined
};

export const importTauriState = async (
  options: ImportTauriStateOptions
): Promise<ImportTauriStateResult> => {
  const logger = options.logger ?? noopLogger;
  const now = options.now ?? (() => new Date());
  const electronPaths = getElectronStatePaths(options.electronUserDataDir);

  const existingMigrationState = await safeReadMigrationState(
    electronPaths.migrationStatePath,
    logger
  );
  if (
    existingMigrationState &&
    (existingMigrationState.tauriImport.status === "completed" ||
      existingMigrationState.tauriImport.status === "skipped")
  ) {
    return toImportResult(existingMigrationState);
  }

  const alreadyInitialized = await hasExistingElectronState(electronPaths);
  if (alreadyInitialized && !existingMigrationState) {
    const skippedState = buildMigrationState({
      status: "skipped",
      now,
      errorCode: "already-initialized"
    });
    await writeJsonFileAtomic(electronPaths.migrationStatePath, skippedState);
    return toImportResult(skippedState);
  }

  const sourceRoot = await findTauriSourceRoot(options);
  if (!sourceRoot) {
    const skippedState = buildMigrationState({
      status: "skipped",
      now,
      errorCode: "tauri-source-missing"
    });
    await writeJsonFileAtomic(electronPaths.migrationStatePath, skippedState);
    return toImportResult(skippedState);
  }

  const pendingState = buildMigrationState({
    status: "pending",
    now,
    sourceRoot
  });
  await writeJsonFileAtomic(electronPaths.migrationStatePath, pendingState);

  const warnings: string[] = [];
  const importedDevices = await safeReadPersistedDevices(
    resolveTauriDevicesPath(sourceRoot),
    warnings,
    logger
  );
  const importedSearchIndex = await safeReadPersistedSearchIndex(
    resolveTauriSearchIndexPath(sourceRoot),
    warnings,
    logger
  );

  let importedDeviceCount = 0;
  let importedSearchSessionCount = 0;

  try {
    if (importedDevices) {
      const sanitizedDevices = sanitizePersistedDevices(importedDevices);
      await maybeBackupTarget(electronPaths.devicesPath, now);
      await writeJsonFileAtomic(electronPaths.devicesPath, sanitizedDevices);
      importedDeviceCount = sanitizedDevices.devices.length;
    }

    if (importedSearchIndex) {
      await maybeBackupTarget(electronPaths.searchIndexPath, now);
      await writeJsonFileAtomic(electronPaths.searchIndexPath, importedSearchIndex);
      importedSearchSessionCount = importedSearchIndex.sessions.length;
    }
  } catch (error) {
    const failureState = buildMigrationState({
      status: "failed",
      now,
      sourceRoot,
      importedDeviceCount,
      importedSearchSessionCount,
      errorCode: toErrorCode(error)
    });
    await writeJsonFileAtomic(electronPaths.migrationStatePath, failureState);
    logger.warn("Failed to import Tauri state", {
      sourceRoot,
      error: formatError(error)
    });
    return {
      ...toImportResult(failureState),
      warnings
    };
  }

  const status =
    importedDeviceCount > 0 || importedSearchSessionCount > 0 ? "completed" : "failed";
  const state = buildMigrationState({
    status,
    now,
    sourceRoot,
    importedDeviceCount,
    importedSearchSessionCount,
    errorCode: status === "failed" ? "tauri-source-invalid" : undefined
  });
  await writeJsonFileAtomic(electronPaths.migrationStatePath, state);

  if (status === "failed") {
    logger.warn("No valid Tauri state could be imported", {
      sourceRoot,
      warnings
    });
  } else {
    logger.info("Imported Tauri state into Electron store", {
      sourceRoot,
      importedDeviceCount,
      importedSearchSessionCount
    });
  }

  return {
    ...toImportResult(state),
    warnings
  };
};

const safeReadMigrationState = async (
  filePath: string,
  logger: MigrationLogger
): Promise<MigrationState | null> => {
  try {
    return await readJsonFile(filePath, migrationStateSchema);
  } catch (error) {
    logger.warn("Ignoring invalid Electron migration state", {
      filePath,
      error: formatError(error)
    });
    return null;
  }
};

const hasExistingElectronState = async (
  electronPaths: ReturnType<typeof getElectronStatePaths>
): Promise<boolean> => {
  const existing = await Promise.all([
    pathExists(electronPaths.devicesPath),
    pathExists(electronPaths.searchIndexPath),
    pathExists(electronPaths.preferencesPath),
    pathExists(electronPaths.migrationStatePath)
  ]);

  return existing.some(Boolean);
};

const findTauriSourceRoot = async (
  options: TauriPathResolutionOptions
): Promise<string | null> => {
  for (const candidateRoot of resolveTauriCandidateRoots(options)) {
    const [hasDevices, hasSearchIndex] = await Promise.all([
      pathExists(resolveTauriDevicesPath(candidateRoot)),
      pathExists(resolveTauriSearchIndexPath(candidateRoot))
    ]);
    if (hasDevices || hasSearchIndex) {
      return candidateRoot;
    }
  }
  return null;
};

const safeReadPersistedDevices = async (
  filePath: string,
  warnings: string[],
  logger: MigrationLogger
): Promise<PersistedDevices | null> => {
  try {
    return await readJsonFile(filePath, persistedDevicesSchema);
  } catch (error) {
    const warning = `Invalid Tauri devices payload at ${filePath}`;
    warnings.push(warning);
    logger.warn(warning, {
      error: formatError(error)
    });
    return null;
  }
};

const safeReadPersistedSearchIndex = async (
  filePath: string,
  warnings: string[],
  logger: MigrationLogger
): Promise<PersistedSearchIndex | null> => {
  try {
    return await readJsonFile(filePath, persistedSearchIndexSchema);
  } catch (error) {
    const warning = `Invalid Tauri search index payload at ${filePath}`;
    warnings.push(warning);
    logger.warn(warning, {
      error: formatError(error)
    });
    return null;
  }
};

const sanitizePersistedDevices = (
  persistedDevices: PersistedDevices
): PersistedDevices => ({
  ...persistedDevices,
  devices: [...persistedDevices.devices]
    .map((device) => sanitizeImportedDevice(device))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
});

const sanitizeImportedDevice = (
  device: DeviceRecordSchemaType
): DeviceRecordSchemaType => ({
  ...device,
  connected: false,
  connection: null,
  lastError: null
});

const maybeBackupTarget = async (filePath: string, now: () => Date): Promise<void> => {
  if (!(await pathExists(filePath))) {
    return;
  }

  const suffix = now().toISOString().replaceAll(":", "-");
  await backupFileIfExists(filePath, resolveBackupPath(filePath, suffix));
};

const buildMigrationState = ({
  status,
  now,
  sourceRoot,
  importedDeviceCount = 0,
  importedSearchSessionCount = 0,
  errorCode
}: {
  status: MigrationState["tauriImport"]["status"];
  now: () => Date;
  sourceRoot?: string;
  importedDeviceCount?: number;
  importedSearchSessionCount?: number;
  errorCode?: string;
}): MigrationState =>
  migrationStateSchema.parse({
    version: 1,
    tauriImport: {
      status,
      lastAttemptedAt: now().toISOString(),
      ...(status === "completed" ? { completedAt: now().toISOString() } : {}),
      ...(sourceRoot ? { sourceRoot } : {}),
      importedDeviceCount,
      importedSearchSessionCount,
      ...(errorCode ? { errorCode } : {})
    }
  });

const toImportResult = (state: MigrationState): ImportTauriStateResult => ({
  status: state.tauriImport.status,
  sourceRoot: state.tauriImport.sourceRoot,
  importedDeviceCount: state.tauriImport.importedDeviceCount,
  importedSearchSessionCount: state.tauriImport.importedSearchSessionCount,
  warnings: []
});

const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const toErrorCode = (error: unknown): string => {
  if (error instanceof Error && "code" in error) {
    return String((error as NodeJS.ErrnoException).code ?? "unknown");
  }
  if (isZodError(error)) {
    return "schema-parse-failed";
  }
  return "unknown";
};

const isZodError = (error: unknown): error is ZodError =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  error.name === "ZodError";
