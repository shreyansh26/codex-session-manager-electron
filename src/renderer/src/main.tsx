import React from "react";
import ReactDOM from "react-dom/client";
import { flushSync } from "react-dom";
import App from "./App";
import {
  findLatestRolloutPathForThread,
  readRolloutTimelineMessages
} from "./services/codexApi";
import {
  installRendererDiagnostics,
  recordRendererFirstRender
} from "./services/harnessDiagnostics";
import {
  captureTranscriptPhase,
  findMountedChatPanelRoot
} from "./services/reopenedSessionTranscriptCapture";
import { useAppStore } from "./state/useAppStore";
import "./styles/globals.css";
import "./styles/app.css";

const EMPTY_COST_DISPLAY = {
  costAvailable: false
} as const;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const waitForCondition = async (
  predicate: () => boolean,
  errorMessage: string,
  timeoutMs = 10_000,
  pollMs = 50
): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (predicate()) {
      return;
    }
    await sleep(pollMs);
  }
  throw new Error(errorMessage);
};

const waitForSelectedSessionMounted = async (sessionKey: string): Promise<void> => {
  await waitForCondition(
    () => {
      const state = useAppStore.getState();
      return (
        state.selectedSessionKey === sessionKey &&
        findMountedChatPanelRoot() !== null
      );
    },
    `Selected session ${sessionKey} did not mount in the renderer.`
  );
};

const waitForThreadHydration = async (
  sessionKey: string,
  timeoutMs = 10_000
): Promise<void> => {
  await waitForCondition(
    () => {
      const state = useAppStore.getState();
      const hydration = state.threadHydrationBySession[sessionKey];
      return (
        state.selectedSessionKey === sessionKey &&
        Boolean(hydration?.baseLoaded) &&
        !hydration?.baseLoading &&
        !hydration?.toolHistoryLoading
      );
    },
    `Thread hydration did not settle for ${sessionKey}.`,
    timeoutMs
  );
};

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
        deviceId: session.deviceId,
        threadId: session.threadId
      })),
      selectedSessionKey: state.selectedSessionKey,
      globalError: state.globalError
    };
  },
  captureHistoricalSessionTranscript: async (sessionKey) => {
    const initialState = useAppStore.getState();
    const initialSession = initialState.sessions.find((session) => session.key === sessionKey);
    if (!initialSession) {
      throw new Error(`Unknown session key for transcript capture: ${sessionKey}`);
    }

    flushSync(() => {
      useAppStore.setState({ selectedSessionKey: sessionKey });
    });
    await waitForSelectedSessionMounted(sessionKey);

    await useAppStore.getState().refreshThread(initialSession.deviceId, initialSession.threadId, {
      preserveSummary: true,
      hydrateRollout: false
    });
    await waitForThreadHydration(sessionKey, 30_000);

    const baseState = useAppStore.getState();
    const baseSession = baseState.sessions.find((session) => session.key === sessionKey);
    const baseMessages = baseState.messagesBySession[sessionKey] ?? [];
    const baseHydration =
      baseState.threadHydrationBySession[sessionKey] ?? {
        baseLoading: false,
        baseLoaded: false,
        toolHistoryLoading: false
      };
    const mountedRoot = findMountedChatPanelRoot();
    if (!baseSession || !mountedRoot) {
      throw new Error(`Base-loaded transcript capture failed for ${sessionKey}.`);
    }

    const baseCapture = await captureTranscriptPhase({
      session: baseSession,
      messages: baseMessages,
      hydrationState: baseHydration,
      phase: "base-loaded",
      mountedRoot,
      costDisplay: EMPTY_COST_DISPLAY
    });

    const baseDevice =
      baseState.devices.find((device) => device.id === baseSession.deviceId) ??
      initialState.devices.find((device) => device.id === initialSession.deviceId);
    let rolloutParsedCapture: Awaited<ReturnType<typeof captureTranscriptPhase>> | null = null;

    if (baseDevice) {
      const rolloutPath = await findLatestRolloutPathForThread(
        baseDevice,
        baseSession.threadId
      );
      if (typeof rolloutPath === "string" && rolloutPath.trim().length > 0) {
        const rolloutParsedMessages = await readRolloutTimelineMessages(
          baseDevice,
          baseSession.threadId,
          rolloutPath,
          baseSession.updatedAt
        );
        rolloutParsedCapture = await captureTranscriptPhase({
          session: baseSession,
          messages: rolloutParsedMessages,
          hydrationState: {
            ...baseHydration,
            toolHistoryLoading: true
          },
          phase: "rollout-parsed",
          costDisplay: EMPTY_COST_DISPLAY
        });
      }
    }

    await useAppStore.getState().refreshThread(initialSession.deviceId, initialSession.threadId, {
      preserveSummary: true,
      hydrateRollout: true
    });
    await waitForThreadHydration(sessionKey, 30_000);

    const rolloutState = useAppStore.getState();
    const rolloutSession = rolloutState.sessions.find((session) => session.key === sessionKey);
    const rolloutMessages = rolloutState.messagesBySession[sessionKey] ?? [];
    const rolloutHydration =
      rolloutState.threadHydrationBySession[sessionKey] ?? {
        baseLoading: false,
        baseLoaded: false,
        toolHistoryLoading: false
      };
    const rolloutRoot = findMountedChatPanelRoot();
    if (!rolloutSession || !rolloutRoot) {
      throw new Error(`Rollout-idle transcript capture failed for ${sessionKey}.`);
    }

    const rolloutCapture = await captureTranscriptPhase({
      session: rolloutSession,
      messages: rolloutMessages,
      hydrationState: rolloutHydration,
      phase: "rollout-applied",
      mountedRoot: rolloutRoot,
      costDisplay: EMPTY_COST_DISPLAY
    });

    return {
      sessionKey,
      threadId: rolloutSession.threadId,
      deviceId: rolloutSession.deviceId,
      captures: [
        baseCapture,
        ...(rolloutParsedCapture ? [rolloutParsedCapture] : []),
        rolloutCapture
      ]
    };
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

void recordRendererFirstRender(window);
