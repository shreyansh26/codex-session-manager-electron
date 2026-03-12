import { describe, expect, it } from "vitest";
import { DeviceStore } from "./deviceStore";

describe("DeviceStore mock mode", () => {
  it("creates deterministic device ids when HARNESS_MODE=mock", () => {
    const previousMode = process.env.HARNESS_MODE;
    process.env.HARNESS_MODE = "mock";

    try {
      const store = new DeviceStore("/tmp/unused-devices.json");
      const local = store.createLocalDevice({ name: "Local Device" });
      const ssh = store.createSshDevice({
        host: "example.internal",
        user: "mock-user"
      });

      expect(local.id).toBe("mock-local-device");
      expect(ssh.id).toBe("mock-ssh-mock-user-example-internal");
    } finally {
      if (previousMode === undefined) {
        delete process.env.HARNESS_MODE;
      } else {
        process.env.HARNESS_MODE = previousMode;
      }
    }
  });
});
