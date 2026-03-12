import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { AppBootstrap } from "./services/bootstrap/appBootstrap";
import {
  createHarnessDiagnostics,
  type HarnessDiagnostics
} from "./services/diagnostics/harnessDiagnostics";
import { DeviceStore } from "./services/devices/deviceStore";
import { DeviceService } from "./services/devices/deviceService";
import { ThemeService } from "./services/theme/themeService";
import { registerIpcHandlers } from "./ipc/registerIpc";

let bootstrap: AppBootstrap | null = null;
const resolveUserDataDir = (): string =>
  process.env.HARNESS_USER_DATA_DIR?.trim() || app.getPath("userData");

function createMainWindow(diagnostics?: HarnessDiagnostics): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'Codex Session Monitor',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  })

  window.once('ready-to-show', () => {
    window.show()
  })
  void diagnostics?.recordLifecycle("main.window.created", "info", {
    width: 1280,
    height: 820
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    void diagnostics?.recordFailure(
      "main.render-process-gone",
      new Error(details.reason || "render process gone"),
      {
        exitCode: details.exitCode,
        reason: details.reason
      }
    );
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(async () => {
  const userDataDir = resolveUserDataDir();
  const diagnostics = createHarnessDiagnostics({
    userDataDir
  });
  bootstrap = new AppBootstrap({
    userDataDir,
    homeDir: app.getPath("home"),
    appDataDir: app.getPath("appData"),
    cwd: process.cwd(),
    diagnostics
  })

  process.on("uncaughtException", (error) => {
    void diagnostics.recordFailure("main.process-error", error);
  });
  process.on("unhandledRejection", (error) => {
    void diagnostics.recordFailure("main.process-error", error);
  });

  const bootstrapContext = await bootstrap.ensureReady()
  const deviceStore = new DeviceStore(bootstrapContext.statePaths.devicesPath)
  const deviceService = await DeviceService.create(
    deviceStore,
    bootstrapContext.searchIndexService
  )
  const themeService = new ThemeService(bootstrapContext.statePaths.preferencesPath)
  await themeService.initialize()
  registerIpcHandlers({
    ipcMain,
    deviceService,
    searchIndexService: bootstrapContext.searchIndexService,
    themeService,
    diagnostics,
    getWindows: () => BrowserWindow.getAllWindows()
  })
  createMainWindow(diagnostics)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(diagnostics)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
