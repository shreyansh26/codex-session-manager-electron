import { z } from "zod";
import {
  diagnosticsMetadataSchema,
  lifecycleEventNameSchema
} from "./contracts";

export const HARNESS_PRELOAD_GLOBAL = "__CODEX_HARNESS__" as const;
export const HARNESS_RENDERER_GLOBAL = "__CODEX_RENDERER_HOOKS__" as const;

export const diagnosticsLifecycleRequestSchema = z.object({
  event: lifecycleEventNameSchema,
  severity: z.enum(["info", "warn", "error"]).optional(),
  metadata: diagnosticsMetadataSchema.optional()
});
export type DiagnosticsLifecycleRequest = z.infer<
  typeof diagnosticsLifecycleRequestSchema
>;

export const diagnosticsStateSnapshotRequestSchema = z.object({
  label: z.string().min(1),
  state: z.unknown()
});
export type DiagnosticsStateSnapshotRequest = z.infer<
  typeof diagnosticsStateSnapshotRequestSchema
>;

export interface HarnessPreloadBridge {
  recordLifecycle: (
    event: DiagnosticsLifecycleRequest["event"],
    severity?: DiagnosticsLifecycleRequest["severity"],
    metadata?: DiagnosticsLifecycleRequest["metadata"]
  ) => Promise<void>;
  snapshotState: (label: string, state: unknown) => Promise<void>;
}

export interface HarnessRendererHooks {
  getStateSnapshot: () => unknown;
  pushStateSnapshot: (label: string) => Promise<void>;
}
