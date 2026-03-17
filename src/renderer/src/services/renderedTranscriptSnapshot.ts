import { z } from "zod";
import type { VisibleMessageWindow } from "../components/chatWindow";
import { getMessageWindowKey, resolveVisibleMessageWindow } from "../components/chatWindow";
import type { ChatMessage, SessionSummary } from "../domain/types";

const PREVIEW_MAX_CHARS = 160;

export const renderedTranscriptPhaseSchema = z.enum([
  "base-loaded",
  "rollout-parsed",
  "rollout-applied",
  "rollout-idle"
]);
export type RenderedTranscriptPhase = z.infer<typeof renderedTranscriptPhaseSchema>;

export const renderedTranscriptModeSchema = z.enum(["mounted-visible", "expanded-full"]);
export type RenderedTranscriptMode = z.infer<typeof renderedTranscriptModeSchema>;

export const renderedTranscriptStoreEntrySchema = z.object({
  orderIndex: z.number().int().nonnegative(),
  renderKey: z.string().min(1),
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "system", "tool"]),
  eventType: z.string().nullable(),
  createdAt: z.string(),
  timelineOrder: z.number().nullable(),
  chronologySource: z.string().nullable(),
  label: z.string().min(1),
  contentPreview: z.string(),
  toolName: z.string().nullable(),
  toolStatus: z.string().nullable()
});
export type RenderedTranscriptStoreEntry = z.infer<
  typeof renderedTranscriptStoreEntrySchema
>;

export const renderedTranscriptDomEntrySchema = z.object({
  domIndex: z.number().int().nonnegative(),
  renderKey: z.string().min(1),
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "system", "tool"]),
  eventType: z.string().nullable(),
  label: z.string().min(1),
  textPreview: z.string(),
  toolName: z.string().nullable(),
  toolStatus: z.string().nullable()
});
export type RenderedTranscriptDomEntry = z.infer<typeof renderedTranscriptDomEntrySchema>;

export const renderedTranscriptVisibleWindowSchema = z.object({
  hiddenMessageCount: z.number().int().nonnegative(),
  startIndex: z.number().int().nonnegative(),
  anchorMessageKey: z.string().nullable(),
  visibleRenderKeys: z.array(z.string())
});
export type RenderedTranscriptVisibleWindow = z.infer<
  typeof renderedTranscriptVisibleWindowSchema
>;

export const renderedTranscriptOrderDiffSchema = z.object({
  expectedOrder: z.array(z.string()),
  actualOrder: z.array(z.string()),
  firstMismatchIndex: z.number().int().nonnegative().nullable(),
  missingFromActual: z.array(z.string()),
  extraInActual: z.array(z.string())
});
export type RenderedTranscriptOrderDiff = z.infer<typeof renderedTranscriptOrderDiffSchema>;

export const renderedTranscriptRoleRunSchema = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  startIndex: z.number().int().nonnegative(),
  length: z.number().int().positive()
});
export type RenderedTranscriptRoleRun = z.infer<typeof renderedTranscriptRoleRunSchema>;

export const renderedTranscriptDuplicateKeySchema = z.object({
  renderKey: z.string().min(1),
  positions: z.array(z.number().int().nonnegative()).min(2)
});
export type RenderedTranscriptDuplicateKey = z.infer<
  typeof renderedTranscriptDuplicateKeySchema
>;

export const renderedTranscriptSnapshotSchema = z.object({
  sessionKey: z.string().min(1),
  threadId: z.string().min(1),
  deviceId: z.string().min(1),
  phase: renderedTranscriptPhaseSchema,
  mode: renderedTranscriptModeSchema,
  visibleWindow: renderedTranscriptVisibleWindowSchema,
  storeEntries: z.array(renderedTranscriptStoreEntrySchema),
  domEntries: z.array(renderedTranscriptDomEntrySchema),
  storeVsDom: renderedTranscriptOrderDiffSchema,
  missingFromDom: z.array(z.string()),
  extraInDom: z.array(z.string()),
  duplicateWindowKeys: z.array(renderedTranscriptDuplicateKeySchema),
  roleRuns: z.array(renderedTranscriptRoleRunSchema)
});
export type RenderedTranscriptSnapshot = z.infer<typeof renderedTranscriptSnapshotSchema>;

