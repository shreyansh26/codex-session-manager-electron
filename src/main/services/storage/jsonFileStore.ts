import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ZodType } from "zod";

export const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    return !isMissingFileError(error);
  }
};

export const readJsonFile = async <T>(
  filePath: string,
  schema: ZodType<T>
): Promise<T | null> => {
  try {
    const raw = await readFile(filePath, "utf8");
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
};

export const writeJsonFileAtomic = async (
  filePath: string,
  data: unknown
): Promise<void> => {
  await writeFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
};

export const writeFileAtomic = async (
  filePath: string,
  data: string | Uint8Array,
  encoding?: BufferEncoding
): Promise<void> => {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now().toString(36)}-${randomUUID()}`;

  try {
    if (typeof data === "string") {
      await writeFile(temporaryPath, data, encoding ?? "utf8");
    } else {
      await writeFile(temporaryPath, data);
    }
    await rename(temporaryPath, filePath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // Ignore cleanup failures for missing temp files.
    }
    throw error;
  }
};

export const backupFileIfExists = async (
  filePath: string,
  backupPath: string
): Promise<boolean> => {
  try {
    await copyFile(filePath, backupPath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
};

const isMissingFileError = (error: unknown): boolean =>
  error instanceof Error &&
  "code" in error &&
  (error as NodeJS.ErrnoException).code === "ENOENT";
