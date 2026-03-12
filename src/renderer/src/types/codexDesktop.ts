import type {
  DeviceAddLocalRequest,
  DeviceAddSshRequest,
  DeviceRecord,
  SearchBootstrapStatus,
  SearchIndexThreadPayload,
  SearchQueryRequest,
  SearchQueryResponse
} from "../domain/types";
import type {
  ThemeMode,
  ThemePreference,
  ThemePreferenceState
} from "../../../shared/schema/contracts";

export type { ThemeMode, ThemePreference, ThemePreferenceState };

export interface CodexDesktopApi {
  platform: string;
  versions: {
    chrome: string;
    electron: string;
    node: string;
  };
  devices: {
    list: () => Promise<DeviceRecord[]>;
    addLocal: (request: DeviceAddLocalRequest) => Promise<DeviceRecord>;
    addSsh: (request: DeviceAddSshRequest) => Promise<DeviceRecord>;
    connect: (deviceId: string) => Promise<DeviceRecord>;
    disconnect: (deviceId: string) => Promise<DeviceRecord>;
    remove: (deviceId: string) => Promise<DeviceRecord[]>;
  };
  search: {
    upsertThread: (request: SearchIndexThreadPayload) => Promise<void>;
    removeDevice: (deviceId: string) => Promise<void>;
    query: (request: SearchQueryRequest) => Promise<SearchQueryResponse>;
    bootstrapStatus: () => Promise<SearchBootstrapStatus>;
  };
  theme: {
    getPreference: () => Promise<ThemePreferenceState>;
    setPreference: (preference: ThemePreference) => Promise<ThemePreferenceState>;
    subscribe: (listener: (state: ThemePreferenceState) => void) => () => void;
  };
}
