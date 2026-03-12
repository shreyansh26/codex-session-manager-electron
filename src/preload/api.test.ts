import { describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "../main/ipc/channels";
import { createHarnessBridge } from "./api";

describe("createHarnessBridge", () => {
  it("swallows diagnostics IPC failures so preload boot does not crash", async () => {
    const invoke = vi
      .fn()
      .mockRejectedValueOnce(new Error("no diagnostics"))
      .mockResolvedValueOnce(undefined);

    const bridge = createHarnessBridge({
      invoke,
      on: vi.fn(),
      removeListener: vi.fn()
    });

    await expect(
      bridge.recordLifecycle("preload.ready", "info", { phase: "boot" })
    ).resolves.toBeUndefined();
    await expect(
      bridge.snapshotState("renderer", { loading: false })
    ).resolves.toBeUndefined();

    expect(invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.diagnosticsRecordLifecycle, {
      event: "preload.ready",
      severity: "info",
      metadata: { phase: "boot" }
    });
    expect(invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.diagnosticsSnapshotState, {
      label: "renderer",
      state: { loading: false }
    });
  });
});
