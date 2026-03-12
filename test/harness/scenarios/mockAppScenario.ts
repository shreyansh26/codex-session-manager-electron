export interface MockScenarioPage {
  click?: (selector: string) => Promise<void>;
  fill?: (selector: string, value: string) => Promise<void>;
  waitForFunction?: (
    expression: () => unknown,
    arg?: unknown,
    options?: { timeout?: number }
  ) => Promise<void>;
  evaluate?: <T>(expression: () => T | Promise<T>) => Promise<T>;
}

export const runMockAppScenario = async (page: MockScenarioPage): Promise<void> => {
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
            devices?: unknown[];
            sessions?: unknown[];
          }
        | undefined;
      return Boolean(state && state.devices?.length && state.sessions?.length);
    },
    "Mock devices/sessions did not hydrate"
  );

  await page.fill?.('input[aria-label="Search chats"]', "renderer");
  await waitFor(
    () =>
      Boolean(
        document.querySelector(".workspace__search-session") ||
          document.querySelector(".workspace__search-results-empty")
      ),
    "Search interaction did not render a results state"
  );
  await page.click?.("button.workspace__theme-toggle");
  await waitFor(
    () => document.documentElement.getAttribute("data-theme") === "light",
    "Theme toggle did not switch to light"
  );
  await page.evaluate?.(() => {
    const folderToggle = document.querySelector(
      'button[aria-label="Expand folder codex-app-electron"]'
    ) as HTMLButtonElement | null;
    folderToggle?.click();
    const sessionButton = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Theme toggle follow-up")
    ) as HTMLButtonElement | undefined;
    sessionButton?.click();
  });
  await waitFor(
    () => document.body.textContent?.includes("Theme toggle follow-up (thread-mock-002)"),
    "Selecting a search result did not switch sessions"
  );
  await waitFor(
    () => Boolean(document.querySelector(".chat-panel__timeline li")),
    "Chat timeline did not render"
  );
  await waitFor(
    () =>
      (document.querySelector('textarea[placeholder="Continue this session..."]') as HTMLTextAreaElement | null) !==
      null,
    "Composer did not render"
  );
};