export const renderedTranscriptPhaseCaptureSchema = z.object({
  phase: renderedTranscriptPhaseSchema,
  mountedVisible: renderedTranscriptSnapshotSchema,
  expandedFull: renderedTranscriptSnapshotSchema
});
export type RenderedTranscriptPhaseCapture = z.infer<
  typeof renderedTranscriptPhaseCaptureSchema
>;

export const reopenedSessionBadLayerSchema = z.enum([
  "rollout_parse_loss",
  "rollout_apply_loss",
  "visible_window_loss",
  "dom_keying_loss"
]);
export type ReopenedSessionBadLayer = z.infer<typeof reopenedSessionBadLayerSchema>;

export const renderedTranscriptCoverageSchema = z.object({
  total: z.number().int().nonnegative(),
  user: z.number().int().nonnegative(),
  assistant: z.number().int().nonnegative(),
  system: z.number().int().nonnegative(),
  tool: z.number().int().nonnegative(),
  reasoning: z.number().int().nonnegative(),
  activity: z.number().int().nonnegative(),
  toolCall: z.number().int().nonnegative()
});
export type RenderedTranscriptCoverage = z.infer<typeof renderedTranscriptCoverageSchema>;

export const reopenedSessionTranscriptAnalysisSchema = z.object({
  firstBadLayer: reopenedSessionBadLayerSchema.nullable(),
  rolloutParsedSource: z.enum(["raw", "inferred-from-rollout-applied"]),
  coverage: z.object({
    baseLoaded: renderedTranscriptCoverageSchema,
    rolloutParsed: renderedTranscriptCoverageSchema,
    rolloutApplied: renderedTranscriptCoverageSchema
  }),
  diffs: z.object({
    baseToRolloutParsed: renderedTranscriptOrderDiffSchema,
    baseToRolloutApplied: renderedTranscriptOrderDiffSchema,
    rolloutParsedToRolloutApplied: renderedTranscriptOrderDiffSchema
  }),
  notes: z.array(z.string())
});
export type ReopenedSessionTranscriptAnalysis = z.infer<
  typeof reopenedSessionTranscriptAnalysisSchema
>;

export const reopenedSessionTranscriptCaptureSchema = z.object({
  sessionKey: z.string().min(1),
  threadId: z.string().min(1),
  deviceId: z.string().min(1),
  captures: z.array(renderedTranscriptPhaseCaptureSchema).min(1),
  analysis: reopenedSessionTranscriptAnalysisSchema.optional()
});
export type ReopenedSessionTranscriptCapture = z.infer<
  typeof reopenedSessionTranscriptCaptureSchema
>;

