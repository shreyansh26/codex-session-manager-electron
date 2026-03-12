import type {
  DeviceConnectionRecord,
  SshDeviceConfigRecord
} from "../../../../shared/schema/contracts";
import {
  ManagedChild,
  RuntimeError,
  type RuntimeStatus,
  buildAppServerShellCommand,
  quoteShell,
  resolveListenPort,
  waitForEndpointReady
} from "../common";

export interface SshRuntimeOptions {
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

export interface SshRuntimeStartResult {
  endpoint: string;
  connection: DeviceConnectionRecord;
}

export class SshRuntimeManager {
  private status: RuntimeStatus = "idle";
  private forwarder: ManagedChild | null = null;
  private remoteServer: ManagedChild | null = null;
  private readonly nowMs: () => number;
  private readonly resolveListenPortFn: (requestedPort?: number) => Promise<number>;
  private readonly createManagedChildFn: NonNullable<SshRuntimeOptions["createManagedChild"]>;
  private readonly waitForEndpointReadyFn: NonNullable<
    SshRuntimeOptions["waitForEndpointReady"]
  >;

  constructor(options: SshRuntimeOptions = {}) {
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

  async start(config: SshDeviceConfigRecord): Promise<SshRuntimeStartResult> {
    if (this.status === "starting" || this.status === "connected") {
      await this.stop();
    }

    this.status = "starting";
    const localForwardPort = await this.resolveListenPortFn(config.localForwardPort);
    const endpoint = `ws://127.0.0.1:${localForwardPort}`;
    const target = `${config.user}@${config.host}`;

    const forwarder = this.createManagedChildFn(
      buildSshForwarderSpawnOptions(config, target, localForwardPort)
    );
    this.forwarder = forwarder;

    try {
      await this.waitForEndpointReadyFn({
        endpoint,
        localPort: localForwardPort,
        timeoutMs: 4_000,
        assertProcesses: [() => forwarder.assertRunning()]
      });
      this.status = "connected";
      return {
        endpoint,
        connection: {
          endpoint,
          transport: "websocket",
          connectedAtMs: this.nowMs(),
          ...(forwarder.pid ? { sshForwardPid: forwarder.pid } : {})
        }
      };
    } catch (error) {
      if (!(error instanceof RuntimeError) || error.code !== "endpoint-not-ready") {
        this.status = "failed";
        await this.stop();
        throw error;
      }
    }

    const remoteServer = this.createManagedChildFn(
      buildSshRemoteSpawnOptions(config, target)
    );
    this.remoteServer = remoteServer;

    try {
      await this.waitForEndpointReadyFn({
        endpoint,
        localPort: localForwardPort,
        timeoutMs: 30_000,
        assertProcesses: [
          () => forwarder.assertRunning(),
          () => remoteServer.assertRunning()
        ]
      });
    } catch (error) {
      this.status = "failed";
      await this.stop();
      throw enhanceSshRuntimeError(error, endpoint);
    }

    this.status = "connected";
    return {
      endpoint,
      connection: {
        endpoint,
        transport: "websocket",
        connectedAtMs: this.nowMs(),
        ...(remoteServer.pid ? { sshRemotePid: remoteServer.pid } : {}),
        ...(forwarder.pid ? { sshForwardPid: forwarder.pid } : {})
      }
    };
  }

  async stop(): Promise<void> {
    this.status = this.forwarder || this.remoteServer ? "disconnecting" : "idle";
    const forwarder = this.forwarder;
    const remoteServer = this.remoteServer;
    this.forwarder = null;
    this.remoteServer = null;

    if (forwarder) {
      await forwarder.shutdown();
    }
    if (remoteServer) {
      await remoteServer.shutdown();
    }
    this.status = "idle";
  }
}

export const buildSshBaseArgs = (config: SshDeviceConfigRecord): string[] => {
  const args = [
    "-p",
    String(config.sshPort),
    "-o",
    "BatchMode=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3"
  ];

  if (config.identityFile) {
    args.push("-i", config.identityFile);
  }

  return args;
};

export const buildSshForwarderSpawnOptions = (
  config: SshDeviceConfigRecord,
  target: string,
  localForwardPort: number
): {
  role: string;
  command: string;
  args: string[];
} => ({
  role: "ssh-forwarder",
  command: "ssh",
  args: [
    ...buildSshBaseArgs(config),
    "-N",
    "-o",
    "ExitOnForwardFailure=yes",
    "-L",
    `${localForwardPort}:127.0.0.1:${config.remoteAppServerPort}`,
    target
  ]
});

export const buildRemoteAppServerCommand = (config: SshDeviceConfigRecord): string => {
  const listenUri = `ws://127.0.0.1:${config.remoteAppServerPort}`;
  const appServerCommand = buildAppServerShellCommand(listenUri);
  const launchCommand = config.codexBin
    ? buildExplicitCodexLaunch(config.codexBin, appServerCommand)
    : buildDefaultCodexLaunch(appServerCommand);
  const staleCleanupCommand = [
    `for pid in $(ss -ltnp 2>/dev/null | sed -n 's/.*127\\\\.0\\\\.0\\\\.1:${config.remoteAppServerPort}.*pid=\\\\([0-9]\\\\+\\\\).*/\\\\1/p' | sort -u); do`,
    'cmd=$(ps -p "$pid" -o args= 2>/dev/null || true);',
    'case "$cmd" in *codex*) kill "$pid" >/dev/null 2>&1 || true ;; esac;',
    "done"
  ].join(" ");
  const command = `${staleCleanupCommand}; ${launchCommand}`;

  if (!config.workspaceRoot) {
    return command;
  }

  return `cd ${quoteShell(config.workspaceRoot)} && ${command}`;
};

export const buildSshRemoteSpawnOptions = (
  config: SshDeviceConfigRecord,
  target: string
): {
  role: string;
  command: string;
  args: string[];
} => ({
  role: "ssh-remote-app-server",
  command: "ssh",
  args: [
    ...buildSshBaseArgs(config),
    target,
    `bash -lc ${quoteShell(buildRemoteAppServerCommand(config))}`
  ]
});

const buildExplicitCodexLaunch = (codexBin: string, appServerCommand: string): string => {
  const lastSlash = codexBin.lastIndexOf("/");
  const codexDir = lastSlash > 0 ? codexBin.slice(0, lastSlash) : null;
  if (codexDir) {
    return `PATH=${quoteShell(codexDir)}:$PATH ${quoteShell(codexBin)} ${appServerCommand}`;
  }
  return `${quoteShell(codexBin)} ${appServerCommand}`;
};

const buildDefaultCodexLaunch = (appServerCommand: string): string =>
  [
    `if command -v codex >/dev/null 2>&1; then codex ${appServerCommand};`,
    `elif [ -x /opt/homebrew/bin/codex ]; then PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/codex ${appServerCommand};`,
    `elif [ -x /usr/local/bin/codex ]; then PATH=/usr/local/bin:$PATH /usr/local/bin/codex ${appServerCommand};`,
    `elif [ -x "$HOME/.local/bin/codex" ]; then PATH="$HOME/.local/bin:$PATH" "$HOME/.local/bin/codex" ${appServerCommand};`,
    `elif command -v fnm >/dev/null 2>&1 && eval "$(fnm env --shell bash)" >/dev/null 2>&1 && command -v codex >/dev/null 2>&1; then codex ${appServerCommand};`,
    `elif [ -d "$HOME/.local/state/fnm_multishells" ] && latest_fnm_codex=$(ls -t "$HOME"/.local/state/fnm_multishells/*/bin/codex 2>/dev/null | head -n 1) && [ -n "$latest_fnm_codex" ]; then PATH="$(dirname "$latest_fnm_codex"):$PATH" "$latest_fnm_codex" ${appServerCommand};`,
    `elif [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 && command -v codex >/dev/null 2>&1; then codex ${appServerCommand};`,
    `else echo 'codex binary not found on PATH/homebrew/local/fnm/nvm; set explicit codex path in device config' >&2; exit 127; fi`
  ].join(" ");

const enhanceSshRuntimeError = (error: unknown, endpoint: string): RuntimeError => {
  if (error instanceof RuntimeError) {
    return error;
  }

  return new RuntimeError("ssh-runtime-failed", `SSH runtime failed for ${endpoint}`, {
    endpoint,
    cause: error instanceof Error ? error.message : String(error)
  });
};
