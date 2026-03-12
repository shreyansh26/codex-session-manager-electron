import { mkdir } from "node:fs/promises";
import { access, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import electronBinaryPath from "electron";
import { _electron as playwrightElectron } from "playwright";
import {
  diagnosticsFileLayout,
  runSummarySchema,
  type FailureCategory,
  type LifecycleEventName
} from "../../src/shared/diagnostics/contracts";
import type { NodeHarnessRuntimeContract } from "../../scripts/harness/resolveRuntimeContract";
import { writeJsonFileAtomic } from "../../src/main/services/storage/jsonFileStore";

type ConsoleMessageLike = {
  type?: () => string;
  text?: () => string;
  args?: () => Array<{ jsonValue: () => Promise<unknown> }>;
};

type PageLike = {
  on: (event: "console" | "pageerror", listener: (payload: unknown) => void) => void;
  waitForLoadState?: (state?: string, options?: { timeout?: number }) => Promise<void>;
  title?: () => Promise<string>;
  screenshot?: () => Promise<Buffer>;
  content?: () => Promise<string>;
  evaluate?: <T>(expression: () => T | Promise<T>) => Promise<T>;
  click?: (selector: string) => Promise<void>;
  fill?: (selector: string, value: string) => Promise<void>;
  waitForFunction?: (expression: () => unknown, arg?: unknown, options?: { timeout?: number }) => Promise<void>;
};

type ElectronApplicationLike = {
  firstWindow: () => Promise<PageLike>;
  close: () => Promise<void>;
  on: (event: "console" | "window", listener: (payload: unknown) => void) => void;
};

type ElectronLauncherLike = {
  launch: (options: {
    executablePath?: string;
    args: string[];
    cwd: string;
    env: Record<string, string | undefined>;
    timeout: number;
  }) => Promise<ElectronApplicationLike>;
};

export interface HarnessConsoleEvent {
  source: "main" | "window";
  type: string;
  text: string;
  values: unknown[];
}

export interface ElectronHarnessRunResult {
  status: "passed" | "failed";
  failureCategory?: FailureCategory;
  exitCode: number;
  attached: boolean;
  runDirectory: string;
  summaryPath: string;
  mainConsole: HarnessConsoleEvent[];
  windowConsole: HarnessConsoleEvent[];
  pageErrors: string[];
  windowTitle?: string;
  milestones: LifecycleEventName[];
  diagnosticsMilestones: LifecycleEventName[];
  screenshotPath?: string;
  domSnapshotPath?: string;
  stateSnapshotPath?: string;
}

export interface RunElectronHarnessOptions {
  appRoot?: string;
  cwd?: string;
  contract: NodeHarnessRuntimeContract;
  target?: NodeHarnessRuntimeContract["target"];
  electronLauncher?: ElectronLauncherLike;
  entryScriptPath?: string;
  mainEntryPath?: string;
  attachTimeoutMs?: number;
  afterAttach?: (page: PageLike) => Promise<void>;
  packagedExecutablePath?: string;
  userDataDir?: string;
  env?: Record<string, string | undefined>;
}

export const runElectronHarness = async (
  options: RunElectronHarnessOptions
): Promise<ElectronHarnessRunResult> => {
  const appRoot = options.appRoot ?? options.cwd;
  if (!appRoot) {
    throw new Error("runElectronHarness requires `appRoot` or `cwd`.");
  }
  const contract =
    options.target && options.target !== options.contract.target
      ? { ...options.contract, target: options.target }
      : options.contract;
  const electronLauncher =
    options.electronLauncher ?? (playwrightElectron as unknown as ElectronLauncherLike);
  const userDataDir = options.userDataDir ?? resolve(appRoot, ".harness");
  const launchConfig = await resolveElectronLaunchConfig({
    appRoot,
    contract,
    userDataDir,
    env: options.env,
    entryScriptPath: options.mainEntryPath ?? options.entryScriptPath,
    packagedExecutablePath: options.packagedExecutablePath
  });
  const runDirectory = join(
    userDataDir,
    contract.artifacts.root,
    contract.artifacts.runRelativeDirectory
  );
  await mkdir(runDirectory, { recursive: true });

  const mainConsole: HarnessConsoleEvent[] = [];
  const windowConsole: HarnessConsoleEvent[] = [];
  const pageErrors: string[] = [];
  let electronApp: ElectronApplicationLike | null = null;
  let page: PageLike | null = null;
  let attached = false;
  let windowTitle: string | undefined;

  try {
    electronApp = await electronLauncher.launch(launchConfig);
    electronApp.on("console", (message) => {
      void collectConsoleEvent("main", message as ConsoleMessageLike, mainConsole);
    });

    page = await withTimeout(
      electronApp.firstWindow(),
      options.attachTimeoutMs ?? contract.timeout.attachMs,
      "Renderer never attached within the configured timeout."
    );
    attached = true;
    page.on("console", (message) => {
      void collectConsoleEvent("window", message as ConsoleMessageLike, windowConsole);
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error instanceof Error ? error.message : String(error));
    });
    await page.waitForLoadState?.("domcontentloaded", {
      timeout: contract.timeout.bootstrapMs
    });
    windowTitle = await page.title?.();
    if (options.afterAttach) {
      await options.afterAttach(page);
    }
    await sleep(250);

    const diagnostics = await readHarnessDiagnostics(userDataDir, contract);
    const artifacts = await captureHarnessArtifacts({
      userDataDir,
      contract,
      page,
      attached,
      windowTitle,
      diagnosticsMilestones: diagnostics.milestones,
      notes: buildNotes(mainConsole, windowConsole, pageErrors)
    });
    const summaryPath = await writeHarnessSummary({
      userDataDir,
      contract,
      status: "passed",
      milestones: diagnostics.milestones,
      notes: buildNotes(mainConsole, windowConsole, pageErrors),
      screenshotPath: artifacts.screenshotPath,
      domSnapshotPath: artifacts.domSnapshotPath,
      stateSnapshotPath: artifacts.stateSnapshotPath
    });

    return {
      status: "passed",
      exitCode: contract.exitCodes.success,
      attached,
      runDirectory,
      summaryPath,
      mainConsole,
      windowConsole,
      pageErrors,
      windowTitle,
      milestones: diagnostics.milestones,
      diagnosticsMilestones: diagnostics.milestones,
      screenshotPath: artifacts.screenshotPath,
      domSnapshotPath: artifacts.domSnapshotPath,
      stateSnapshotPath: artifacts.stateSnapshotPath
    };
  } catch (error) {
    const diagnostics = await readHarnessDiagnostics(userDataDir, contract);
    const failureCategory = inferHarnessFailureCategory(error);
    const artifacts = await captureHarnessArtifacts({
      userDataDir,
      contract,
      page,
      attached,
      windowTitle,
      diagnosticsMilestones: diagnostics.milestones,
      notes: [
        error instanceof Error ? error.message : String(error),
        ...buildNotes(mainConsole, windowConsole, pageErrors)
      ]
    });
    const summaryPath = await writeHarnessSummary({
      userDataDir,
      contract,
      status: "failed",
      failureCategory,
      milestones: diagnostics.milestones,
      notes: [
        error instanceof Error ? error.message : String(error),
        ...buildNotes(mainConsole, windowConsole, pageErrors)
      ],
      screenshotPath: artifacts.screenshotPath,
      domSnapshotPath: artifacts.domSnapshotPath,
      stateSnapshotPath: artifacts.stateSnapshotPath
    });

    return {
      status: "failed",
      failureCategory,
      exitCode:
        failureCategory === "renderer-never-attached"
          ? contract.exitCodes.attachTimeout
          : failureCategory === "bootstrap-timeout"
            ? contract.exitCodes.bootstrapTimeout
            : contract.exitCodes.unknownFailure,
      attached,
      runDirectory,
      summaryPath,
      mainConsole,
      windowConsole,
      pageErrors,
      milestones: diagnostics.milestones,
      diagnosticsMilestones: diagnostics.milestones,
      screenshotPath: artifacts.screenshotPath,
      domSnapshotPath: artifacts.domSnapshotPath,
      stateSnapshotPath: artifacts.stateSnapshotPath
    };
  } finally {
    await electronApp?.close().catch(() => undefined);
  }
};

