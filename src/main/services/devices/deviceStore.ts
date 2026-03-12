import { randomUUID } from "node:crypto";
import {
  persistedDevicesSchema,
  type DeviceAddLocalRequestRecord,
  type DeviceAddSshRequestRecord,
  type DeviceRecordSchemaType,
  type PersistedDevices
} from "../../../shared/schema/contracts";
import { readJsonFile, writeJsonFileAtomic } from "../storage/jsonFileStore";

const DEFAULT_SSH_PORT = 22;
const DEFAULT_REMOTE_APP_SERVER_PORT = 45231;

export class DeviceStore {
  constructor(private readonly devicesPath: string) {}

  async list(): Promise<DeviceRecordSchemaType[]> {
    const persisted = await readJsonFile(this.devicesPath, persistedDevicesSchema);
    if (!persisted) {
      return [];
    }
    return sanitizeDevices(persisted.devices);
  }

  async save(devices: DeviceRecordSchemaType[]): Promise<void> {
    const payload: PersistedDevices = {
      devices: sanitizeDevices(devices)
    };
    await writeJsonFileAtomic(this.devicesPath, payload);
  }

  createLocalDevice(request: DeviceAddLocalRequestRecord): DeviceRecordSchemaType {
    return {
      id: resolveDeviceId("local", request.name),
      name: request.name ?? "Local Device",
      config: {
        kind: "local",
        appServerPort: request.appServerPort,
        codexBin: request.codexBin,
        workspaceRoot: request.workspaceRoot
      },
      connected: false,
      connection: null,
      lastError: null
    };
  }

  createSshDevice(request: DeviceAddSshRequestRecord): DeviceRecordSchemaType {
    return {
      id: resolveDeviceId("ssh", `${request.user}-${request.host}`),
      name: request.name ?? `${request.user}@${request.host}`,
      config: {
        kind: "ssh",
        host: request.host,
        user: request.user,
        sshPort: request.sshPort ?? DEFAULT_SSH_PORT,
        identityFile: request.identityFile,
        remoteAppServerPort: request.remoteAppServerPort ?? DEFAULT_REMOTE_APP_SERVER_PORT,
        localForwardPort: request.localForwardPort,
        codexBin: request.codexBin,
        workspaceRoot: request.workspaceRoot
      },
      connected: false,
      connection: null,
      lastError: null
    };
  }
}

const sanitizeDevices = (devices: DeviceRecordSchemaType[]): DeviceRecordSchemaType[] =>
  [...devices]
    .map((device) => ({
      ...device,
      connected: false,
      connection: null,
      lastError: null
    }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));

const resolveDeviceId = (kind: "local" | "ssh", seed?: string): string => {
  if (process.env.HARNESS_MODE !== "mock") {
    return randomUUID();
  }

  if (kind === "local") {
    return "mock-local-device";
  }

  const normalizedSeed = (seed ?? "device")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `mock-ssh-${normalizedSeed || "device"}`;
};
