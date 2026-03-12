import {
  deviceAddLocalRequestSchema,
  deviceAddSshRequestSchema,
  type DeviceConfigRecord,
  type DeviceAddLocalRequestRecord,
  type DeviceAddSshRequestRecord,
  type DeviceRecordSchemaType
} from "../../../shared/schema/contracts";
import { SearchIndexService } from "../search/searchIndexService";
import { DeviceStore } from "./deviceStore";
import { LocalRuntimeManager } from "../runtime/local/localRuntime";
import { MockRuntimeManager } from "../runtime/mock/mockRuntime";
import { SshRuntimeManager } from "../runtime/ssh/sshRuntime";

type RuntimeManager = LocalRuntimeManager | SshRuntimeManager | MockRuntimeManager;

export class DeviceService {
  private devices = new Map<string, DeviceRecordSchemaType>();
  private runtimes = new Map<string, RuntimeManager>();

  private constructor(
    private readonly store: DeviceStore,
    private readonly searchIndexService: SearchIndexService,
    private readonly env: Readonly<Record<string, string | undefined>>
  ) {}

  static async create(
    store: DeviceStore,
    searchIndexService: SearchIndexService,
    options: {
      env?: Readonly<Record<string, string | undefined>>;
    } = {}
  ): Promise<DeviceService> {
    const service = new DeviceService(
      store,
      searchIndexService,
      options.env ?? process.env
    );
    const persistedDevices = await store.list();
    for (const device of persistedDevices) {
      const normalized = service.toMockDeviceIfNeeded(device);
      service.devices.set(normalized.id, normalized);
    }
    return service;
  }

  list(): DeviceRecordSchemaType[] {
    return [...this.devices.values()].sort(
      (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    );
  }

  async addLocal(request: DeviceAddLocalRequestRecord): Promise<DeviceRecordSchemaType> {
    const parsed = deviceAddLocalRequestSchema.parse(request);
    const device = this.toMockDeviceIfNeeded(this.store.createLocalDevice(parsed));
    this.devices.set(device.id, device);
    await this.persist();
    return device;
  }

  async addSsh(request: DeviceAddSshRequestRecord): Promise<DeviceRecordSchemaType> {
    const parsed = deviceAddSshRequestSchema.parse(request);
    const device = this.toMockDeviceIfNeeded(this.store.createSshDevice(parsed));
    this.devices.set(device.id, device);
    await this.persist();
    return device;
  }

  async connect(deviceId: string): Promise<DeviceRecordSchemaType> {
    const current = this.requireDevice(deviceId);
    await this.disconnectIfNeeded(deviceId);

    const runtime =
      this.isMockMode()
        ? new MockRuntimeManager()
        : current.config.kind === "local"
          ? new LocalRuntimeManager()
          : new SshRuntimeManager();
    this.runtimes.set(deviceId, runtime);

    try {
      const { connection } = await runtime.start(current.config as never);
      const next = {
        ...current,
        connected: true,
        connection,
        lastError: null
      };
      this.devices.set(deviceId, next);
      await this.persist();
      return next;
    } catch (error) {
      this.runtimes.delete(deviceId);
      const next = {
        ...current,
        connected: false,
        connection: null,
        lastError: error instanceof Error ? error.message : String(error)
      };
      this.devices.set(deviceId, next);
      await this.persist();
      throw error;
    }
  }

  async disconnect(deviceId: string): Promise<DeviceRecordSchemaType> {
    const current = this.requireDevice(deviceId);
    await this.disconnectIfNeeded(deviceId);
    const next = {
      ...current,
      connected: false,
      connection: null
    };
    this.devices.set(deviceId, next);
    await this.persist();
    return next;
  }

  async remove(deviceId: string): Promise<DeviceRecordSchemaType[]> {
    await this.disconnectIfNeeded(deviceId);
    if (!this.devices.delete(deviceId)) {
      throw new Error(`Device not found: ${deviceId}`);
    }
    await this.persist();
    try {
      await this.searchIndexService.removeDevice(deviceId);
    } catch {
      // Keep Tauri-compatible best-effort cleanup semantics.
    }
    return this.list();
  }

  private requireDevice(deviceId: string): DeviceRecordSchemaType {
    const current = this.devices.get(deviceId);
    if (!current) {
      throw new Error(`Device not found: ${deviceId}`);
    }
    return current;
  }

  private async disconnectIfNeeded(deviceId: string): Promise<void> {
    const runtime = this.runtimes.get(deviceId);
    if (!runtime) {
      return;
    }
    this.runtimes.delete(deviceId);
    await runtime.stop();
  }

  private async persist(): Promise<void> {
    await this.store.save(this.list());
  }

  private isMockMode(): boolean {
    return this.env.HARNESS_MODE === "mock";
  }

  private toMockDeviceIfNeeded(device: DeviceRecordSchemaType): DeviceRecordSchemaType {
    if (!this.isMockMode()) {
      return device;
    }

    return {
      ...device,
      id: buildDeterministicMockDeviceId(device.config),
      lastError: null
    };
  }
}

const buildDeterministicMockDeviceId = (config: DeviceConfigRecord): string => {
  if (config.kind === "local") {
    return "mock-local-device";
  }

  const host = config.host.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const user = config.user.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `mock-ssh-${user}-${host}`.replace(/-+/g, "-");
};
