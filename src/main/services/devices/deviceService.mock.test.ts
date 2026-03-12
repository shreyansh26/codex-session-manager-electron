import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MOCK_CONNECTED_AT_MS } from "../../../shared/mock/mockHost";
import { DeviceStore } from "./deviceStore";
import { DeviceService } from "./deviceService";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "codex-device-mock-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe("DeviceService mock mode", () => {
  it("creates deterministic local ids and connects through the mock runtime", async () => {
    const dir = await createTempDir();
    const store = new DeviceStore(join(dir, "devices.json"));
    const service = await DeviceService.create(
      store,
      {
        removeDevice: async () => 0
      } as never,
      {
        env: {
          HARNESS_MODE: "mock"
        }
      }
    );

    const device = await service.addLocal({
      name: "Local Device"
    });
    const connected = await service.connect(device.id);

    expect(device.id).toBe("mock-local-device");
    expect(connected.connected).toBe(true);
    expect(connected.connection?.endpoint).toBe("mock://local/mock-local-device");
    expect(connected.connection?.transport).toBe("mock-jsonrpc");
    expect(connected.connection?.connectedAtMs).toBe(MOCK_CONNECTED_AT_MS);
  });
});
