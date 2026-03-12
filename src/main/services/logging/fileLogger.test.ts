import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileLogger } from "./fileLogger";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "codex-logger-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("FileLogger", () => {
  it("writes json lines and redacts sensitive metadata", async () => {
    const dir = await createTempDir();
    const logger = new FileLogger(join(dir, "logs", "main.log"), () => "2026-03-12T00:00:00.000Z");

    await logger.info("bootstrap-ready", {
      identityFile: "/secret/id_ed25519",
      codexBin: "/custom/bin/codex",
      count: 2
    });

    const contents = await readFile(logger.getFilePath(), "utf8");
    expect(contents).toContain('"message":"bootstrap-ready"');
    expect(contents).toContain('"identityFile":"[REDACTED]"');
    expect(contents).toContain('"codexBin":"[REDACTED]"');
    expect(contents).toContain('"count":2');
  });
});
