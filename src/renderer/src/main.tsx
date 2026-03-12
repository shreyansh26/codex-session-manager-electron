import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import {
  installRendererDiagnostics,
  recordRendererFirstRender
} from "./services/harnessDiagnostics";
import { useAppStore } from "./state/useAppStore";
import "./styles/globals.css";
import "./styles/app.css";

installRendererDiagnostics({
  windowLike: window,
  getStateSnapshot: () => {
    const state = useAppStore.getState();
    return {
      loading: state.loading,
      initializing: state.initializing,
      devices: state.devices.map((device) => ({
        id: device.id,
        name: device.name,
        connected: device.connected,
        kind: device.config.kind
      })),
      sessions: state.sessions.map((session) => ({
        key: session.key,
        title: session.title,
        deviceId: session.deviceId
      })),
      selectedSessionKey: state.selectedSessionKey,
      globalError: state.globalError
    };
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

void recordRendererFirstRender(window);
