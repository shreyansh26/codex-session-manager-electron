import { contextBridge, ipcRenderer } from 'electron'
import { HARNESS_PRELOAD_GLOBAL } from '../shared/diagnostics/bridge'
import { createDesktopApi, createHarnessBridge } from './api'

const harnessBridge = createHarnessBridge(ipcRenderer)

contextBridge.exposeInMainWorld(
  'codexDesktop',
  createDesktopApi(
    ipcRenderer,
    {
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      node: process.versions.node
    },
    process.platform
  )
)

contextBridge.exposeInMainWorld(HARNESS_PRELOAD_GLOBAL, harnessBridge)

void harnessBridge.recordLifecycle("preload.ready", "info", {
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node
  }
})
