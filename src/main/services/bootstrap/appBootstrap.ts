import { join } from "node:path";
import { SearchIndexService, type SearchIndexServiceOptions } from "../search/searchIndexService";
import { importTauriState, type ImportTauriStateResult } from "../migration/tauriImport";
import type { HarnessDiagnostics } from "../diagnostics/harnessDiagnostics";
import { getElectronStatePaths, type ElectronStatePaths } from "../storage/statePaths";
import { FileLogger, type Logger } from "../logging/fileLogger";

export type BootstrapStatus = "idle" | "running" | "ready" | "failed";

export interface BootstrapContext {
  statePaths: ElectronStatePaths;
  searchIndexService: SearchIndexService;
  importResult: ImportTauriStateResult;
  logFilePath: string;
}

export interface AppBootstrapOptions {
  userDataDir: string;
  homeDir: string;
  appDataDir: string;
  cwd?: string;
  logger?: Logger;
  diagnostics?: HarnessDiagnostics;
  createSearchIndexService?: (
    options: SearchIndexServiceOptions
  ) => Promise<SearchIndexService>;
  runImport?: typeof importTauriState;
}

export class AppBootstrap {
  private status: BootstrapStatus = "idle";
  private readyPromise: Promise<BootstrapContext> | null = null;
  private context: BootstrapContext | null = null;

  constructor(private readonly options: AppBootstrapOptions) {}

  getStatus(): BootstrapStatus {
    return this.status;
  }

  getContext(): BootstrapContext | null {
    return this.context;
  }

  async ensureReady(): Promise<BootstrapContext> {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.status = "running";
    this.readyPromise = this.bootstrap();
    return this.readyPromise;
  }

  private async bootstrap(): Promise<BootstrapContext> {
    const statePaths = getElectronStatePaths(this.options.userDataDir);
    const logger =
      this.options.logger ?? new FileLogger(join(statePaths.logDir, "main.log"));
    const createSearchIndexService =
      this.options.createSearchIndexService ?? SearchIndexService.create;
    const runImport = this.options.runImport ?? importTauriState;
    const diagnostics = this.options.diagnostics;

    await logger.info("bootstrap-start", {
      userDataDir: this.options.userDataDir
    });

    try {
      const importResult = await runImport({
        electronUserDataDir: this.options.userDataDir,
        dataLocalDir: this.options.appDataDir,
        homeDir: this.options.homeDir,
        cwd: this.options.cwd,
        logger: {
          info: (message, metadata) => logger.info(message, metadata),
          warn: (message, metadata) => logger.warn(message, metadata)
        }
      });

      const searchIndexService = await createSearchIndexService({
        searchIndexPath: statePaths.searchIndexPath
      });

      this.context = {
        statePaths,
        searchIndexService,
        importResult,
        logFilePath: logger.getFilePath()
      };
      this.status = "ready";
      await diagnostics?.recordLifecycle("bootstrap.ready", "info", {
        importStatus: importResult.status,
        importedDeviceCount: importResult.importedDeviceCount,
        importedSearchSessionCount: importResult.importedSearchSessionCount
      });

      await logger.info("bootstrap-ready", {
        importStatus: importResult.status,
        importedDeviceCount: importResult.importedDeviceCount,
        importedSearchSessionCount: importResult.importedSearchSessionCount,
        logFilePath: logger.getFilePath()
      });

      return this.context;
    } catch (error) {
      this.status = "failed";
      await diagnostics?.recordFailure("bootstrap.ready", error);
      await logger.error("bootstrap-failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}
