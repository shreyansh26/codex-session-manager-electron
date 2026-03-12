import { mkdir, appendFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";

type LogLevel = "info" | "warn" | "error";

const REDACTED_KEYS = new Set([
  "identityFile",
  "host",
  "user",
  "codexBin",
  "workspaceRoot",
  "sourceRoot"
]);

export interface Logger {
  info: (message: string, metadata?: Record<string, unknown>) => Promise<void>;
  warn: (message: string, metadata?: Record<string, unknown>) => Promise<void>;
  error: (message: string, metadata?: Record<string, unknown>) => Promise<void>;
  getFilePath: () => string;
}

export class FileLogger implements Logger {
  constructor(
    private readonly filePath: string,
    private readonly nowIso: () => string = () => new Date().toISOString()
  ) {}

  async info(message: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.write("info", message, metadata);
  }

  async warn(message: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.write("warn", message, metadata);
  }

  async error(message: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.write("error", message, metadata);
  }

  getFilePath(): string {
    return this.filePath;
  }

  async readContents(): Promise<string> {
    return readFile(this.filePath, "utf8");
  }

  private async write(
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const payload = {
      timestamp: this.nowIso(),
      level,
      message,
      ...(metadata ? { metadata: redactMetadata(metadata) } : {})
    };
    await appendFile(this.filePath, `${JSON.stringify(payload)}\n`, "utf8");
  }
}

const redactMetadata = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => redactMetadata(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        REDACTED_KEYS.has(key) ? "[REDACTED]" : redactMetadata(entry)
      ])
    );
  }
  return value;
};
