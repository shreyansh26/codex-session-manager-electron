import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { nativeThemeMock } = vi.hoisted(() => ({
  nativeThemeMock: {
    shouldUseDarkColors: false,
    themeSource: "system",
    on: vi.fn()
  }
}));

vi.mock("electron", () => ({
  nativeTheme: nativeThemeMock
}));

import { ThemeService } from "./themeService";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "codex-theme-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  nativeThemeMock.shouldUseDarkColors = false;
  nativeThemeMock.themeSource = "system";
  nativeThemeMock.on.mockReset();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("ThemeService", () => {
  it("defaults to the current resolved system theme before a preference file exists", async () => {
    nativeThemeMock.shouldUseDarkColors = true;
    const dir = await createTempDir();
    const service = new ThemeService(join(dir, "preferences.json"));

    const state = await service.getPreference();

    expect(state).toEqual({ preference: "dark", resolved: "dark" });
    expect(nativeThemeMock.themeSource).toBe("system");
  });

  it("persists a manual preference and notifies subscribers", async () => {
    const dir = await createTempDir();
    const service = new ThemeService(join(dir, "preferences.json"));
    const listener = vi.fn();
    service.subscribe(listener);

    const state = await service.setPreference("light");

    expect(state).toEqual({ preference: "light", resolved: "light" });
    expect(nativeThemeMock.themeSource).toBe("light");
    expect(listener).toHaveBeenCalledWith({ preference: "light", resolved: "light" });
  });
});