export const resolveElectronLaunchConfig = async (options: {
  appRoot: string;
  contract: NodeHarnessRuntimeContract;
  userDataDir: string;
  env?: Record<string, string | undefined>;
  entryScriptPath?: string;
  packagedExecutablePath?: string;
}): Promise<{
  executablePath?: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  timeout: number;
}> => {
  const env = {
    ...process.env,
    ...options.env,
    HARNESS_MODE: options.contract.mode,
    HARNESS_TARGET: options.contract.target,
    HARNESS_RUN_ID: options.contract.run.runId,
    HARNESS_ARTIFACT_ROOT: options.contract.artifacts.root,
    HARNESS_USER_DATA_DIR: options.userDataDir
  };

  if (options.contract.target === "packaged") {
    const executablePath =
      options.packagedExecutablePath ??
      process.env.HARNESS_ELECTRON_EXECUTABLE_PATH ??
      resolve(
        options.appRoot,
        "dist",
        "mac-arm64",
        "Codex Session Monitor.app",
        "Contents",
        "MacOS",
        "Codex Session Monitor"
      );
    await access(executablePath, constants.X_OK);
    return {
      executablePath,
      args: [],
      cwd: options.appRoot,
      env,
      timeout: options.contract.timeout.totalMs
    };
  }

  const entryScript =
    options.entryScriptPath ?? resolve(options.appRoot, "out", "main", "index.js");
  await access(entryScript, constants.R_OK);
  return {
    executablePath: electronBinaryPath as unknown as string,
    args: [entryScript],
    cwd: options.appRoot,
    env,
    timeout: options.contract.timeout.totalMs
  };
};

