import type { BrowserWindow } from "electron";
import {
  diagnosticsLifecycleRequestSchema,
  diagnosticsStateSnapshotRequestSchema
} from "../../shared/diagnostics/bridge";
import {
  deviceAddLocalRequestSchema,
  deviceAddSshRequestSchema,
  deviceIdRequestSchema,
  ipcErrorEnvelopeSchema,
  searchIndexThreadPayloadSchema,
  searchQueryRequestSchema,
  themePreferenceSchema
} from "../../shared/schema/contracts";
import type { DeviceService } from "../services/devices/deviceService";
import type { HarnessDiagnostics } from "../services/diagnostics/harnessDiagnostics";
import type { SearchIndexService } from "../services/search/searchIndexService";
import type { ThemeService } from "../services/theme/themeService";
import { IPC_CHANNELS } from "./channels";

export interface IpcMainLike {
  handle: (
    channel: string,
    listener: (_event: unknown, payload?: unknown) => unknown
  ) => void;
}

export interface RegisterIpcHandlersOptions {
  ipcMain: IpcMainLike;
  deviceService: DeviceService;
  searchIndexService: SearchIndexService;
  themeService: ThemeService;
  diagnostics?: HarnessDiagnostics;
  getWindows?: () => Array<Pick<BrowserWindow, "webContents">>;
}

export const registerIpcHandlers = ({
  ipcMain,
  deviceService,
  searchIndexService,
  themeService,
  diagnostics,
  getWindows = () => []
}: RegisterIpcHandlersOptions): void => {
  const handle = (
    channel: string,
    action: (payload?: unknown) => Promise<unknown> | unknown,
    options?: {
      successEvent?: "theme.changed" | "device.changed" | "search.changed";
    }
  ) => {
    ipcMain.handle(channel, async (_event, payload) => {
      const startedAt = Date.now();
      await diagnostics?.recordLifecycle("ipc.request", "info", {
        channel
      });
      try {
        const result = await Promise.race([
          Promise.resolve(action(payload)),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("IPC handler timed out")), 30_000)
          )
        ]);
        await diagnostics?.recordLifecycle("ipc.response", "info", {
          channel,
          durationMs: Date.now() - startedAt,
          status: "ok"
        });
        if (options?.successEvent) {
          await diagnostics?.recordLifecycle(options.successEvent, "info", {
            channel
          });
        }
        return result;
      } catch (error) {
        await diagnostics?.recordFailure("ipc.response", error, {
          channel,
          durationMs: Date.now() - startedAt
        });
        const envelope = ipcErrorEnvelopeSchema.parse({
          version: 1,
          code: "ipc/handler-failed",
          message: error instanceof Error ? error.message : String(error),
          retryable: false
        });
        throw new Error(JSON.stringify(envelope));
      }
    });
  };

  handle(IPC_CHANNELS.devicesList, () => deviceService.list());
  handle(IPC_CHANNELS.devicesAddLocal, (payload) =>
    deviceService.addLocal(deviceAddLocalRequestSchema.parse(payload)),
    { successEvent: "device.changed" }
  );
  handle(IPC_CHANNELS.devicesAddSsh, (payload) =>
    deviceService.addSsh(deviceAddSshRequestSchema.parse(payload)),
    { successEvent: "device.changed" }
  );
  handle(IPC_CHANNELS.devicesConnect, (payload) =>
    deviceService.connect(deviceIdRequestSchema.parse(payload).deviceId),
    { successEvent: "device.changed" }
  );
  handle(IPC_CHANNELS.devicesDisconnect, (payload) =>
    deviceService.disconnect(deviceIdRequestSchema.parse(payload).deviceId),
    { successEvent: "device.changed" }
  );
  handle(IPC_CHANNELS.devicesRemove, (payload) =>
    deviceService.remove(deviceIdRequestSchema.parse(payload).deviceId),
    { successEvent: "device.changed" }
  );

  handle(IPC_CHANNELS.searchUpsertThread, (payload) =>
    searchIndexService.upsertThread(searchIndexThreadPayloadSchema.parse(payload)),
    { successEvent: "search.changed" }
  );
  handle(IPC_CHANNELS.searchRemoveDevice, (payload) =>
    searchIndexService.removeDevice(deviceIdRequestSchema.parse(payload).deviceId),
    { successEvent: "search.changed" }
  );
  handle(IPC_CHANNELS.searchQuery, (payload) =>
    searchIndexService.query(searchQueryRequestSchema.parse(payload)),
    { successEvent: "search.changed" }
  );
  handle(IPC_CHANNELS.searchBootstrapStatus, () => searchIndexService.bootstrapStatus());

  handle(IPC_CHANNELS.themeGetPreference, () => themeService.getPreference());
  handle(IPC_CHANNELS.themeSetPreference, async (payload) => {
    const state = await themeService.setPreference(themePreferenceSchema.parse(payload));
    for (const window of getWindows()) {
      window.webContents.send(IPC_CHANNELS.themeUpdated, state);
    }
    return state;
  }, { successEvent: "theme.changed" });
  handle(IPC_CHANNELS.diagnosticsRecordLifecycle, (payload) => {
    const request = diagnosticsLifecycleRequestSchema.parse(payload);
    return diagnostics?.recordLifecycle(
      request.event,
      request.severity,
      request.metadata
    );
  });
  handle(IPC_CHANNELS.diagnosticsSnapshotState, (payload) => {
    const request = diagnosticsStateSnapshotRequestSchema.parse(payload);
    return diagnostics?.snapshotState(request.label, request.state);
  });
};
