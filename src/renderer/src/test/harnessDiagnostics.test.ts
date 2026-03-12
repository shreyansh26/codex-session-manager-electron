import { describe, expect, it, vi } from "vitest";
import type { HarnessRendererHooks } from "../../../shared/diagnostics/bridge";
import {
  installRendererDiagnostics,
  recordRendererFirstRender
} from "../services/harnessDiagnostics";

const createWindowStub = () => {
  const listeners = new Map<string, EventListener[]>();
  const windowLike = {
    __CODEX_HARNESS__: {
      recordLifecycle: vi.fn(async () => undefined),
      snapshotState: vi.fn(async () => undefined)
    },
    addEventListener: vi.fn((event: string, listener: EventListener) => {
      const current = listeners.get(event) ?? [];
      listeners.set(event, [...current, listener]);
    }),
    removeEventListener: vi.fn((event: string, listener: EventListener) => {
      const current = listeners.get(event) ?? [];
      listeners.set(
        event,
        current.filter((entry) => entry !== listener)
      );
    }),
    __CODEX_RENDERER_HOOKS__: undefined as HarnessRendererHooks | undefined
  };

  return {
    windowLike,
    emit: (event: string, payload: Event) => {
      for (const listener of listeners.get(event) ?? []) {
        listener(payload);
      }
    }
  };
};

describe("installRendererDiagnostics", () => {
  it("records renderer errors and exposes harness-only snapshot hooks", async () => {
    const { windowLike, emit } = createWindowStub();
    const consoleLike = {
      error: vi.fn()
    };

    const cleanup = installRendererDiagnostics({
      windowLike,
      consoleLike,
      getStateSnapshot: () => ({ devices: 1 })
    });

    consoleLike.error("boom");
    emit(
      "error",
      ({
        message: "Renderer exploded",
        filename: "App.tsx",
        lineno: 14,
        colno: 3
      } as unknown) as Event
    );
    await windowLike.__CODEX_RENDERER_HOOKS__?.pushStateSnapshot("after-error");

    expect(windowLike.__CODEX_HARNESS__.recordLifecycle).toHaveBeenCalledWith(
      "renderer.console-error",
      "error",
      expect.objectContaining({
        args: ["boom"]
      })
    );
    expect(windowLike.__CODEX_HARNESS__.recordLifecycle).toHaveBeenCalledWith(
      "renderer.page-error",
      "error",
      expect.objectContaining({
        message: "Renderer exploded",
        filename: "App.tsx"
      })
    );
    expect(windowLike.__CODEX_HARNESS__.snapshotState).toHaveBeenCalledWith(
      "after-error",
      { devices: 1 }
    );

    cleanup();
  });

  it("records first render through the preload harness bridge", async () => {
    const { windowLike } = createWindowStub();
    await recordRendererFirstRender(windowLike);

    expect(windowLike.__CODEX_HARNESS__.recordLifecycle).toHaveBeenCalledWith(
      "renderer.first-render",
      "info"
    );
  });
});