export const resolveElectronLaunchConfiguration = resolveElectronLaunchConfig;

const collectConsoleEvent = async (
  source: HarnessConsoleEvent["source"],
  message: ConsoleMessageLike,
  bucket: HarnessConsoleEvent[]
): Promise<void> => {
  const values: unknown[] = [];
  for (const arg of message.args?.() ?? []) {
    try {
      values.push(await arg.jsonValue());
    } catch {
      values.push("[Unserializable console arg]");
    }
  }
  bucket.push({
    source,
    type: message.type?.() ?? "log",
    text: message.text?.() ?? values.map((value) => String(value)).join(" "),
    values
  });
};

const readHarnessDiagnostics = async (
  userDataDir: string,
  contract: NodeHarnessRuntimeContract
): Promise<{ milestones: LifecycleEventName[] }> => {
  const runtimeStatePath = join(
    userDataDir,
    contract.artifacts.root,
    contract.artifacts.runRelativeDirectory,
    diagnosticsFileLayout.runtimeStateFile
  );

  try {
    const parsed = JSON.parse(await readFile(runtimeStatePath, "utf8")) as {
      milestones?: LifecycleEventName[];
    };
    return {
      milestones: parsed.milestones ?? []
    };
  } catch {
    return {
      milestones: []
    };
  }
};

const writeHarnessSummary = async (options: {
  userDataDir: string;
  contract: NodeHarnessRuntimeContract;
  status: "passed" | "failed";
  failureCategory?: FailureCategory;
  milestones: LifecycleEventName[];
  notes: string[];
  screenshotPath?: string;
  domSnapshotPath?: string;
  stateSnapshotPath?: string;
}): Promise<string> => {
  const summaryPath = join(
    options.userDataDir,
    options.contract.artifacts.root,
    options.contract.artifacts.runRelativeDirectory,
    diagnosticsFileLayout.summaryFile
  );
  const payload = runSummarySchema.parse({
    schemaVersion: 1,
    runId: options.contract.run.runId,
    mode: options.contract.mode,
    target: options.contract.target,
    status: options.status,
    ...(options.failureCategory ? { failureCategory: options.failureCategory } : {}),
    startedAt: options.contract.run.startedAtIso,
    finishedAt: new Date().toISOString(),
    milestones: options.milestones,
    ...(options.screenshotPath
      ? {
          screenshot: {
            path: options.screenshotPath,
            label: "Final screenshot"
          }
        }
      : {}),
    ...(options.domSnapshotPath
      ? {
          domSnapshot: {
            path: options.domSnapshotPath,
            label: "Final DOM snapshot"
          }
        }
      : {}),
    ...(options.stateSnapshotPath
      ? {
          stateSnapshot: {
            path: options.stateSnapshotPath,
            label: "Renderer state snapshot"
          }
        }
      : {}),
    notes: options.notes
  });
  await writeJsonFileAtomic(summaryPath, payload);
  return summaryPath;
};

