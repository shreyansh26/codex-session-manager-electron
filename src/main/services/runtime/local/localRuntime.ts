import { platform } from "node:os";
import type {
  DeviceConnectionRecord,
  LocalDeviceConfigRecord
} from "../../../../shared/schema/contracts";
import {
  ManagedChild,
  RuntimeError,
  type RuntimeStatus,
  resolveListenPort,
  buildAppServerProcessArgs,
  buildUnixCodexLaunchCommand,
  waitForEndpointReady
} from "../common";

export interface LocalRuntimeOptions {
  nowMs?: () => number;
  resolveListenPort?: (requestedPort?: number) => Promise<number>;
  createManagedChild?: (options: {
    role: string;
    command: string;
    args: string[];
    cwd?: string;
  }) => ManagedChild;
  waitForEndpointReady?: (options: {
    endpoint: string;
    localPort: number;
    timeoutMs: number;
    assertProcesses?: Array<() => Promise<void>>;
  }) => Promise<void>;
}

export interface LocalRuntimeStartResult {
  endpoint: string;
  connection: DeviceConnectionRecord;
}

export class LocalRuntimeManager {
  private status: RuntimeStatus = "idle";
  private process: ManagedChild | null = null;
  private endpoint: string | null = null;
  private readonly nowMs: () => number;
  private readonly resolveListenPortFn: (requestedPort?: number) => Promise<number>;
  private readonly createManagedChildFn: NonNullable<
    LocalRuntimeOptions["createManagedChild"]
  >;
  private readonly waitForEndpointReadyFn: NonNullable<
    LocalRuntimeOptions["waitForEndpointReady"]
  >;

  constructor(options: LocalRuntimeOptions = {}) {
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.resolveListenPortFn = options.resolveListenPort ?? resolveListenPort;
    this.createManagedChildFn =
      options.createManagedChild ?? ((spawnOptions) => new ManagedChild(spawnOptions));
    this.waitForEndpointReadyFn =
      options.waitForEndpointReady ?? waitForEndpointReady;
  }

  getStatus(): RuntimeStatus {
    return this.status;
  }

  async start(config: LocalDeviceConfigRecord): Promise<LocalRuntimeStartResult> {
    if (this.status === "starting" || this.status === "connected") {
      await this.stop();
    }

    this.status = "starting";
    const localPort = await this.resolveListenPortFn(config.appServerPort);
    const endpoint = `ws://127.0.0.1:${localPort}`;
    const process = this.createManagedChildFn(
      buildLocalSpawnOptions(config, endpoint)
    );

    this.process = process;
    this.endpoint = endpoint;

    try {
      await this.waitForEndpointReadyFn({
        endpoint,
        localPort,
        timeoutMs: 10_000,
        assertProcesses: [() => process.assertRunning()]
      });
    } catch (error) {
      this.status = "failed";
      await process.shutdown();
      this.process = null;
      throw enhanceRuntimeError(error, endpoint);
    }

    this.status = "connected";
    return {
      endpoint,
      connection: {
        endpoint,
        transport: "websocket",
        connectedAtMs: this.nowMs(),
        ...(process.pid ? { localServerPid: process.pid } : {})
      }
    };
  }

  async stop(): Promise<void> {
    if (!this.process) {
      this.status = "idle";
      this.endpoint = null;
      return;
    }

    this.status = "disconnecting";
    const existingProcess = this.process;
    this.process = null;
    this.endpoint = null;
    await existingProcess.shutdown();
    this.status = "idle";
  }
}

export const buildLocalSpawnOptions = (
  config: LocalDeviceConfigRecord,
  endpoint: string
): {
  role: string;
  command: string;
  args: string[];
  cwd?: string;
} => {
  if (platform() === "win32") {
    return {
      role: "local-app-server",
      command: config.codexBin ?? "codex",
      args: buildAppServerProcessArgs(endpoint),
      cwd: config.workspaceRoot
    };
  }

  return {
    role: "local-app-server",
    command: "bash",
    args: ["-lc", buildUnixCodexLaunchCommand({ listenUri: endpoint, codexBin: config.codexBin })],
    cwd: config.workspaceRoot
  };
};

const enhanceRuntimeError = (error: unknown, endpoint: string): RuntimeError => {
  if (error instanceof RuntimeError) {
    return error;
  }

  return new RuntimeError("local-runtime-failed", `Local runtime failed for ${endpoint}`, {
    endpoint,
    cause: error instanceof Error ? error.message : String(error)
  });
};
