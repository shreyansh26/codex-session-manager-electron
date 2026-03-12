import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createConnection, createServer, type Server } from "node:net";
import { platform } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

export const DEFAULT_APP_SERVER_APPROVAL_CONFIG = 'approval_policy="never"';
export const DEFAULT_APP_SERVER_SANDBOX_CONFIG = 'sandbox_mode="danger-full-access"';

export type RuntimeStatus =
  | "idle"
  | "starting"
  | "connected"
  | "disconnecting"
  | "failed";

export interface RuntimeConnectionSnapshot {
  endpoint: string;
  transport: "websocket";
  connectedAtMs: number;
  localServerPid?: number;
  sshRemotePid?: number;
  sshForwardPid?: number;
}

export interface ManagedChildOptions {
  role: string;
  command: string;
  args: string[];
  cwd?: string;
  detached?: boolean;
}

export class RuntimeError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export class ManagedChild {
  readonly role: string;
  readonly child: ChildProcess;

  constructor(options: ManagedChildOptions) {
    this.role = options.role;
    this.child = spawn(options.command, options.args, {
      cwd: options.cwd,
      stdio: "ignore",
      detached: options.detached ?? platform() !== "win32"
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  async assertRunning(): Promise<void> {
    if (this.child.exitCode !== null) {
      throw new RuntimeError("process-exited", `${this.role} exited before becoming ready`, {
        role: this.role,
        exitCode: this.child.exitCode
      });
    }
  }

  async shutdown(): Promise<void> {
    if (this.child.exitCode !== null) {
      return;
    }

    try {
      if (platform() === "win32") {
        this.child.kill();
      } else if (this.child.pid) {
        process.kill(-this.child.pid, "SIGTERM");
      } else {
        this.child.kill("SIGTERM");
      }
    } catch {
      // Ignore best-effort termination failures here and rely on the next probe.
    }

    const exited = await waitForExit(this.child, 1_500);
    if (exited) {
      return;
    }

    try {
      if (platform() === "win32") {
        this.child.kill("SIGKILL");
      } else if (this.child.pid) {
        process.kill(-this.child.pid, "SIGKILL");
      } else {
        this.child.kill("SIGKILL");
      }
    } catch {
      // Ignore best-effort force kill failures.
    }

    await waitForExit(this.child, 1_500);
  }
}

export const quoteShell = (value: string): string => {
  if (!value) {
    return "''";
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
};

export const buildAppServerProcessArgs = (listenUri: string): string[] => [
  "app-server",
  "-c",
  DEFAULT_APP_SERVER_APPROVAL_CONFIG,
  "-c",
  DEFAULT_APP_SERVER_SANDBOX_CONFIG,
  "--listen",
  listenUri
];

export const buildAppServerShellCommand = (listenUri: string): string =>
  `app-server -c ${quoteShell(DEFAULT_APP_SERVER_APPROVAL_CONFIG)} -c ${quoteShell(DEFAULT_APP_SERVER_SANDBOX_CONFIG)} --listen ${quoteShell(listenUri)}`;

export const buildUnixCodexLaunchCommand = ({
  listenUri,
  codexBin
}: {
  listenUri: string;
  codexBin?: string;
}): string => {
  const appServerCommand = buildAppServerShellCommand(listenUri);
  if (codexBin) {
    const lastSlash = codexBin.lastIndexOf("/");
    const codexDir = lastSlash > 0 ? codexBin.slice(0, lastSlash) : null;
    if (codexDir) {
      return `PATH=${quoteShell(codexDir)}:$PATH ${quoteShell(codexBin)} ${appServerCommand}`;
    }
    return `${quoteShell(codexBin)} ${appServerCommand}`;
  }

  return [
    `if command -v codex >/dev/null 2>&1; then codex ${appServerCommand};`,
    `elif [ -x /opt/homebrew/bin/codex ]; then PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/codex ${appServerCommand};`,
    `elif [ -x /usr/local/bin/codex ]; then PATH=/usr/local/bin:$PATH /usr/local/bin/codex ${appServerCommand};`,
    `elif [ -x "$HOME/.local/bin/codex" ]; then PATH="$HOME/.local/bin:$PATH" "$HOME/.local/bin/codex" ${appServerCommand};`,
    `elif command -v fnm >/dev/null 2>&1 && eval "$(fnm env --shell bash)" >/dev/null 2>&1 && command -v codex >/dev/null 2>&1; then codex ${appServerCommand};`,
    `elif [ -d "$HOME/.local/state/fnm_multishells" ] && latest_fnm_codex=$(ls -t "$HOME"/.local/state/fnm_multishells/*/bin/codex 2>/dev/null | head -n 1) && [ -n "$latest_fnm_codex" ]; then PATH="$(dirname "$latest_fnm_codex"):$PATH" "$latest_fnm_codex" ${appServerCommand};`,
    `elif [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 && command -v codex >/dev/null 2>&1; then codex ${appServerCommand};`,
    `else echo 'codex binary not found on PATH/homebrew/local/fnm/nvm; set explicit local codex path in device config' >&2; exit 127; fi`
  ].join(" ");
};

export const allocatePort = async (): Promise<number> => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new RuntimeError("port-allocate-failed", "Failed to allocate a local port.");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
};

export const isTcpPortOpen = async (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });

export const resolveListenPort = async (requestedPort?: number): Promise<number> => {
  if (!requestedPort) {
    return allocatePort();
  }
  if (!(await isTcpPortOpen(requestedPort))) {
    return requestedPort;
  }
  return allocatePort();
};

export const websocketUpgradeSucceeds = async (localPort: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port: localPort });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 1_500);

    socket.once("connect", () => {
      const request =
        `GET / HTTP/1.1\r\nHost: 127.0.0.1:${localPort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`;
      socket.write(request);
    });
    socket.once("data", (buffer: Buffer) => {
      clearTimeout(timer);
      const response = buffer.toString("utf8");
      socket.destroy();
      resolve(response.startsWith("HTTP/1.1 101") || response.includes(" 101 "));
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });

export const waitForEndpointReady = async ({
  endpoint,
  localPort,
  timeoutMs,
  assertProcesses
}: {
  endpoint: string;
  localPort: number;
  timeoutMs: number;
  assertProcesses?: Array<() => Promise<void>>;
}): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await websocketUpgradeSucceeds(localPort)) {
      return;
    }

    if (assertProcesses) {
      for (const assertion of assertProcesses) {
        await assertion();
      }
    }

    await delay(180);
  }

  throw new RuntimeError("endpoint-not-ready", `Endpoint did not become ready: ${endpoint}`, {
    endpoint,
    timeoutMs
  });
};

const waitForExit = async (child: ChildProcess, timeoutMs: number): Promise<boolean> => {
  if (child.exitCode !== null) {
    return true;
  }

  const exitPromise = once(child, "exit").then(() => true).catch(() => true);
  const timeoutPromise = delay(timeoutMs).then(() => false);
  return Promise.race([exitPromise, timeoutPromise]);
};