const buildNotes = (
  mainConsole: HarnessConsoleEvent[],
  windowConsole: HarnessConsoleEvent[],
  pageErrors: string[]
): string[] => [
  ...mainConsole.map((entry) => `main:${entry.type}:${entry.text}`),
  ...windowConsole.map((entry) => `window:${entry.type}:${entry.text}`),
  ...pageErrors.map((entry) => `pageerror:${entry}`)
];

const captureHarnessArtifacts = async (options: {
  userDataDir: string;
  contract: NodeHarnessRuntimeContract;
  page: PageLike | null;
  attached: boolean;
  windowTitle?: string;
  diagnosticsMilestones: LifecycleEventName[];
  notes: string[];
}): Promise<{
  screenshotPath?: string;
  domSnapshotPath?: string;
  stateSnapshotPath: string;
}> => {
  const runDir = join(
    options.userDataDir,
    options.contract.artifacts.root,
    options.contract.artifacts.runRelativeDirectory
  );
  const screenshotsDir = join(runDir, diagnosticsFileLayout.screenshotsDirectory);
  const domDir = join(runDir, diagnosticsFileLayout.domDirectory);
  const snapshotsDir = join(runDir, diagnosticsFileLayout.snapshotsDirectory);
  await Promise.all([
    mkdir(screenshotsDir, { recursive: true }),
    mkdir(domDir, { recursive: true }),
    mkdir(snapshotsDir, { recursive: true })
  ]);

  let screenshotPath: string | undefined;
  let domSnapshotPath: string | undefined;

  if (options.page?.screenshot) {
    try {
      const buffer = await options.page.screenshot();
      screenshotPath = join(diagnosticsFileLayout.screenshotsDirectory, "final.png");
      await writeBufferFileAtomic(join(runDir, screenshotPath), buffer);
    } catch {
      // Best-effort artifact capture.
    }
  }

  if (options.page?.content) {
    try {
      const html = await options.page.content();
      domSnapshotPath = join(diagnosticsFileLayout.domDirectory, "final.html");
      await writeTextFileAtomic(join(runDir, domSnapshotPath), html);
    } catch {
      // Best-effort artifact capture.
    }
  }

  const stateSnapshotPath = join(
    diagnosticsFileLayout.snapshotsDirectory,
    "runner-state.json"
  );
  await writeJsonFileAtomic(join(runDir, stateSnapshotPath), {
    schemaVersion: 1,
    runId: options.contract.run.runId,
    attached: options.attached,
    windowTitle: options.windowTitle ?? null,
    diagnosticsMilestones: options.diagnosticsMilestones,
    notes: options.notes,
    rendererState: options.page ? await safeEvaluateRendererState(options.page) : null
  });

  return {
    ...(screenshotPath ? { screenshotPath } : {}),
    ...(domSnapshotPath ? { domSnapshotPath } : {}),
    stateSnapshotPath
  };
};

const inferHarnessFailureCategory = (error: unknown): FailureCategory => {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  if (message.includes("never attached")) {
    return "renderer-never-attached";
  }
  if (message.includes("timeout")) {
    return "bootstrap-timeout";
  }
  return "uncategorized";
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

const safeEvaluateRendererState = async (page: PageLike): Promise<unknown> => {
  if (!page.evaluate) {
    return null;
  }

  try {
    return await page.evaluate(() => {
      const rendererHooks = (window as Window & {
        __CODEX_RENDERER_HOOKS__?: { getStateSnapshot?: () => unknown };
      }).__CODEX_RENDERER_HOOKS__;
      if (rendererHooks?.getStateSnapshot) {
        return rendererHooks.getStateSnapshot();
      }

      return {
        title: document.title,
        readyState: document.readyState,
        locationHref: window.location.href
      };
    });
  } catch {
    return null;
  }
};

const writeBufferFileAtomic = async (filePath: string, data: Buffer): Promise<void> => {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    await writeFile(temporaryPath, data);
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
};

const writeTextFileAtomic = async (filePath: string, data: string): Promise<void> => {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    await writeFile(temporaryPath, data, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
};

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
