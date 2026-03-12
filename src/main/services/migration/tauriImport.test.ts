import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importTauriState } from "./tauriImport";
import {
  getElectronStatePaths,
  TAURI_STATE_DIRECTORY
} from "../storage/statePaths";

const createdDirectories: string[] = [];

const createTempDir = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  createdDirectories.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map(async (dir) => {
      await import("node:fs/promises").then(({ rm }) =>
        rm(dir, { recursive: true, force: true })
      );
    })
  );
});

describe("importTauriState", () => {
  it("imports sanitized Tauri devices and search index once", async () => {
    const electronUserDataDir = await createTempDir("electron-user-data-");
    const dataLocalDir = await createTempDir("tauri-data-local-");
    const tauriStateDir = join(dataLocalDir, TAURI_STATE_DIRECTORY);
    await mkdir(tauriStateDir, { recursive: true });

    await writeFile(
      join(tauriStateDir, "devices.json"),
      JSON.stringify({
        devices: [
          {
            id: "local-1",
            name: "Local Device",
            config: {
              kind: "local",
              appServerPort: 45231
            },
            connected: true,
            connection: {
              endpoint: "ws://127.0.0.1:45231",
              transport: "websocket",
              connectedAtMs: 1
            },
            lastError: "old"
          }
        ]
      })
    );
    await writeFile(
      join(tauriStateDir, "search-index-v1.json"),
      JSON.stringify({
        version: 1,
        sessions: [
          {
            sessionKey: "local-1::thread-1",
            threadId: "thread-1",
            deviceId: "local-1",
            sessionTitle: "Title",
            deviceLabel: "Local Device",
            deviceAddress: "local",
            updatedAt: "2026-03-12T00:00:00.000Z",
            messages: [
              {
                messageId: "message-1",
                role: "user",
                content: "hello",
                createdAt: "2026-03-12T00:00:00.000Z"
              }
            ]
          }
        ]
      })
    );

    const result = await importTauriState({
      electronUserDataDir,
      dataLocalDir,
      homeDir: null,
      cwd: "/unused",
      now: () => new Date("2026-03-12T00:00:00.000Z")
    });

    expect(result.status).toBe("completed");
    expect(result.importedDeviceCount).toBe(1);
    expect(result.importedSearchSessionCount).toBe(1);

    const electronPaths = getElectronStatePaths(electronUserDataDir);
    const importedDevices = JSON.parse(await readFile(electronPaths.devicesPath, "utf8"));
    const migrationState = JSON.parse(
      await readFile(electronPaths.migrationStatePath, "utf8")
    );

    expect(importedDevices.devices[0].connected).toBe(false);
    expect(importedDevices.devices[0].connection).toBeNull();
    expect(importedDevices.devices[0].lastError).toBeNull();
    expect(migrationState.tauriImport.status).toBe("completed");
  });

  it("skips import when Electron state already exists", async () => {
    const electronUserDataDir = await createTempDir("electron-existing-");
    const electronPaths = getElectronStatePaths(electronUserDataDir);
    await mkdir(electronUserDataDir, { recursive: true });
    await writeFile(
      electronPaths.preferencesPath,
      JSON.stringify({
        version: 1,
        themePreference: "dark"
      })
    );

    const result = await importTauriState({
      electronUserDataDir,
      dataLocalDir: "/missing",
      homeDir: null,
      cwd: "/unused",
      now: () => new Date("2026-03-12T00:00:00.000Z")
    });

    expect(result.status).toBe("skipped");
    expect(result.importedDeviceCount).toBe(0);
    expect(result.importedSearchSessionCount).toBe(0);
  });

  it("skips cleanly when no Tauri source exists", async () => {
    const electronUserDataDir = await createTempDir("electron-empty-");

    const result = await importTauriState({
      electronUserDataDir,
      dataLocalDir: "/missing",
      homeDir: null,
      cwd: "/still-missing",
      now: () => new Date("2026-03-12T00:00:00.000Z")
    });

    expect(result.status).toBe("skipped");
    expect(result.importedDeviceCount).toBe(0);
  });

  it("fails non-fatally when Tauri payloads are malformed", async () => {
    const electronUserDataDir = await createTempDir("electron-malformed-");
    const dataLocalDir = await createTempDir("tauri-malformed-");
    const tauriStateDir = join(dataLocalDir, TAURI_STATE_DIRECTORY);
    await mkdir(tauriStateDir, { recursive: true });
    await writeFile(join(tauriStateDir, "devices.json"), "{not-json");

    const warnings: string[] = [];
    const result = await importTauriState({
      electronUserDataDir,
      dataLocalDir,
      homeDir: null,
      cwd: "/unused",
      now: () => new Date("2026-03-12T00:00:00.000Z"),
      logger: {
        info: () => undefined,
        warn: (message) => warnings.push(message)
      }
    });

    expect(result.status).toBe("failed");
    expect(warnings[0]).toContain("Invalid Tauri devices payload");
  });

  it("is idempotent after a successful import", async () => {
    const electronUserDataDir = await createTempDir("electron-idempotent-");
    const dataLocalDir = await createTempDir("tauri-idempotent-");
    const tauriStateDir = join(dataLocalDir, TAURI_STATE_DIRECTORY);
    await mkdir(tauriStateDir, { recursive: true });
    await writeFile(
      join(tauriStateDir, "devices.json"),
      JSON.stringify({
        devices: [
          {
            id: "local-1",
            name: "Local Device",
            config: {
              kind: "local"
            },
            connected: false
          }
        ]
      })
    );

    const first = await importTauriState({
      electronUserDataDir,
      dataLocalDir,
      homeDir: null,
      cwd: "/unused",
      now: () => new Date("2026-03-12T00:00:00.000Z")
    });
    const second = await importTauriState({
      electronUserDataDir,
      dataLocalDir,
      homeDir: null,
      cwd: "/unused",
      now: () => new Date("2026-03-12T01:00:00.000Z")
    });

    expect(first.status).toBe("completed");
    expect(second.status).toBe("completed");
    expect(second.importedDeviceCount).toBe(1);
  });
});
