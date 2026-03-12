import type { IpcRenderer } from "electron";
import { IPC_CHANNELS } from "../main/ipc/channels";
import type { HarnessPreloadBridge } from "../shared/diagnostics/bridge";
import { ipcErrorEnvelopeSchema } from "../shared/schema/contracts";
import type { CodexDesktopApi } from "../renderer/src/types/codexDesktop";

type IpcRendererLike = Pick<IpcRenderer, "invoke" | "on" | "removeListener">;

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) {
    try {
      const parsed = ipcErrorEnvelopeSchema.parse(JSON.parse(error.message));
      const normalized = new Error(parsed.message);
      Object.assign(normalized, parsed);
      return normalized;
    } catch {
      return error;
    }
  }

  return new Error(String(error));
};

const invoke = async <T>(
  ipcRenderer: IpcRendererLike,
  channel: string,
  payload?: unknown
): Promise<T> => {
  try {
    return payload === undefined
      ? ((await ipcRenderer.invoke(channel)) as T)
      : ((await ipcRenderer.invoke(channel, payload)) as T);
  } catch (error) {
    throw normalizeError(error);
  }
};

export const createDesktopApi = (
  ipcRenderer: IpcRendererLike,
  versions: CodexDesktopApi["versions"],
  currentPlatform: string
): CodexDesktopApi => ({
  platform: currentPlatform,
  versions,
  devices: {
    list: () => invoke(ipcRenderer, IPC_CHANNELS.devicesList),
    addLocal: (request) => invoke(ipcRenderer, IPC_CHANNELS.devicesAddLocal, request),
    addSsh: (request) => invoke(ipcRenderer, IPC_CHANNELS.devicesAddSsh, request),
    connect: (deviceId) =>
      invoke(ipcRenderer, IPC_CHANNELS.devicesConnect, { deviceId }),
    disconnect: (deviceId) =>
      invoke(ipcRenderer, IPC_CHANNELS.devicesDisconnect, { deviceId }),
    remove: (deviceId) =>
      invoke(ipcRenderer, IPC_CHANNELS.devicesRemove, { deviceId })
  },
  search: {
    upsertThread: (request) =>
      invoke(ipcRenderer, IPC_CHANNELS.searchUpsertThread, request),
    removeDevice: (deviceId) =>
      invoke(ipcRenderer, IPC_CHANNELS.searchRemoveDevice, { deviceId }),
    query: (request) => invoke(ipcRenderer, IPC_CHANNELS.searchQuery, request),
    bootstrapStatus: () => invoke(ipcRenderer, IPC_CHANNELS.searchBootstrapStatus)
  },
  theme: {
    getPreference: () => invoke(ipcRenderer, IPC_CHANNELS.themeGetPreference),
    setPreference: (preference) =>
      invoke(ipcRenderer, IPC_CHANNELS.themeSetPreference, preference),
    subscribe: (listener) => {
      const wrapped = (_event: unknown, state: unknown) => {
        listener(state as Awaited<ReturnType<CodexDesktopApi["theme"]["getPreference"]>>);
      };
      ipcRenderer.on(IPC_CHANNELS.themeUpdated, wrapped);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.themeUpdated, wrapped);
      };
    }
  }
});

export const createHarnessBridge = (
  ipcRenderer: IpcRendererLike
): HarnessPreloadBridge => ({
  async recordLifecycle(event, severity = "info", metadata) {
    try {
      await invoke(ipcRenderer, IPC_CHANNELS.diagnosticsRecordLifecycle, {
        event,
        severity,
        ...(metadata ? { metadata } : {})
      });
    } catch {
      // Diagnostics must not break preload or renderer startup.
    }
  },
  async snapshotState(label, state) {
    try {
      await invoke(ipcRenderer, IPC_CHANNELS.diagnosticsSnapshotState, {
        label,
        state
      });
    } catch {
      // Diagnostics must not break preload or renderer startup.
    }
  }
});
