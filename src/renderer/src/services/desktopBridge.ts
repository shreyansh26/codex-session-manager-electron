import type {
  DeviceAddLocalRequest,
  DeviceAddSshRequest,
  DeviceRecord,
  SearchBootstrapStatus,
  SearchIndexThreadPayload,
  SearchQueryRequest,
  SearchQueryResponse
} from "../domain/types";
import type { ThemePreference, ThemePreferenceState } from "../types/codexDesktop";

export const listDevices = async (): Promise<DeviceRecord[]> =>
  window.codexDesktop.devices.list();

export const addLocalDevice = async (
  request: DeviceAddLocalRequest
): Promise<DeviceRecord> => window.codexDesktop.devices.addLocal(request);

export const addSshDevice = async (
  request: DeviceAddSshRequest
): Promise<DeviceRecord> => window.codexDesktop.devices.addSsh(request);

export const connectDevice = async (deviceId: string): Promise<DeviceRecord> =>
  window.codexDesktop.devices.connect(deviceId);

export const disconnectDevice = async (deviceId: string): Promise<DeviceRecord> =>
  window.codexDesktop.devices.disconnect(deviceId);

export const removeDevice = async (deviceId: string): Promise<DeviceRecord[]> =>
  window.codexDesktop.devices.remove(deviceId);

export const searchIndexUpsertThread = async (
  request: SearchIndexThreadPayload
): Promise<void> => window.codexDesktop.search.upsertThread(request);

export const searchIndexRemoveDevice = async (deviceId: string): Promise<void> =>
  window.codexDesktop.search.removeDevice(deviceId);

export const searchQuery = async (
  request: SearchQueryRequest
): Promise<SearchQueryResponse> => window.codexDesktop.search.query(request);

export const searchBootstrapStatus = async (): Promise<SearchBootstrapStatus> =>
  window.codexDesktop.search.bootstrapStatus();

export const getThemePreference = async (): Promise<ThemePreferenceState> =>
  window.codexDesktop.theme.getPreference();

export const setThemePreference = async (
  preference: ThemePreference
): Promise<ThemePreferenceState> => window.codexDesktop.theme.setPreference(preference);

export const subscribeThemePreference = (
  listener: (state: ThemePreferenceState) => void
): (() => void) => window.codexDesktop.theme.subscribe(listener);
