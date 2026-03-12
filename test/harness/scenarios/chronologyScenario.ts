import type { MockScenarioPage } from "./mockAppScenario";

export const runChronologyScenario = async (page: MockScenarioPage): Promise<void> => {
  const waitFor = async (
    predicate: () => unknown,
    message: string,
    timeout = 7_500
  ): Promise<void> => {
    if (!page.waitForFunction) {
      throw new Error(`Scenario page is missing waitForFunction for: ${message}`);
    }
    await page.waitForFunction(predicate, undefined, { timeout }).catch((error) => {
      throw new Error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  await waitFor(
    () => Boolean((window as Window & typeof globalThis).codexDesktop?.theme),
    "Preload bridge did not become available"
  );
  await waitFor(
    () => {
      const hooks = (window as Window & {
        __CODEX_RENDERER_HOOKS__?: { getStateSnapshot?: () => unknown };
      }).__CODEX_RENDERER_HOOKS__;
      const state = hooks?.getStateSnapshot?.() as
        | {
            sessions?: Array<{ title?: string; threadId?: string }>;
          }
        | undefined;
      return Boolean(
        state?.sessions?.some((session) => session.threadId === "thread-mock-003")
      );
    },
    "Chronology fixture session did not hydrate"
  );
  const artifact = await page.evaluate?.(
    async () => {
      const threadId = "thread-mock-003";
      const expectedOrder = [
        "user-turn-1::user::",
        "call-reused::tool::tool_call::2026-03-08T09:10:01.000Z",
        "user-turn-2::user::",
        "call-reused::tool::tool_call::2026-03-08T09:11:01.000Z"
      ];
      const hooks = (window as Window & {
        __CODEX_RENDERER_HOOKS__?: {
          getStateSnapshot?: () => unknown;
          pushStateSnapshot?: (label: string, state?: unknown) => Promise<void>;
          captureHistoricalSessionTranscript?: (sessionKey: string) => Promise<unknown>;
        };
      }).__CODEX_RENDERER_HOOKS__;
      const state = hooks?.getStateSnapshot?.() as
        | {
            sessions?: Array<{ key?: string; threadId?: string }>;
          }
        | undefined;
      const sessionKey = state?.sessions?.find((session) => session.threadId === threadId)?.key;
      if (!hooks?.captureHistoricalSessionTranscript || !sessionKey) {
        return null;
      }

      const capture = (await hooks.captureHistoricalSessionTranscript(sessionKey)) as {
        captures?: Array<{
          phase?: string;
          mountedVisible?: {
            storeVsDom?: { firstMismatchIndex?: number | null };
          };
          expandedFull?: {
            domEntries?: Array<{ renderKey?: string; textPreview?: string; toolStatus?: string | null }>;
            storeVsDom?: { firstMismatchIndex?: number | null };
          };
        }>;
      } | null;
      await hooks.pushStateSnapshot?.("reopened-session-transcript", capture);

      const expandedOrders = (capture?.captures ?? []).map((phaseCapture) => ({
        phase: phaseCapture.phase ?? "unknown",
        order: (phaseCapture.expandedFull?.domEntries ?? []).map((entry) => entry.renderKey ?? "")
      }));
      const mismatches = (capture?.captures ?? []).map((phaseCapture) => ({
        phase: phaseCapture.phase ?? "unknown",
        mountedMismatch: phaseCapture.mountedVisible?.storeVsDom?.firstMismatchIndex ?? null,
        expandedMismatch: phaseCapture.expandedFull?.storeVsDom?.firstMismatchIndex ?? null
      }));
      const rolloutIdle = (capture?.captures ?? []).find(
        (phaseCapture) => phaseCapture.phase === "rollout-idle"
      );

      return {
        capture,
        expandedOrders,
        mismatches,
        rolloutIdleOutput: (rolloutIdle?.expandedFull?.domEntries ?? [])
          .map((entry) => entry.textPreview ?? "")
          .join(" "),
        matchesExpected:
          expandedOrders.every(
            (entry) => entry.order.join(" | ") === expectedOrder.join(" | ")
          ) &&
          mismatches.every(
            (entry) => entry.mountedMismatch === null && entry.expandedMismatch === null
          )
      };
    }
  );

  if (!artifact?.matchesExpected) {
    throw new Error(
      `Rendered chronology capture mismatch: ${JSON.stringify(artifact, null, 2)}`
    );
  }
  if (!artifact.rolloutIdleOutput.includes("project-1")) {
    throw new Error("Rollout-idle capture is missing the first tool output.");
  }
  if (!artifact.rolloutIdleOutput.includes("project-2")) {
    throw new Error("Rollout-idle capture is missing the second tool output.");
  }
};
