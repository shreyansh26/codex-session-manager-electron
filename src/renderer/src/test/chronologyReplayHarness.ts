import type { ChatMessage } from "../domain/types";
import { parseRpcNotification } from "../services/eventParser";
import {
  __TEST_ONLY__ as codexApiTest,
  parseToolMessagesFromRolloutJsonl
} from "../services/codexApi";
import { __TEST_ONLY__ as storeTest } from "../state/useAppStore";
import type {
  ChronologyReplayFixture,
  ChronologyReplayStep
} from "./chronologyReplayFixtures";

const DEFAULT_DEVICE_ID = "device-1";

const applyLiveStep = (
  messages: ChatMessage[],
  notification: Parameters<typeof parseRpcNotification>[1],
  deviceId: string
): ChatMessage[] => {
  const parsed = parseRpcNotification(deviceId, notification);
  if (!parsed) {
    return messages;
  }

  return storeTest.upsertMessage(
    messages,
    storeTest.normalizeLiveNotificationMessage(messages, parsed.message)
  );
};

const applySnapshotStep = (
  messages: ChatMessage[],
  fixture: ChronologyReplayFixture,
  snapshot: Record<string, unknown>,
  deviceId: string
): ChatMessage[] =>
  storeTest.mergeSnapshotMessages(
    messages,
    codexApiTest.parseMessagesFromThread(deviceId, fixture.threadId, snapshot)
  );

const applyRolloutStep = (
  messages: ChatMessage[],
  fixture: ChronologyReplayFixture,
  records: Array<Record<string, unknown>>,
  deviceId: string
): ChatMessage[] => {
  const rolloutMessages = records.every(
    (record) => typeof record.kind === "string" || typeof record.name === "string"
  )
    ? records
        .map((record) =>
          codexApiTest.toTimelineMessageFromRolloutRecord(deviceId, fixture.threadId, record)
        )
        .filter((message): message is ChatMessage => message !== null)
    : parseToolMessagesFromRolloutJsonl(
        deviceId,
        fixture.threadId,
        records.map((record) => JSON.stringify(record)).join("\n")
      );

  return storeTest.mergeRolloutEnrichmentMessages(messages, rolloutMessages);
};

export const applyChronologyReplayStep = (
  messages: ChatMessage[],
  fixture: ChronologyReplayFixture,
  step: ChronologyReplayStep,
  deviceId = DEFAULT_DEVICE_ID
): ChatMessage[] => {
  if (step.source === "live") {
    return applyLiveStep(messages, step.notification, deviceId);
  }

  if (step.source === "thread_read") {
    return applySnapshotStep(messages, fixture, step.snapshot, deviceId);
  }

  return applyRolloutStep(messages, fixture, step.records, deviceId);
};

export const applyChronologyReplayFixture = (
  fixture: ChronologyReplayFixture,
  deviceId = DEFAULT_DEVICE_ID
): ChatMessage[] =>
  fixture.steps.reduce(
    (messages, step) => applyChronologyReplayStep(messages, fixture, step, deviceId),
    [] as ChatMessage[]
  );

export const messageRoleIdOrder = (messages: ChatMessage[]): string[] =>
  messages.map((message) => `${message.role}:${message.id}`);
