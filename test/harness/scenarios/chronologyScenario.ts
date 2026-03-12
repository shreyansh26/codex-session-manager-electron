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
            sessions?: Array<{ title?: string }>;
          }
        | undefined;
      return Boolean(
        state?.sessions?.some((session) =>
          session.title?.includes("Tool chronology regression fixture")
        )
      );
    },
    "Chronology fixture session did not hydrate"
  );

  await page.evaluate?.(() => {
    const folderToggle =
      (document.querySelector(
        'button[aria-label="Expand folder codex-app-electron"]'
      ) as HTMLButtonElement | null) ??
      (document.querySelector(
        'button[aria-label="Collapse folder codex-app-electron"]'
      ) as HTMLButtonElement | null);
    if (folderToggle?.getAttribute("aria-label")?.startsWith("Expand")) {
      folderToggle.click();
    }
  });
  await waitFor(
    () =>
      Boolean(
        document.querySelector(
          'button[title="Tool chronology regression fixture (thread-mock-003)"]'
        )
      ),
    "Chronology fixture session button did not appear"
  );
  await page.click?.(
    'button[title="Tool chronology regression fixture (thread-mock-003)"]'
  );

  await waitFor(
    () => document.body.textContent?.includes("Tool chronology regression fixture"),
    "Selecting the chronology fixture did not load the thread"
  );

  await page.click?.(".chat-panel__history-button");
  await waitFor(
    () => !document.querySelector(".chat-panel__history-button"),
    "Chronology fixture older-history control did not clear"
  );

  await waitFor(
    () => {
      const bubbles = Array.from(
        document.querySelectorAll<HTMLLIElement>('li[data-message-id="call-reused"]')
      );
      return (
        bubbles.length === 2 &&
        bubbles.every((bubble) => bubble.querySelector(".bubble__tool-card")) &&
        document.body.textContent?.includes("/Users/demo/project-1") &&
        document.body.textContent?.includes("/Users/demo/project-2")
      );
    },
    "Chronology fixture did not render both tool bubbles"
  );

  const renderedOrder = await page.evaluate?.(() =>
    Array.from(document.querySelectorAll<HTMLLIElement>("li[data-message-id]"))
      .map((item) => {
        const messageId = item.dataset.messageId ?? "";
        const role = (["user", "assistant", "tool", "system"] as const).find((candidate) =>
          item.classList.contains(`bubble--${candidate}`)
        );
        return messageId && role ? `${role}:${messageId}` : null;
      })
      .filter((value): value is string => value !== null)
  );

  if (
    !renderedOrder ||
    renderedOrder.join(" | ") !==
      [
        "user:user-turn-1",
        "tool:call-reused",
        "user:user-turn-2",
        "tool:call-reused"
      ].join(" | ")
  ) {
    throw new Error(
      `Rendered chronology order mismatch: ${(renderedOrder ?? []).join(" | ")}`
    );
  }
};
