import { nativeTheme } from "electron";
import {
  preferencesSchema,
  themePreferenceStateSchema,
  type AppPreferences,
  type ThemePreference,
  type ThemePreferenceState
} from "../../../shared/schema/contracts";
import { readJsonFile, writeJsonFileAtomic } from "../storage/jsonFileStore";

export class ThemeService {
  private listeners = new Set<(state: ThemePreferenceState) => void>();
  private preference: ThemePreference | null = null;
  private initialized = false;

  constructor(private readonly preferencesPath: string) {
    nativeTheme.on("updated", () => {
      void this.emit();
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    const persisted = await readJsonFile(this.preferencesPath, preferencesSchema);
    this.preference = persisted?.themePreference ?? null;
    this.syncNativeTheme();
    this.initialized = true;
  }

  async getPreference(): Promise<ThemePreferenceState> {
    await this.initialize();
    return this.currentState();
  }

  async setPreference(preference: ThemePreference): Promise<ThemePreferenceState> {
    await this.initialize();
    this.preference = preference;
    this.syncNativeTheme();
    const payload: AppPreferences = {
      version: 1,
      themePreference: preference
    };
    await writeJsonFileAtomic(this.preferencesPath, preferencesSchema.parse(payload));
    await this.emit();
    return this.currentState();
  }

  subscribe(listener: (state: ThemePreferenceState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async emit(): Promise<void> {
    const state = this.currentState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  private currentState(): ThemePreferenceState {
    const resolved = nativeTheme.shouldUseDarkColors ? "dark" : "light";
    return themePreferenceStateSchema.parse({
      preference: this.preference ?? resolved,
      resolved
    });
  }

  private syncNativeTheme(): void {
    nativeTheme.themeSource = this.preference ?? "system";
  }
}
