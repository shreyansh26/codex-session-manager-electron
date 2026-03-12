import type {
  DeviceConnectionRecord,
  LocalDeviceConfigRecord,
  SshDeviceConfigRecord
} from "../../../../shared/schema/contracts";
import { MOCK_CONNECTED_AT_MS } from "../../../../shared/mock/mockHost";

type MockRuntimeConfig = LocalDeviceConfigRecord | SshDeviceConfigRecord;

export interface MockRuntimeStartResult {
  endpoint: string;
  connection: DeviceConnectionRecord;
}

export class MockRuntimeManager {
  private endpoint: string | null = null;

  async start(config: MockRuntimeConfig): Promise<MockRuntimeStartResult> {
    const endpoint = buildMockEndpoint(config);
    this.endpoint = endpoint;
    return {
      endpoint,
      connection: {
        endpoint,
        transport: "mock-jsonrpc",
        connectedAtMs: MOCK_CONNECTED_AT_MS
      }
    };
  }

  async stop(): Promise<void> {
    this.endpoint = null;
  }
}

export const buildMockEndpoint = (config: MockRuntimeConfig): string => {
  if (config.kind === "local") {
    const workspace = sanitizeEndpointSegment(
      config.workspaceRoot ?? "mock-local-device"
    );
    return `mock://local/${workspace}`;
  }

  const host = sanitizeEndpointSegment(config.host);
  const user = sanitizeEndpointSegment(config.user);
  return `mock://ssh/${user}@${host}:${config.sshPort}`;
};

const sanitizeEndpointSegment = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._/@:-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "") || "mock";