const truncatePreview = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= PREVIEW_MAX_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, PREVIEW_MAX_CHARS - 1)}…`;
};

const messageLabel = (message: ChatMessage): string => {
  if (message.role === "user") {
    return "user";
  }
  if (message.toolCall || message.eventType === "tool_call") {
    return "Tool Call";
  }
  if (message.eventType === "reasoning") {
    return "Reasoning";
  }
  if (message.eventType === "activity") {
    return "Activity";
  }
  return message.role;
};

export const toRenderedTranscriptStoreEntries = (
  messages: ChatMessage[]
): RenderedTranscriptStoreEntry[] =>
  messages.map((message, orderIndex) => ({
    orderIndex,
    renderKey: getMessageWindowKey(message),
    id: message.id,
    role: message.role,
    eventType: message.eventType ?? null,
    createdAt: message.createdAt,
    timelineOrder:
      typeof message.timelineOrder === "number" ? message.timelineOrder : null,
    chronologySource: message.chronologySource ?? null,
    label: messageLabel(message),
    contentPreview: truncatePreview(message.content),
    toolName: message.toolCall?.name ?? null,
    toolStatus: message.toolCall?.status ?? null
  }));

export const findDuplicateWindowKeys = (
  messages: ChatMessage[]
): RenderedTranscriptDuplicateKey[] => {
  const positionsByKey = new Map<string, number[]>();
  messages.forEach((message, index) => {
    const key = getMessageWindowKey(message);
    const positions = positionsByKey.get(key) ?? [];
    positionsByKey.set(key, [...positions, index]);
  });

  return [...positionsByKey.entries()]
    .filter(([, positions]) => positions.length > 1)
    .map(([renderKey, positions]) => ({ renderKey, positions }));
};

export const buildVisibleWindowSnapshot = (params: {
  messages: ChatMessage[];
  visibleMessageCount: number;
  anchorMessageKey: string | null;
}): RenderedTranscriptVisibleWindow => {
  const windowState = resolveVisibleMessageWindow(params);
  return renderedTranscriptVisibleWindowSchema.parse({
    hiddenMessageCount: windowState.hiddenMessageCount,
    startIndex: windowState.startIndex,
    anchorMessageKey: params.anchorMessageKey,
    visibleRenderKeys: windowState.visibleMessages.map((message) =>
      getMessageWindowKey(message)
    )
  });
};

export const buildExpandedVisibleWindow = (
  messages: ChatMessage[]
): VisibleMessageWindow =>
  resolveVisibleMessageWindow({
    messages,
    visibleMessageCount: messages.length,
    anchorMessageKey: null
  });

export const deriveVisibleWindowSnapshotFromDom = (params: {
  messages: ChatMessage[];
  domEntries: RenderedTranscriptDomEntry[];
}): RenderedTranscriptVisibleWindow => {
  const { messages, domEntries } = params;
  const storeEntries = toRenderedTranscriptStoreEntries(messages);
  const visibleRenderKeys = domEntries.map((entry) => entry.renderKey);
  const firstRenderKey = visibleRenderKeys[0] ?? null;
  const startIndex =
    firstRenderKey === null
      ? Math.max(0, messages.length - visibleRenderKeys.length)
      : Math.max(
          0,
          storeEntries.findIndex((entry) => entry.renderKey === firstRenderKey)
        );

  return renderedTranscriptVisibleWindowSchema.parse({
    hiddenMessageCount: startIndex,
    startIndex,
    anchorMessageKey: firstRenderKey,
    visibleRenderKeys
  });
};

const readDatasetValue = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

export const extractRenderedTranscriptDomEntries = (
  root: ParentNode
): RenderedTranscriptDomEntry[] =>
  Array.from(root.querySelectorAll<HTMLElement>("li[data-message-id]"))
    .map((element, domIndex) => {
      const id = readDatasetValue(element.dataset.messageId);
      const renderKey = readDatasetValue(element.dataset.messageKey);
      const role = readDatasetValue(element.dataset.messageRole);
      const label = readDatasetValue(element.dataset.messageLabel);
      if (
        !id ||
        !renderKey ||
        !label ||
        (role !== "user" && role !== "assistant" && role !== "system" && role !== "tool")
      ) {
        return null;
      }

      return renderedTranscriptDomEntrySchema.parse({
        domIndex,
        renderKey,
        id,
        role,
        eventType: readDatasetValue(element.dataset.eventType),
        label,
        textPreview: truncatePreview(element.textContent ?? ""),
        toolName: readDatasetValue(element.dataset.toolName),
        toolStatus: readDatasetValue(element.dataset.toolStatus)
      });
    })
    .filter((entry): entry is RenderedTranscriptDomEntry => entry !== null);

const diffOrders = (
  expectedOrder: string[],
  actualOrder: string[]
): RenderedTranscriptOrderDiff => {
  const firstMismatchIndex = (() => {
    const maxLength = Math.max(expectedOrder.length, actualOrder.length);
    for (let index = 0; index < maxLength; index += 1) {
      if (expectedOrder[index] !== actualOrder[index]) {
        return index;
      }
    }
    return null;
  })();

  const actualCounts = new Map<string, number>();
  for (const entry of actualOrder) {
    actualCounts.set(entry, (actualCounts.get(entry) ?? 0) + 1);
  }

  const missingFromActual: string[] = [];
  for (const entry of expectedOrder) {
    const remaining = actualCounts.get(entry) ?? 0;
    if (remaining > 0) {
      actualCounts.set(entry, remaining - 1);
      continue;
    }
    missingFromActual.push(entry);
  }

  const expectedCounts = new Map<string, number>();
  for (const entry of expectedOrder) {
    expectedCounts.set(entry, (expectedCounts.get(entry) ?? 0) + 1);
  }

  const extraInActual: string[] = [];
  for (const entry of actualOrder) {
    const remaining = expectedCounts.get(entry) ?? 0;
    if (remaining > 0) {
      expectedCounts.set(entry, remaining - 1);
      continue;
    }
    extraInActual.push(entry);
  }

  return {
    expectedOrder,
    actualOrder,
    firstMismatchIndex,
    missingFromActual,
    extraInActual
  };
};

export const summarizeRoleRuns = (
  entries: Array<Pick<RenderedTranscriptDomEntry, "role">>
): RenderedTranscriptRoleRun[] => {
  const runs: RenderedTranscriptRoleRun[] = [];
  for (const [index, entry] of entries.entries()) {
    const previous = runs.at(-1);
    if (!previous || previous.role !== entry.role) {
      runs.push({
        role: entry.role,
        startIndex: index,
        length: 1
      });
      continue;
    }
    previous.length += 1;
  }
  return runs;
};

export const buildRenderedTranscriptSnapshot = (params: {
  session: Pick<SessionSummary, "key" | "threadId" | "deviceId">;
  phase: RenderedTranscriptPhase;
  mode: RenderedTranscriptMode;
  messages: ChatMessage[];
  visibleWindow: RenderedTranscriptVisibleWindow;
  domEntries: RenderedTranscriptDomEntry[];
}): RenderedTranscriptSnapshot => {
  const storeEntries = toRenderedTranscriptStoreEntries(params.messages);
  const domOrder = params.domEntries.map((entry) => entry.renderKey);
  const expectedStoreEntries =
    params.mode === "mounted-visible"
      ? storeEntries.filter((entry) =>
          params.visibleWindow.visibleRenderKeys.includes(entry.renderKey)
        )
      : storeEntries;
  const expectedOrder = expectedStoreEntries.map((entry) => entry.renderKey);
  const storeVsDom = diffOrders(expectedOrder, domOrder);

  return renderedTranscriptSnapshotSchema.parse({
    sessionKey: params.session.key,
    threadId: params.session.threadId,
    deviceId: params.session.deviceId,
    phase: params.phase,
    mode: params.mode,
    visibleWindow: params.visibleWindow,
    storeEntries,
    domEntries: params.domEntries,
    storeVsDom,
    missingFromDom: storeVsDom.missingFromActual,
    extraInDom: storeVsDom.extraInActual,
    duplicateWindowKeys: findDuplicateWindowKeys(params.messages),
    roleRuns: summarizeRoleRuns(params.domEntries)
  });
};

const summarizeCoverage = (
  entries: RenderedTranscriptStoreEntry[]
): RenderedTranscriptCoverage => {
  const coverage: RenderedTranscriptCoverage = {
    total: entries.length,
    user: 0,
    assistant: 0,
    system: 0,
    tool: 0,
    reasoning: 0,
    activity: 0,
    toolCall: 0
  };

  for (const entry of entries) {
    coverage[entry.role] += 1;
    if (entry.eventType === "reasoning") {
      coverage.reasoning += 1;
    }
    if (entry.eventType === "activity") {
      coverage.activity += 1;
    }
    if (entry.eventType === "tool_call") {
      coverage.toolCall += 1;
    }
  }

  return renderedTranscriptCoverageSchema.parse(coverage);
};

const toSyntheticDomEntry = (
  entry: RenderedTranscriptStoreEntry,
  domIndex: number
): RenderedTranscriptDomEntry =>
  renderedTranscriptDomEntrySchema.parse({
    domIndex,
    renderKey: entry.renderKey,
    id: entry.id,
    role: entry.role,
    eventType: entry.eventType,
    label: entry.label,
    textPreview: entry.contentPreview,
    toolName: entry.toolName,
    toolStatus: entry.toolStatus
  });

const findPhaseCapture = (
  captures: RenderedTranscriptPhaseCapture[],
  phase: RenderedTranscriptPhase
): RenderedTranscriptPhaseCapture | null =>
  captures.find((capture) => capture.phase === phase) ?? null;

const normalizeRolloutAppliedCapture = (
  captures: RenderedTranscriptPhaseCapture[]
): RenderedTranscriptPhaseCapture | null => {
  const rolloutApplied = findPhaseCapture(captures, "rollout-applied");
  if (rolloutApplied) {
    return rolloutApplied;
  }

  const legacy = findPhaseCapture(captures, "rollout-idle");
  if (!legacy) {
    return null;
  }

  return {
    phase: "rollout-applied",
    mountedVisible: {
      ...legacy.mountedVisible,
      phase: "rollout-applied"
    },
    expandedFull: {
      ...legacy.expandedFull,
      phase: "rollout-applied"
    }
  };
};

const buildRolloutParsedCaptureFromApplied = (
  appliedCapture: RenderedTranscriptPhaseCapture
): RenderedTranscriptPhaseCapture => {
  const rolloutEntries = appliedCapture.expandedFull.storeEntries.filter(
    (entry) => entry.chronologySource === "rollout"
  );
  const rolloutDomEntries = rolloutEntries.map((entry, index) =>
    toSyntheticDomEntry(entry, index)
  );
  const rolloutOrder = rolloutEntries.map((entry) => entry.renderKey);
  const rolloutWindow = renderedTranscriptVisibleWindowSchema.parse({
    hiddenMessageCount: 0,
    startIndex: 0,
    anchorMessageKey: rolloutOrder[0] ?? null,
    visibleRenderKeys: rolloutOrder
  });
  const rolloutStoreVsDom = diffOrders(rolloutOrder, rolloutOrder);
  const expanded = renderedTranscriptSnapshotSchema.parse({
    ...appliedCapture.expandedFull,
    phase: "rollout-parsed",
    mode: "expanded-full",
    visibleWindow: rolloutWindow,
    storeEntries: rolloutEntries,
    domEntries: rolloutDomEntries,
    storeVsDom: rolloutStoreVsDom,
    missingFromDom: [],
    extraInDom: [],
    duplicateWindowKeys: [],
    roleRuns: summarizeRoleRuns(rolloutDomEntries)
  });
  const mounted = renderedTranscriptSnapshotSchema.parse({
    ...appliedCapture.mountedVisible,
    phase: "rollout-parsed",
    mode: "mounted-visible",
    visibleWindow: rolloutWindow,
    storeEntries: rolloutEntries,
    domEntries: rolloutDomEntries,
    storeVsDom: rolloutStoreVsDom,
    missingFromDom: [],
    extraInDom: [],
    duplicateWindowKeys: [],
    roleRuns: summarizeRoleRuns(rolloutDomEntries)
  });

  return renderedTranscriptPhaseCaptureSchema.parse({
    phase: "rollout-parsed",
    mountedVisible: mounted,
    expandedFull: expanded
  });
};

const classifyFirstBadLayer = (params: {
  baseLoaded: RenderedTranscriptPhaseCapture;
  rolloutParsed: RenderedTranscriptPhaseCapture;
  rolloutApplied: RenderedTranscriptPhaseCapture;
}): {
  firstBadLayer: ReopenedSessionBadLayer | null;
  notes: string[];
  diffs: ReopenedSessionTranscriptAnalysis["diffs"];
  coverage: ReopenedSessionTranscriptAnalysis["coverage"];
} => {
  const baseOrder = params.baseLoaded.expandedFull.storeEntries.map(
    (entry) => entry.renderKey
  );
  const parsedOrder = params.rolloutParsed.expandedFull.storeEntries.map(
    (entry) => entry.renderKey
  );
  const appliedOrder = params.rolloutApplied.expandedFull.storeEntries.map(
    (entry) => entry.renderKey
  );
  const diffs = {
    baseToRolloutParsed: diffOrders(baseOrder, parsedOrder),
    baseToRolloutApplied: diffOrders(baseOrder, appliedOrder),
    rolloutParsedToRolloutApplied: diffOrders(parsedOrder, appliedOrder)
  };
  const coverage = {
    baseLoaded: summarizeCoverage(params.baseLoaded.expandedFull.storeEntries),
    rolloutParsed: summarizeCoverage(params.rolloutParsed.expandedFull.storeEntries),
    rolloutApplied: summarizeCoverage(params.rolloutApplied.expandedFull.storeEntries)
  };

  const notes: string[] = [];
  const rolloutAppliedImprovesCoverage =
    coverage.rolloutApplied.tool > coverage.baseLoaded.tool ||
    coverage.rolloutApplied.user > coverage.baseLoaded.user ||
    coverage.rolloutApplied.total > coverage.baseLoaded.total;
  if (params.rolloutApplied.expandedFull.storeVsDom.firstMismatchIndex !== null) {
    notes.push("Expanded rollout-applied store/DOM mismatch detected.");
    return { firstBadLayer: "dom_keying_loss", notes, diffs, coverage };
  }
  if (
    params.rolloutApplied.mountedVisible.storeVsDom.firstMismatchIndex !== null &&
    params.rolloutApplied.expandedFull.storeVsDom.firstMismatchIndex === null
  ) {
    notes.push("Mounted-visible mismatch with expanded-full aligned.");
    return { firstBadLayer: "visible_window_loss", notes, diffs, coverage };
  }
  if (
    !rolloutAppliedImprovesCoverage &&
    (
      coverage.rolloutParsed.tool < coverage.baseLoaded.tool ||
      coverage.rolloutParsed.user < coverage.baseLoaded.user ||
      coverage.rolloutParsed.total < coverage.baseLoaded.total
    )
  ) {
    notes.push("Rollout-parsed coverage regressed versus base-loaded.");
    return { firstBadLayer: "rollout_parse_loss", notes, diffs, coverage };
  }
  if (
    coverage.rolloutApplied.tool < coverage.rolloutParsed.tool ||
    coverage.rolloutApplied.user < coverage.rolloutParsed.user ||
    coverage.rolloutApplied.total < coverage.rolloutParsed.total
  ) {
    notes.push("Rollout-applied coverage regressed versus rollout-parsed.");
    return { firstBadLayer: "rollout_apply_loss", notes, diffs, coverage };
  }

  notes.push("No first bad layer detected from capture metrics.");
  return { firstBadLayer: null, notes, diffs, coverage };
};

export const enrichReopenedSessionTranscriptCapture = (
  rawCapture: unknown
): ReopenedSessionTranscriptCapture => {
  const parsed = reopenedSessionTranscriptCaptureSchema.parse(rawCapture);
  const baseLoaded = findPhaseCapture(parsed.captures, "base-loaded");
  const rolloutApplied = normalizeRolloutAppliedCapture(parsed.captures);

  if (!baseLoaded || !rolloutApplied) {
    return parsed;
  }

  const rolloutParsed =
    findPhaseCapture(parsed.captures, "rollout-parsed") ??
    buildRolloutParsedCaptureFromApplied(rolloutApplied);
  const phaseSummary = classifyFirstBadLayer({
    baseLoaded,
    rolloutParsed,
    rolloutApplied
  });
  const rolloutParsedSource =
    findPhaseCapture(parsed.captures, "rollout-parsed") ? "raw" : "inferred-from-rollout-applied";

  return reopenedSessionTranscriptCaptureSchema.parse({
    ...parsed,
    captures: [baseLoaded, rolloutParsed, rolloutApplied],
    analysis: {
      firstBadLayer: phaseSummary.firstBadLayer,
      rolloutParsedSource,
      coverage: phaseSummary.coverage,
      diffs: phaseSummary.diffs,
      notes: phaseSummary.notes
    }
  });
};
