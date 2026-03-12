import { describe, expect, it, vi } from "vitest";
import { buildUnixCodexLaunchCommand, ManagedChild, RuntimeError } from "../common";
import {
  LocalRuntimeManager,
  buildLocalSpawnOptions
} from "./localRuntime";

describe("buildUnixCodexLaunchCommand", () => {
  it("includes the packaged-app PATH fallback chain when codexBin is not set", () => {
    const command = buildUnixCodexLaunchCommand({
      listenUri: "ws://127.0.0.1:45231"
    });

    expect(command).toContain("/opt/homebrew/bin/codex");
    expect(command).toContain("$HOME/.nvm/nvm.sh");
    expect(command).toContain('approval_policy="never"');
    expect(command).toContain('sandbox_mode="danger-full-access"');
  });

  it("prefers an explicit codexBin and preserves workspace cwd separately", () => {
    const spawnOptions = buildLocalSpawnOptions(
      {
        kind: "local",
        codexBin: "/custom/bin/codex",
        workspaceRoot: "/tmp/project"
      },
      "ws://127.0.0.1:45231"
    );

    expect(spawnOptions.command).toBe("bash");
    expect(spawnOptions.args[1]).toContain("PATH='/custom/bin':$PATH '/custom/bin/codex'");
    expect(spawnOptions.cwd).toBe("/tmp/project");
  });
});

describe("LocalRuntimeManager", () => {
  it("starts and stops a local runtime with a ready endpoint", async () => {
    const shutdown = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const assertRunning = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const manager = new LocalRuntimeManager({
      nowMs: () => 123,
      resolveListenPort: async () => 45231,
      createManagedChild: () =>
        ({
          pid: 999,
          shutdown,
          assertRunning
        }) as unknown as ManagedChild,
      waitForEndpointReady: async ({ assertProcesses }) => {
        if (assertProcesses) {
          for (const assertion of assertProcesses) {
            await assertion();
          }
        }
      }
    });

    const result = await manager.start({
      kind: "local",
      workspaceRoot: "/tmp/project"
    });

    expect(manager.getStatus()).toBe("connected");
    expect(result.endpoint).toBe("ws://127.0.0.1:45231");
    expect(result.connection.localServerPid).toBe(999);

    await manager.stop();
    expect(manager.getStatus()).toBe("idle");
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("surfaces readiness failures and transitions to failed state", async () => {
    const shutdown = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const manager = new LocalRuntimeManager({
      resolveListenPort: async () => 45231,
      createManagedChild: () =>
        ({
          pid: 111,
          shutdown,
          assertRunning: async () => undefined
        }) as unknown as ManagedChild,
      waitForEndpointReady: async () => {
        throw new RuntimeError("endpoint-not-ready", "not ready");
      }
    });

    await expect(
      manager.start({
        kind: "local"
      })
    ).rejects.toThrow("not ready");
    expect(manager.getStatus()).toBe("failed");
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("can recover from a preferred port collision by switching to a free port", async () => {
    const manager = new LocalRuntimeManager({
      resolveListenPort: async (requestedPort) =>
        requestedPort === 45231 ? 46000 : requestedPort ?? 46000,
      createManagedChild: () =>
        ({
          pid: 222,
          shutdown: async () => undefined,
          assertRunning: async () => undefined
        }) as unknown as ManagedChild,
      waitForEndpointReady: async () => undefined
    });

    const result = await manager.start({
      kind: "local",
      appServerPort: 45231
    });

    expect(result.endpoint).toBe("ws://127.0.0.1:46000");
  });
});
