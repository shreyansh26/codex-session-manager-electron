import { describe, expect, it } from "vitest";
import {
  getElectronStatePaths,
  resolveTauriCandidateRoots,
  resolveTauriDevicesPath,
  resolveTauriSearchIndexPath
} from "./statePaths";

describe("statePaths", () => {
  it("resolves Electron state file paths", () => {
    const paths = getElectronStatePaths("/tmp/codex-electron");

    expect(paths.devicesPath).toBe("/tmp/codex-electron/devices.json");
    expect(paths.searchIndexPath).toBe("/tmp/codex-electron/search-index-v1.json");
    expect(paths.preferencesPath).toBe("/tmp/codex-electron/preferences.json");
    expect(paths.migrationStatePath).toBe("/tmp/codex-electron/migration-state.json");
  });

  it("builds deterministic Tauri candidate roots in fallback order", () => {
    const roots = resolveTauriCandidateRoots({
      dataLocalDir: "/data-local",
      homeDir: "/home/user",
      cwd: "/workspace"
    });

    expect(roots).toEqual([
      "/data-local/codex-session-monitor",
      "/home/user/codex-session-monitor",
      "/workspace/codex-session-monitor"
    ]);
    expect(resolveTauriDevicesPath(roots[0])).toBe(
      "/data-local/codex-session-monitor/devices.json"
    );
    expect(resolveTauriSearchIndexPath(roots[1])).toBe(
      "/home/user/codex-session-monitor/search-index-v1.json"
    );
  });
});
