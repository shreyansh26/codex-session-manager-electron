import {
  HARNESS_PRELOAD_GLOBAL,
  HARNESS_RENDERER_GLOBAL,
  type HarnessPreloadBridge,
  type HarnessRendererHooks
} from "../../../shared/diagnostics/bridge";

interface WindowLike {
  addEventListener: (event: string, listener: EventListener) => void;
  removeEventListener: (event: string, listener: EventListener) => void;
}

interface ConsoleLike {
  error: (...args: unknown[]) => void;
}

type GlobalWindow = WindowLike &
  {
    [HARNESS_PRELOAD_GLOBAL]?: HarnessPreloadBridge;
    [HARNESS_RENDERER_GLOBAL]?: HarnessRendererHooks;
  };

export const installRendererDiagnostics = (options: {
  windowLike: GlobalWindow;
  consoleLike?: ConsoleLike;
  getStateSnapshot: () => unknown;
  captureHistoricalSessionTranscript?: (sessionKey: string) => Promise<unknown>;
}): (() => void) => {
  const bridge = options.windowLike[HARNESS_PRELOAD_GLOBAL];
  const consoleLike = options.consoleLike ?? console;
  const originalError = consoleLike.error.bind(consoleLike);

  const hooks: HarnessRendererHooks = {
    getStateSnapshot: () => options.getStateSnapshot(),
    pushStateSnapshot: async (label: string, state?: unknown) => {
      await bridge?.snapshotState(label, state ?? options.getStateSnapshot());
    },
    ...(options.captureHistoricalSessionTranscript
      ? {
          captureHistoricalSessionTranscript: async (sessionKey: string) =>
            options.captureHistoricalSessionTranscript?.(sessionKey) ?? null
        }
      : {})
  };

  Object.defineProperty(options.windowLike, HARNESS_RENDERER_GLOBAL, {
    value: hooks,
    configurable: true,
    enumerable: false,
    writable: false
  });

  const onError: EventListener = (event) => {
    const payload = event as Event & {
      message?: string;
      filename?: string;
      lineno?: number;
      colno?: number;
    };
    void bridge?.recordLifecycle("renderer.page-error", "error", {
      message: payload.message ?? "Unknown renderer error",
      filename: payload.filename,
      line: payload.lineno,
      column: payload.colno
    });
  };

  const onUnhandledRejection: EventListener = (event) => {
    const payload = event as Event & {
      reason?: unknown;
    };
    void bridge?.recordLifecycle("renderer.page-error", "error", {
      message: payload.reason instanceof Error ? payload.reason.message : String(payload.reason),
      source: "unhandledrejection"
    });
  };

  consoleLike.error = (...args: unknown[]) => {
    void bridge?.recordLifecycle("renderer.console-error", "error", {
      args: args.map(serializeConsoleArg)
    });
    originalError(...args);
  };

  options.windowLike.addEventListener("error", onError);
  options.windowLike.addEventListener("unhandledrejection", onUnhandledRejection);

  return () => {
    consoleLike.error = originalError;
    options.windowLike.removeEventListener("error", onError);
    options.windowLike.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
};

export const recordRendererFirstRender = async (
  windowLike: GlobalWindow
): Promise<void> => {
  await windowLike[HARNESS_PRELOAD_GLOBAL]?.recordLifecycle(
    "renderer.first-render",
    "info"
  );
};

const serializeConsoleArg = (value: unknown): unknown => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message
    };
  }
  return value;
};
