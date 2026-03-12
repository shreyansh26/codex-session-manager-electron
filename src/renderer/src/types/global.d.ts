import type {
  HarnessPreloadBridge,
  HarnessRendererHooks
} from "../../../shared/diagnostics/bridge"
import type { CodexDesktopApi } from "./codexDesktop"

declare global {
  interface Window {
    codexDesktop: CodexDesktopApi
    __CODEX_HARNESS__?: HarnessPreloadBridge
    __CODEX_RENDERER_HOOKS__?: HarnessRendererHooks
  }
}

export {}
