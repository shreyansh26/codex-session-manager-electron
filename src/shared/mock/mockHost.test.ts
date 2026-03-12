import { describe, expect, it } from "vitest";
import { __TEST_ONLY__, createMockRuntime, resetMockRuntimeRegistry } from "./mockHost";

describe("mockHost", () => {
  it("extracts prompts from nested turn payloads", () => {
    expect(
      __TEST_ONLY__.extractPromptFromValue([
        {
          role: "user",
          content: [{ type: "text", text: "Inspect the renderer state." }]
        }
      ])
    ).toBe("Inspect the renderer state.");
  });

  it("restarts from deterministic thread ids when the registry is reset", async () => {
    const runtime = createMockRuntime("mock://local/mock-local-device");
    const first = await runtime.call<{ threadId: string }>("thread/start", {
      cwd: "/Users/mock/workspace/codex-app-electron"
    });

    resetMockRuntimeRegistry();

    const secondRuntime = createMockRuntime("mock://local/mock-local-device");
    const second = await secondRuntime.call<{ threadId: string }>("thread/start", {
      cwd: "/Users/mock/workspace/codex-app-electron"
    });

    expect(first.threadId).toBe("thread-mock-004");
    expect(second.threadId).toBe("thread-mock-004");
  });

  it("returns stable list/read/start-turn fixtures for the same mock endpoint", async () => {
    const firstRuntime = createMockRuntime("mock://local/mock-local-device");
    const firstList = await firstRuntime.call<{ data: Array<{ id: string }> }>(
      "thread/list"
    );
    const firstRead = await firstRuntime.call<{
      thread: { id: string; messages: Array<{ content: string }> };
    }>("thread/read", {
      threadId: "thread-mock-001"
    });
    const firstTurn = await firstRuntime.call<{ turnId: string }>("turn/start", {
      threadId: "thread-mock-001",
      input: "Add diagnostics before fixing the bug."
    });

    resetMockRuntimeRegistry();

    const secondRuntime = createMockRuntime("mock://local/mock-local-device");
    const secondList = await secondRuntime.call<{ data: Array<{ id: string }> }>(
      "thread/list"
    );
    const secondRead = await secondRuntime.call<{
      thread: { id: string; messages: Array<{ content: string }> };
    }>("thread/read", {
      threadId: "thread-mock-001"
    });
    const secondTurn = await secondRuntime.call<{ turnId: string }>("turn/start", {
      threadId: "thread-mock-001",
      input: "Add diagnostics before fixing the bug."
    });

    expect(firstList).toEqual(secondList);
    expect(firstRead).toEqual(secondRead);
    expect(firstTurn).toEqual(secondTurn);
  });
});
