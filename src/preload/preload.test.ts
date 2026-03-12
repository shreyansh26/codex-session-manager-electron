import { describe, expect, it, vi } from "vitest";
import { createDesktopApi } from "./api";
import { IPC_CHANNELS } from "../main/ipc/channels";

describe("createDesktopApi", () => {
  it("invokes the expected channels and supports theme subscriptions", async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const ipcRenderer = {
      invoke: vi.fn(async (channel: string, payload?: unknown) => ({ channel, payload })),
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        listeners.set(channel, listener);
      }),
      removeListener: vi.fn((channel: string) => {
        listeners.delete(channel);
      })
    };

    const api = createDesktopApi(
      ipcRenderer as never,
      { chrome: "1", electron: "2", node: "3" },
      "darwin"
    );

    await api.devices.connect("device-1");
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.devicesConnect, {
      deviceId: "device-1"
    });

    const listener = vi.fn();
    const unsubscribe = api.theme.subscribe(listener);
    listeners.get(IPC_CHANNELS.themeUpdated)?.({}, { preference: "dark", resolved: "dark" });
    expect(listener).toHaveBeenCalledWith({ preference: "dark", resolved: "dark" });
    unsubscribe();
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.themeUpdated,
      expect.any(Function)
    );
  });
});
