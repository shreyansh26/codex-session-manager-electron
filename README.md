# Codex Session Monitor (Electron)

Electron-based desktop app for monitoring Codex sessions across:

- Local machine
- SSH-connected remote machines

## Features

- Unified session sidebar grouped by device and workspace folder
- Local and SSH device lifecycle management
- New session creation by browsing remote or local directories
- Live thread reading, optimistic send, and turn progress updates
- Search across indexed chat history
- Token and estimated USD cost display
- Light and dark theme toggle
- One-time import of existing Tauri `devices.json` and `search-index-v1.json`

## Prerequisites

- Node.js 20+
- `codex` CLI available locally
- `ssh` configured for any remote devices
- Authentication performed out-of-band with `codex login`

## Development

```bash
cd codex-app-electron
npm install
npm run typecheck
npm run test
npm run dev
```

## Validation

Targeted checks used during migration:

```bash
npm run test -- schema
npm run test -- storage
npm run test -- migration
npm run test -- local-runtime
npm run test -- ssh-runtime
npm run test -- search
npm run test -- bootstrap
npm run test -- logging
npm run test -- ipc
npm run test -- preload
```

Renderer parity checks:

```bash
npm run test -- useAppStore
npm run test -- sessionMerge
npm run test -- eventParser
npm run test -- codexApi
npm run test -- modelPricing
npm run test -- modelCatalog
npm run test -- sidebarGrouping
npm run test -- chatWindow
npm run test -- transcriptEmulation
```

## Harness

CLI-first harness commands:

```bash
npm run harness:smoke:mock
npm run harness:smoke:mock -- --entry ./out/main/index.js --run-id local-app-check
npm run harness:smoke:real -- --run-id real-smoke
npm run harness:report
npm run harness:query -- summary.status
```

How to use them:

- `harness:smoke:mock` defaults to the dedicated Electron fixture so the harness stack itself has a green baseline.
- Pass `--entry ./out/main/index.js` to aim mock smoke at the real app build once you want real UI coverage.
- `harness:smoke:real` reuses the same runner but first checks `codex`, `ssh`, and auth prerequisites. When they are missing or unsupported, it writes a structured skip summary instead of failing flakily.
- `harness:report` summarizes the latest finalized run under `.harness/diagnostics/runs/`.
- `harness:query` extracts a targeted field from stored artifacts, for example `summary.status` or `summary.notes`.

Artifacts:

- Run artifacts live under `codex-app-electron/.harness/diagnostics/runs/<run-directory>/`.
- Each finalized run can include `summary.json`, `runtime-state.json`, `screenshots/final.png`, `dom/final.html`, and `snapshots/runner-state.json`.

Recommended automated validation:

```bash
npm run test -- jsonFileStore harnessCli electronRunner realPrereqs
npm run harness:smoke:mock
```

Human-plus-agent validation loop:

- Launch the real app through the harness: `npm run harness:smoke:mock -- --entry ./out/main/index.js --run-id local-app-check`
- Inspect the resulting run with `npm run harness:report -- local-app-check--mock--dev`
- Drill into exact stored fields with `npm run harness:query -- summary.notes local-app-check--mock--dev`

## Packaging

Unsigned local macOS artifacts:

```bash
npm run build
npm run dist -- --dir
npm run dist -- --mac dmg
```

Artifacts are emitted under `codex-app-electron/dist/`.

## Tauri Import Behavior

On first launch, the Electron app checks the Tauri data directory candidates in the same order the Tauri app used for persistence:

1. OS app-data directory
2. Home directory fallback
3. Current working directory fallback

If Tauri state is found, Electron imports:

- `codex-session-monitor/devices.json`
- `codex-session-monitor/search-index-v1.json`

Import is idempotent and will not overwrite already-initialized Electron state.

## Logs

Bootstrap and host logs are written to:

`<userData>/logs/main.log`

Where `<userData>` is Electron's `app.getPath("userData")` directory for this app.

Sensitive metadata such as SSH identity paths, `codexBin`, host, user, and workspace roots are redacted in structured logs.

## Codex Discovery Diagnostics

For local and remote runtime launch, the app follows the Tauri-compatible discovery chain:

- `codex` already on `PATH`
- `/opt/homebrew/bin/codex`
- `/usr/local/bin/codex`
- `$HOME/.local/bin/codex`
- `fnm`
- `nvm`
- Explicit `codexBin` from device config

If none of those resolve, the runtime surfaces an actionable error telling the user to set an explicit local or remote Codex path in the device config.

## Notes

- Signing and notarization are intentionally out of scope for this migration stage.
- Runtime process state remains ephemeral across app restarts, matching the Tauri app's persistence semantics.
