import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeJsonFileAtomic } from "./jsonFileStore";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "codex-json-store-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("writeJsonFileAtomic", () => {
  it("avoids temp-file collisions during concurrent writes", async () => {
    const dir = await createTempDir();
    const filePath = join(dir, "runtime-state.json");

    await expect(
      Promise.all([
        writeJsonFileAtomic(filePath, { status: "one" }),
        writeJsonFileAtomic(filePath, { status: "two" }),
        writeJsonFileAtomic(filePath, { status: "three" })
      ])
    ).resolves.toBeDefined();

    const parsed = JSON.parse(await readFile(filePath, "utf8")) as {
      status: string;
    };
    expect(["one", "two", "three"]).toContain(parsed.status);
  });
});
