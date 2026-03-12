import { describe, expect, it, vi } from "vitest";
import { ManagedChild, RuntimeError } from "../common";
import {
  SshRuntimeManager,
  buildRemoteAppServerCommand,
  buildSshBaseArgs,
  buildSshForwarderSpawnOptions,
  buildSshRemoteSpawnOptions
} from "./sshRuntime";

const sshConfig = {
  kind: "ssh" as const,
  host: "example.com",
  user: "alice",
  sshPort: 22,
  identityFile: "/keys/id_ed25519",
  remoteAppServerPort: 45231,
  localForwardPort: 47000,
  codexBin: "/custom/bin/codex",
  workspaceRoot: "/srv/project"
};

describe("buildSshBaseArgs", () => {
  it("preserves keepalive and identity-file flags", () => {
    expect(buildSshBaseArgs(sshConfig)).toEqual([
      "-p",
      "22",
      "-o",
      "BatchMode=yes",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      "-i",
      "/keys/id_ed25519"
    ]);
  });

  it("builds forwarder and remote app-server commands with the expected fields", () => {
    const forwarder = buildSshForwarderSpawnOptions(sshConfig, "alice@example.com", 47000);
    const remote = buildSshRemoteSpawnOptions(sshConfig, "alice@example.com");
    const remoteCommand = buildRemoteAppServerCommand(sshConfig);

    expect(forwarder.args).toContain("-L");
    expect(forwarder.args).toContain("47000:127.0.0.1:45231");
    expect(remote.args.at(-1)).toContain("bash -lc");
    expect(remoteCommand).toContain("cd '/srv/project'");
    expect(remoteCommand).toContain("/custom/bin/codex");
    expect(remoteCommand).toContain("ss -ltnp");
  });
});

describe("SshRuntimeManager", () => {
  it("reuses an already-running remote app-server when the forwarded endpoint is healthy", async () => {
    const forwardShutdown = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const manager = new SshRuntimeManager({
      nowMs: () => 321,
      resolveListenPort: async () => 47000,
      createManagedChild: () =>
        ({
          pid: 11,
          shutdown: forwardShutdown,
          assertRunning: async () => undefined
        }) as unknown as ManagedChild,
      waitForEndpointReady: async ({ timeoutMs }) => {
        if (timeoutMs === 4_000) {
          return;
        }
      }
    });

    const result = await manager.start(sshConfig);

    expect(manager.getStatus()).toBe("connected");
    expect(result.connection.sshForwardPid).toBe(11);
    expect(result.connection.sshRemotePid).toBeUndefined();

    await manager.stop();
    expect(forwardShutdown).toHaveBeenCalledTimes(1);
  });

  it("launches a remote app-server after an initial readiness miss", async () => {
    const manager = new SshRuntimeManager({
      resolveListenPort: async () => 47000,
      createManagedChild: ({ role }) =>
        ({
          pid: role === "ssh-forwarder" ? 21 : 22,
          shutdown: async () => undefined,
          assertRunning: async () => undefined
        }) as unknown as ManagedChild,
      waitForEndpointReady: async ({ timeoutMs }) => {
        if (timeoutMs === 4_000) {
          throw new RuntimeError("endpoint-not-ready", "not ready yet");
        }
      }
    });

    const result = await manager.start(sshConfig);

    expect(result.connection.sshForwardPid).toBe(21);
    expect(result.connection.sshRemotePid).toBe(22);
  });

  it("fails cleanly when the remote launch never becomes ready", async () => {
    const forwardShutdown = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const remoteShutdown = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    let spawnCount = 0;
    const manager = new SshRuntimeManager({
      resolveListenPort: async () => 47000,
      createManagedChild: ({ role }) => {
        spawnCount += 1;
        return ({
          pid: role === "ssh-forwarder" ? 30 : 31,
          shutdown: role === "ssh-forwarder" ? forwardShutdown : remoteShutdown,
          assertRunning: async () => undefined
        }) as unknown as ManagedChild;
      },
      waitForEndpointReady: async ({ timeoutMs }) => {
        if (timeoutMs === 4_000) {
          throw new RuntimeError("endpoint-not-ready", "initial miss");
        }
        throw new RuntimeError("endpoint-not-ready", "never ready");
      }
    });

    await expect(manager.start(sshConfig)).rejects.toThrow("never ready");
    expect(manager.getStatus()).toBe("idle");
    expect(spawnCount).toBe(2);
    expect(forwardShutdown).toHaveBeenCalledTimes(1);
    expect(remoteShutdown).toHaveBeenCalledTimes(1);
  });
});
