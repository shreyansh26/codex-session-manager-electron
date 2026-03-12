import { describe, expect, it } from "vitest";
import {
  COMPACT_HYSTERESIS_PX,
  MIN_WORKSPACE_WIDTH_PX,
  SHELL_GUTTER_BUDGET_PX,
  SPLITTER_TOTAL_WIDTH_PX,
  clampSidebarWidth,
  isValidShellWidth,
  resolveCompactEntryTransition,
  resolveCompactShellMode
} from "../shellLayout";

const thresholdForSidebar = (effectiveSidebarWidth: number): number =>
  effectiveSidebarWidth +
  MIN_WORKSPACE_WIDTH_PX +
  SPLITTER_TOTAL_WIDTH_PX +
  SHELL_GUTTER_BUDGET_PX;

describe("shellLayout width validity", () => {
  it("accepts strictly positive finite shell widths", () => {
    expect(isValidShellWidth(1)).toBe(true);
    expect(isValidShellWidth(1024)).toBe(true);
  });

  it("rejects non-finite and non-positive shell widths", () => {
    expect(isValidShellWidth(0)).toBe(false);
    expect(isValidShellWidth(-1)).toBe(false);
    expect(isValidShellWidth(Number.NaN)).toBe(false);
    expect(isValidShellWidth(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("shellLayout sidebar clamping", () => {
  it("clamps to minimum width when the requested width is too small", () => {
    expect(clampSidebarWidth(120, 1188)).toBe(280);
  });

  it("clamps to ratio-based max width for oversized stale sidebar widths", () => {
    expect(clampSidebarWidth(2_000, 1_000)).toBe(620);
  });

  it("falls back safely when shell width is invalid", () => {
    expect(clampSidebarWidth(120, Number.NaN)).toBe(280);
    expect(clampSidebarWidth(360, 0)).toBe(360);
  });
});

describe("resolveCompactShellMode", () => {
  it("switches by exact threshold edges for non-compact state", () => {
    const effectiveSidebarWidth = 360;
    const threshold = thresholdForSidebar(effectiveSidebarWidth);

    expect(
      resolveCompactShellMode({
        shellWidth: threshold - 1,
        sidebarWidth: effectiveSidebarWidth,
        wasCompact: false
      })
    ).toBe(true);

    expect(
      resolveCompactShellMode({
        shellWidth: threshold,
        sidebarWidth: effectiveSidebarWidth,
        wasCompact: false
      })
    ).toBe(false);

    expect(
      resolveCompactShellMode({
        shellWidth: threshold + 1,
        sidebarWidth: effectiveSidebarWidth,
        wasCompact: false
      })
    ).toBe(false);
  });

  it("applies hysteresis when already compact", () => {
    const effectiveSidebarWidth = 360;
    const threshold = thresholdForSidebar(effectiveSidebarWidth);

    expect(
      resolveCompactShellMode({
        shellWidth: threshold + COMPACT_HYSTERESIS_PX - 1,
        sidebarWidth: effectiveSidebarWidth,
        wasCompact: true
      })
    ).toBe(true);

    expect(
      resolveCompactShellMode({
        shellWidth: threshold + COMPACT_HYSTERESIS_PX,
        sidebarWidth: effectiveSidebarWidth,
        wasCompact: true
      })
    ).toBe(false);
  });

  it("uses effective clamped sidebar width for threshold math", () => {
    const shellWidth = 1_100;
    const staleOrInvalidSidebarWidth = 0;
    const effectiveSidebarWidth = clampSidebarWidth(staleOrInvalidSidebarWidth, shellWidth);
    const threshold = thresholdForSidebar(effectiveSidebarWidth);

    expect(effectiveSidebarWidth).toBe(280);
    expect(threshold).toBe(1_108);
    expect(
      resolveCompactShellMode({
        shellWidth,
        sidebarWidth: staleOrInvalidSidebarWidth,
        wasCompact: false
      })
    ).toBe(true);
  });

  it("re-clamps stale oversized widths after window shrink before deciding mode", () => {
    const shellWidth = 2_200;
    const staleSidebarWidth = 1_800;
    const effectiveSidebarWidth = clampSidebarWidth(staleSidebarWidth, shellWidth);
    const threshold = thresholdForSidebar(effectiveSidebarWidth);

    expect(effectiveSidebarWidth).toBe(1_364);
    expect(threshold).toBe(2_192);
    expect(
      resolveCompactShellMode({
        shellWidth,
        sidebarWidth: staleSidebarWidth,
        wasCompact: false
      })
    ).toBe(false);
  });

  it("stays non-compact for invalid shell widths", () => {
    expect(
      resolveCompactShellMode({
        shellWidth: 0,
        sidebarWidth: 360,
        wasCompact: false
      })
    ).toBe(false);
    expect(
      resolveCompactShellMode({
        shellWidth: Number.NaN,
        sidebarWidth: 360,
        wasCompact: true
      })
    ).toBe(false);
  });
});

describe("resolveCompactEntryTransition", () => {
  it("signals cleanup when entering compact while actively resizing", () => {
    expect(
      resolveCompactEntryTransition({
        wasCompact: false,
        nextCompact: true,
        wasResizing: true,
        activePointerId: 42
      })
    ).toEqual({
      enteringCompact: true,
      shouldCancelResize: true,
      nextResizing: false,
      nextActivePointerId: null
    });
  });

  it("preserves state when not entering compact", () => {
    expect(
      resolveCompactEntryTransition({
        wasCompact: true,
        nextCompact: true,
        wasResizing: true,
        activePointerId: 7
      })
    ).toEqual({
      enteringCompact: false,
      shouldCancelResize: false,
      nextResizing: true,
      nextActivePointerId: 7
    });
  });
});
