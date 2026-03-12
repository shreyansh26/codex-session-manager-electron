import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const TAURI_STATE_DIRECTORY = "codex-session-monitor";

export interface ElectronStatePaths {
  rootDir: string;
  devicesPath: string;
  searchIndexPath: string;
  preferencesPath: string;
  migrationStatePath: string;
  logDir: string;
}

export interface TauriPathResolutionOptions {
  dataLocalDir?: string | null;
  homeDir?: string | null;
  cwd?: string;
}

const uniquePaths = (paths: Array<string | null | undefined>): string[] => {
  const result: string[] = [];
  for (const candidate of paths) {
    if (!candidate) {
      continue;
    }
    if (!result.includes(candidate)) {
      result.push(candidate);
    }
  }
  return result;
};

export const getElectronStatePaths = (userDataDir: string): ElectronStatePaths => ({
  rootDir: userDataDir,
  devicesPath: join(userDataDir, "devices.json"),
  searchIndexPath: join(userDataDir, "search-index-v1.json"),
  preferencesPath: join(userDataDir, "preferences.json"),
  migrationStatePath: join(userDataDir, "migration-state.json"),
  logDir: join(userDataDir, "logs")
});

export const resolveTauriCandidateRoots = (
  options: TauriPathResolutionOptions = {}
): string[] => {
  const home = options.homeDir ?? homedir();
  const cwd = options.cwd ?? process.cwd();

  return uniquePaths([
    options.dataLocalDir ? join(options.dataLocalDir, TAURI_STATE_DIRECTORY) : null,
    home ? join(home, TAURI_STATE_DIRECTORY) : null,
    cwd ? join(cwd, TAURI_STATE_DIRECTORY) : null
  ]);
};

export const resolveTauriDevicesPath = (rootDir: string): string =>
  join(rootDir, "devices.json");

export const resolveTauriSearchIndexPath = (rootDir: string): string =>
  join(rootDir, "search-index-v1.json");

export const resolveBackupPath = (filePath: string, suffix: string): string => {
  const dir = dirname(filePath);
  const fileName = filePath.split("/").at(-1) ?? "state.json";
  return join(dir, `${fileName}.${suffix}.bak`);
};
