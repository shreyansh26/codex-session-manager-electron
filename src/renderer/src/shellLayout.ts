export const SIDEBAR_MIN_WIDTH_PX = 280;
export const SIDEBAR_MAX_RATIO = 0.62;

export const MIN_WORKSPACE_WIDTH_PX = 760;
export const SPLITTER_TOTAL_WIDTH_PX = 20;
export const SHELL_GUTTER_BUDGET_PX = 48;
export const COMPACT_HYSTERESIS_PX = 24;

const normalizeFinite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

export const isValidShellWidth = (shellWidth: number): boolean =>
  Number.isFinite(shellWidth) && shellWidth > 0;

export const clampSidebarWidth = (requested: number, shellWidth: number): number => {
  const normalizedRequested = normalizeFinite(requested, SIDEBAR_MIN_WIDTH_PX);
  if (!isValidShellWidth(shellWidth)) {
    return Math.max(normalizedRequested, SIDEBAR_MIN_WIDTH_PX);
  }

  const maxWidth = Math.max(
    SIDEBAR_MIN_WIDTH_PX,
    Math.floor(shellWidth * SIDEBAR_MAX_RATIO)
  );
  return Math.min(Math.max(normalizedRequested, SIDEBAR_MIN_WIDTH_PX), maxWidth);
};

export interface ResolveCompactShellModeInput {
  shellWidth: number;
  sidebarWidth: number;
  wasCompact: boolean;
}

export const resolveCompactShellMode = ({
  shellWidth,
  sidebarWidth,
  wasCompact
}: ResolveCompactShellModeInput): boolean => {
  if (!isValidShellWidth(shellWidth)) {
    return false;
  }

  const effectiveSidebarWidth = clampSidebarWidth(sidebarWidth, shellWidth);
  const layoutBudget =
    effectiveSidebarWidth +
    MIN_WORKSPACE_WIDTH_PX +
    SPLITTER_TOTAL_WIDTH_PX +
    SHELL_GUTTER_BUDGET_PX;

  if (wasCompact) {
    return shellWidth < layoutBudget + COMPACT_HYSTERESIS_PX;
  }

  return shellWidth < layoutBudget;
};

export interface CompactEntryTransitionInput {
  wasCompact: boolean;
  nextCompact: boolean;
  wasResizing: boolean;
  activePointerId: number | null;
}

export interface CompactEntryTransition {
  enteringCompact: boolean;
  shouldCancelResize: boolean;
  nextResizing: boolean;
  nextActivePointerId: number | null;
}

export const resolveCompactEntryTransition = ({
  wasCompact,
  nextCompact,
  wasResizing,
  activePointerId
}: CompactEntryTransitionInput): CompactEntryTransition => {
  const enteringCompact = !wasCompact && nextCompact;
  const shouldCancelResize = enteringCompact && wasResizing;
  return {
    enteringCompact,
    shouldCancelResize,
    nextResizing: shouldCancelResize ? false : wasResizing,
    nextActivePointerId: shouldCancelResize ? null : activePointerId
  };
};
