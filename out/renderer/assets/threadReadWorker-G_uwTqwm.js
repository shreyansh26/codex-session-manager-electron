(function() {
  "use strict";
  const makeSessionKey = (deviceId, threadId) => `${deviceId}::${threadId}`;
  const activityKeywords = [
    "tool",
    "exec",
    "command",
    "shell",
    "patch",
    "edit",
    "diff",
    "search",
    "read",
    "write",
    "file",
    "run",
    "plan",
    "explore"
  ];
  const structuredToolKeywords = [
    "tool",
    "exec",
    "command",
    "shell",
    "patch",
    "search",
    "read",
    "write",
    "file",
    "diff",
    "stdin"
  ];
  const extractItemMessagePayload = (item, method, role) => {
    const rawContent = extractText(item);
    const preserveRawChunk = shouldPreserveRawChunk(method, role);
    const content = preserveRawChunk ? rawContent : rawContent.trim();
    const declaredToolCall = extractDeclaredToolCall(item);
    const toolCall = declaredToolCall ?? extractStructuredToolCall(item, method, role, content);
    const declaredEventType = pickString$2(item, ["eventType"]);
    const normalizedDeclaredEventType = declaredEventType === "reasoning" || declaredEventType === "activity" || declaredEventType === "tool_call" ? declaredEventType : void 0;
    const eventType = toolCall ? "tool_call" : normalizedDeclaredEventType ?? inferEventType(item, method, role);
    if (toolCall) {
      return {
        content: buildToolCallContent(toolCall, content),
        eventType,
        toolCall
      };
    }
    if (content.trim().length > 0) {
      return {
        content,
        ...eventType ? { eventType } : {}
      };
    }
    const activitySummary = summarizeActivity(item, method);
    if (activitySummary) {
      return {
        content: activitySummary,
        eventType: "activity"
      };
    }
    return null;
  };
  const extractText = (input) => {
    if (typeof input === "string") {
      return input;
    }
    if (Array.isArray(input)) {
      const parts = input.map((entry) => extractText(entry).trim()).filter((entry) => entry.length > 0);
      return parts.join("\n").trim();
    }
    const record = asRecord$1(input);
    if (!record) {
      return "";
    }
    const directFields = [
      "text",
      "delta",
      "content",
      "outputText",
      "message",
      "value",
      "summary"
    ];
    for (const key of directFields) {
      if (key in record) {
        const value = extractText(record[key]);
        if (value.trim().length > 0) {
          return value;
        }
      }
    }
    if ("parts" in record) {
      const value = extractText(record.parts);
      if (value.trim().length > 0) {
        return value;
      }
    }
    return "";
  };
  const extractImageAttachments = (input) => {
    const attachments = [];
    const seenUrls = /* @__PURE__ */ new Set();
    const visit = (value) => {
      if (Array.isArray(value)) {
        for (const entry of value) {
          visit(entry);
        }
        return;
      }
      const record = asRecord$1(value);
      if (!record) {
        return;
      }
      const imageUrl = extractImageUrlFromRecord(record);
      if (imageUrl) {
        const normalized = imageUrl.trim();
        if (normalized.length > 0 && !seenUrls.has(normalized)) {
          seenUrls.add(normalized);
          attachments.push({
            id: `image-${attachments.length + 1}`,
            url: normalized,
            mimeType: pickString$2(record, [
              "mimeType",
              "mime_type",
              "mediaType",
              "media_type"
            ]) ?? inferMimeTypeFromDataUrl(normalized) ?? void 0,
            fileName: pickString$2(record, ["fileName", "filename", "name"]) ?? void 0
          });
        }
      }
      for (const nested of Object.values(record)) {
        if (typeof nested === "object" && nested !== null) {
          visit(nested);
        }
      }
    };
    visit(input);
    return attachments;
  };
  const extractImageUrlFromRecord = (value) => {
    const imageUrl = extractImageUrlValue(value.image_url) ?? extractImageUrlValue(value.imageUrl) ?? extractImageUrlValue(value.image);
    if (imageUrl && isSupportedImageUrl(imageUrl)) {
      return imageUrl;
    }
    const typeHint = (pickString$2(value, ["type", "itemType", "kind"]) ?? "").toLowerCase();
    if (!typeHint.includes("image")) {
      return null;
    }
    const fallback = extractImageUrlValue(value.url) ?? extractImageUrlValue(value.source) ?? extractImageUrlValue(value.data);
    if (fallback && isSupportedImageUrl(fallback)) {
      return fallback;
    }
    return null;
  };
  const extractImageUrlValue = (value) => {
    if (typeof value === "string") {
      return value;
    }
    const record = asRecord$1(value);
    if (!record) {
      return null;
    }
    const nested = record.url;
    if (typeof nested === "string") {
      return nested;
    }
    return null;
  };
  const isSupportedImageUrl = (value) => {
    const normalized = value.trim().toLowerCase();
    return normalized.startsWith("data:image/") || normalized.startsWith("https://") || normalized.startsWith("http://");
  };
  const inferMimeTypeFromDataUrl = (value) => {
    const match = value.match(/^data:(image\/[a-z0-9.+-]+);/i);
    return match?.[1]?.toLowerCase() ?? null;
  };
  const extractWebSearchToolCall = (item) => {
    const typeHint = (pickString$2(item, ["type", "itemType", "kind"]) ?? "").toLowerCase();
    if (typeHint !== "web_search_call") {
      return void 0;
    }
    const input = formatWebSearchActionInput(item.action);
    const status = inferToolCallStatus(item, "web_search_call", null) ?? "completed";
    return {
      name: "web_search",
      ...input ? { input } : {},
      status
    };
  };
  const formatWebSearchActionInput = (value) => {
    const record = asRecord$1(value);
    if (!record) {
      return void 0;
    }
    const type = pickString$2(record, ["type"]) ?? "search";
    const query = pickString$2(record, ["query"]);
    const url = pickString$2(record, ["url"]);
    const pattern = pickString$2(record, ["pattern"]);
    const queries = Array.isArray(record.queries) ? record.queries.filter((entry) => typeof entry === "string").map((entry) => entry.trim()).filter((entry) => entry.length > 0) : [];
    return stringifyJson({
      type,
      ...query ? { query } : {},
      ...url ? { url } : {},
      ...pattern ? { pattern } : {},
      ...queries.length > 0 ? { queries } : {}
    }) ?? void 0;
  };
  const extractDeclaredToolCall = (item) => {
    const record = asRecord$1(item.toolCall);
    if (!record) {
      return void 0;
    }
    const name = pickString$2(record, ["name", "toolName", "tool_name"]) ?? pickString$2(item, ["name", "toolName", "tool_name"]) ?? "tool";
    const input = (typeof record.input === "string" ? record.input : null) ?? formatToolPayload(record.input, { preferCommand: true }) ?? void 0;
    const output = (typeof record.output === "string" ? record.output : null) ?? formatToolOutputPayload(record.output) ?? void 0;
    const status = normalizeToolCallStatus(
      pickString$2(record, ["status", "state"]) ?? void 0
    );
    return {
      name,
      ...input ? { input } : {},
      ...output ? { output } : {},
      ...status ? { status } : {}
    };
  };
  const extractStructuredToolCall = (item, method, role, content) => {
    const webSearchToolCall = extractWebSearchToolCall(item);
    if (webSearchToolCall) {
      return webSearchToolCall;
    }
    const methodLower = method.toLowerCase();
    const explicitName = pickToolName(item, methodLower, role, false);
    const input = extractToolInput(item);
    const output = extractToolOutput(item, content, input);
    const methodSignalsTool = !isSyntheticReadMethod(methodLower) && structuredToolKeywords.some((keyword) => methodLower.includes(keyword));
    const hasToolPayloadFields = hasDirectToolPayload(item);
    const hasExecutionResultFields = hasExecutionMetadata(item);
    const hasInvocationEvidence = role === "tool" || explicitName !== null || methodSignalsTool || hasToolPayloadFields || hasExecutionResultFields;
    if (!hasInvocationEvidence) {
      return void 0;
    }
    if (!explicitName && !input && !output) {
      return void 0;
    }
    const name = explicitName ?? pickToolName(item, methodLower, role, true);
    const status = inferToolCallStatus(item, methodLower, output);
    return {
      name: name ?? "tool",
      ...input ? { input } : {},
      ...output ? { output } : {},
      ...status ? { status } : {}
    };
  };
  const pickToolName = (item, normalizedMethod, role, allowMethodFallback) => {
    const nestedInput = asRecord$1(item.input);
    const nestedArgs = asRecord$1(item.args);
    const nestedArguments = asRecord$1(item.arguments);
    const direct = pickString$2(item, ["toolName", "tool_name", "tool"]) ?? pickString$2(nestedInput, ["toolName", "tool_name", "tool"]) ?? pickString$2(nestedArgs, ["toolName", "tool_name", "tool"]) ?? pickString$2(nestedArguments, ["toolName", "tool_name", "tool"]) ?? (role === "tool" ? pickString$2(item, ["name"]) ?? pickString$2(nestedInput, ["name"]) ?? pickString$2(nestedArgs, ["name"]) ?? pickString$2(nestedArguments, ["name"]) : null);
    if (direct) {
      return direct;
    }
    const typeHint = (pickString$2(item, ["type", "itemType", "kind", "action"]) ?? "").trim();
    if (typeHint.length > 0 && (role === "tool" || isStrongToolTypeHint(typeHint))) {
      return typeHint;
    }
    if (!allowMethodFallback) {
      return null;
    }
    const methodSegments = normalizedMethod.split("/").filter((segment) => segment.length > 0);
    if (methodSegments.length === 0) {
      return null;
    }
    return methodSegments.join("_");
  };
  const isStrongToolTypeHint = (value) => {
    const normalized = value.toLowerCase();
    return normalized.includes("tool") || normalized.includes("exec") || normalized.includes("command") || normalized.includes("patch") || normalized.includes("search") || normalized.includes("write") || normalized.includes("diff") || normalized.includes("stdin");
  };
  const hasDirectToolPayload = (item) => {
    if (pickString$2(item, [
      "cmd",
      "command",
      "shellCommand",
      "shell_command",
      "patch",
      "diff",
      "chars",
      "cwd",
      "workdir",
      "workingDirectory",
      "path",
      "file",
      "filePath",
      "file_path"
    ]) !== null) {
      return true;
    }
    const nestedInput = asRecord$1(item.input);
    const nestedArgs = asRecord$1(item.args);
    const nestedArguments = asRecord$1(item.arguments);
    return [nestedInput, nestedArgs, nestedArguments].some(
      (record) => record !== null && pickString$2(record, [
        "cmd",
        "command",
        "shellCommand",
        "shell_command",
        "patch",
        "diff",
        "chars",
        "cwd",
        "workdir",
        "workingDirectory",
        "path",
        "file",
        "filePath",
        "file_path"
      ]) !== null
    );
  };
  const hasExecutionMetadata = (item) => {
    if (pickString$2(item, ["stdout", "stderr", "chunkId", "chunk_id"]) !== null || pickNumber$1(item, [
      "exitCode",
      "exit_code",
      "code",
      "wallTime",
      "wall_time",
      "wallTimeSeconds",
      "wall_time_seconds",
      "originalTokenCount",
      "original_token_count"
    ]) !== null) {
      return true;
    }
    const nestedOutput = asRecord$1(item.output) ?? asRecord$1(item.result) ?? asRecord$1(item.response);
    if (!nestedOutput) {
      return false;
    }
    return pickString$2(nestedOutput, ["stdout", "stderr", "chunkId", "chunk_id"]) !== null || pickNumber$1(nestedOutput, [
      "exitCode",
      "exit_code",
      "code",
      "wallTime",
      "wall_time",
      "wallTimeSeconds",
      "wall_time_seconds",
      "originalTokenCount",
      "original_token_count"
    ]) !== null;
  };
  const extractToolInput = (item) => {
    const directValue = item.input ?? item.args ?? item.arguments ?? item.payload ?? item.request ?? item.parameters;
    const formattedDirect = formatToolPayload(directValue, { preferCommand: true });
    if (formattedDirect) {
      return formattedDirect;
    }
    const command = pickString$2(item, ["cmd", "command", "shellCommand", "shell_command"]);
    if (command) {
      return command;
    }
    const patch = pickString$2(item, ["patch", "diff"]);
    if (patch) {
      return patch;
    }
    const chars = pickString$2(item, ["chars"]);
    if (chars) {
      return chars;
    }
    const cleaned = cleanToolRecord(item, [
      "threadId",
      "thread_id",
      "id",
      "eventId",
      "event_id",
      "messageId",
      "message_id",
      "itemId",
      "item_id",
      "call_id",
      "callId",
      "turnId",
      "turn_id",
      "role",
      "author",
      "name",
      "toolName",
      "tool_name",
      "type",
      "itemType",
      "status",
      "state",
      "kind",
      "action",
      "createdAt",
      "created_at",
      "updatedAt",
      "updated_at",
      "startedAt",
      "started_at",
      "completedAt",
      "completed_at",
      "output",
      "result",
      "response",
      "stdout",
      "stderr",
      "content",
      "text",
      "delta",
      "summary"
    ]);
    return stringifyJson(cleaned);
  };
  const extractToolOutput = (item, content, input) => {
    const directValue = item.output ?? item.result ?? item.response;
    const formattedDirect = formatToolOutputPayload(directValue);
    if (formattedDirect) {
      return formattedDirect;
    }
    const formattedExecution = formatExecutionOutput(item);
    if (formattedExecution) {
      return formattedExecution;
    }
    const normalizedContent = content.trim();
    if (normalizedContent.length > 0 && (!input || normalizeText(normalizedContent) !== normalizeText(input))) {
      return normalizedContent;
    }
    return null;
  };
  const inferToolCallStatus = (item, methodLower, output) => {
    const rawStatus = (pickString$2(item, ["status", "state", "phase", "result"]) ?? (methodLower.includes("failed") ? "failed" : methodLower.includes("completed") ? "completed" : methodLower.includes("started") ? "running" : null))?.toLowerCase() ?? null;
    if (!rawStatus) {
      return output ? "completed" : void 0;
    }
    if (rawStatus.includes("fail") || rawStatus.includes("error") || rawStatus.includes("reject")) {
      return "failed";
    }
    if (rawStatus.includes("complete") || rawStatus.includes("success") || rawStatus.includes("done")) {
      return "completed";
    }
    if (rawStatus.includes("start") || rawStatus.includes("run") || rawStatus.includes("progress") || rawStatus.includes("pending")) {
      return "running";
    }
    return output ? "completed" : void 0;
  };
  const normalizeToolCallStatus = (value) => {
    if (!value) {
      return void 0;
    }
    const normalized = value.toLowerCase();
    if (normalized.includes("fail") || normalized.includes("error") || normalized.includes("reject")) {
      return "failed";
    }
    if (normalized.includes("complete") || normalized.includes("success") || normalized.includes("done")) {
      return "completed";
    }
    if (normalized.includes("start") || normalized.includes("run") || normalized.includes("progress") || normalized.includes("pending")) {
      return "running";
    }
    return void 0;
  };
  const buildToolCallContent = (toolCall, content) => {
    const parts = [`Tool: ${toolCall.name}`];
    if (toolCall.input) {
      parts.push(`Input:
${toolCall.input}`);
    }
    if (toolCall.output) {
      parts.push(`Output:
${toolCall.output}`);
    } else if (content.trim().length > 0 && normalizeText(content) !== normalizeText(toolCall.input ?? "")) {
      parts.push(content.trim());
    }
    return parts.join("\n\n");
  };
  const formatToolOutputPayload = (value) => {
    const executionLike = formatExecutionOutput(value);
    if (executionLike) {
      return executionLike;
    }
    return formatToolPayload(value, { preferCommand: false });
  };
  const formatExecutionOutput = (value) => {
    const record = asRecord$1(value);
    if (!record) {
      return null;
    }
    const chunkId = pickStringDeep(record, ["chunkId", "chunk_id"]);
    const wallTime = pickNumberDeep(record, [
      "wallTime",
      "wall_time",
      "wallTimeSeconds",
      "wall_time_seconds",
      "durationSeconds",
      "duration_seconds"
    ]);
    const exitCode = pickNumberDeep(record, ["exitCode", "exit_code", "code"]);
    const originalTokenCount = pickNumberDeep(record, [
      "originalTokenCount",
      "original_token_count"
    ]);
    const outputText = combineOutputStreams(record) ?? formatToolPayload(record.output, { preferCommand: false }) ?? formatToolPayload(record.result, { preferCommand: false }) ?? formatToolPayload(record.response, { preferCommand: false });
    const lines = [];
    if (chunkId) {
      lines.push(`Chunk ID: ${chunkId}`);
    }
    if (wallTime !== null) {
      lines.push(`Wall time: ${wallTime} seconds`);
    }
    if (exitCode !== null) {
      lines.push(`Process exited with code ${exitCode}`);
    }
    if (originalTokenCount !== null) {
      lines.push(`Original token count: ${originalTokenCount}`);
    }
    if (outputText) {
      if (lines.length > 0) {
        lines.push("Output:");
      }
      lines.push(outputText);
    }
    return lines.length > 0 ? lines.join("\n") : null;
  };
  const combineOutputStreams = (record) => {
    const stdout = pickString$2(record, ["stdout"]);
    const stderr = pickString$2(record, ["stderr"]);
    const output = pickString$2(record, ["output"]);
    const parts = [stdout, stderr, output].map((part) => typeof part === "string" ? sanitizeExecutionText(part) : null).filter((part) => typeof part === "string" && part.trim().length > 0);
    if (parts.length === 0) {
      return null;
    }
    return parts.join("\n");
  };
  const sanitizeExecutionText = (value) => value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const formatToolPayload = (value, options) => {
    if (value === null || value === void 0) {
      return null;
    }
    if (typeof value === "string") {
      const sanitized = sanitizeExecutionText(value);
      return sanitized.length > 0 ? sanitized : null;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (Array.isArray(value)) {
      const text2 = extractText(value).trim();
      if (text2.length > 0) {
        return text2;
      }
      return stringifyJson(value);
    }
    const record = asRecord$1(value);
    if (!record) {
      return null;
    }
    if (options.preferCommand) {
      const command = pickStringDeep(record, [
        "cmd",
        "command",
        "shellCommand",
        "shell_command"
      ]);
      if (command) {
        return command;
      }
    }
    const patch = pickString$2(record, ["patch", "diff"]);
    if (patch) {
      return patch;
    }
    const chars = pickString$2(record, ["chars"]);
    if (chars) {
      return chars;
    }
    const text = extractText(record).trim();
    if (text.length > 0) {
      return text;
    }
    return stringifyJson(record);
  };
  const cleanToolRecord = (record, excludedKeys) => {
    const excluded = new Set(excludedKeys);
    const cleanedEntries = Object.entries(record).filter(([key, value]) => {
      if (excluded.has(key)) {
        return false;
      }
      if (value === null || value === void 0) {
        return false;
      }
      if (typeof value === "string" && value.trim().length === 0) {
        return false;
      }
      return true;
    });
    if (cleanedEntries.length === 0) {
      return null;
    }
    return Object.fromEntries(cleanedEntries);
  };
  const stringifyJson = (value) => {
    if (value === null || value === void 0) {
      return null;
    }
    try {
      const serialized = JSON.stringify(value, null, 2);
      return serialized && serialized !== "{}" && serialized !== "[]" ? serialized : null;
    } catch {
      return null;
    }
  };
  const normalizeText = (value) => value.replace(/\s+/g, " ").trim();
  const inferEventType = (item, method, role) => {
    const normalizedMethod = method.toLowerCase();
    const methodForClassification = isSyntheticReadMethod(normalizedMethod) ? "" : normalizedMethod;
    const itemType = (pickString$2(item, ["type", "itemType", "name", "status", "action", "kind"]) ?? "").toLowerCase();
    const signal = `${itemType} ${methodForClassification}`;
    if (signal.includes("reasoning") || signal.includes("analysis") || signal.includes("thinking")) {
      return "reasoning";
    }
    if (role === "tool" || activityKeywords.some((keyword) => signal.includes(keyword))) {
      return "activity";
    }
    if (pickString$2(item, ["command", "cmd", "path", "file", "filePath", "cwd", "workdir"]) !== null) {
      return "activity";
    }
    return void 0;
  };
  const summarizeActivity = (item, method) => {
    const methodLower = method.toLowerCase();
    const methodForClassification = isSyntheticReadMethod(methodLower) ? "" : methodLower;
    const kind = (pickString$2(item, ["type", "itemType", "action", "kind", "name", "status"]) ?? "").toLowerCase();
    const signal = `${kind} ${methodForClassification}`;
    const isActivity = activityKeywords.some((keyword) => signal.includes(keyword)) || pickString$2(item, ["command", "cmd", "path", "file", "filePath", "cwd", "workdir"]) !== null;
    if (!isActivity) {
      return null;
    }
    const command = pickString$2(item, ["cmd", "command", "shellCommand", "shell_command"]) ?? pickString$2(asRecord$1(item.input), ["cmd", "command", "shellCommand", "shell_command"]);
    const path = pickString$2(item, ["path", "file", "filePath", "target", "cwd", "workdir", "workingDirectory"]) ?? pickString$2(asRecord$1(item.input), [
      "path",
      "file",
      "filePath",
      "target",
      "cwd",
      "workdir",
      "workingDirectory"
    ]);
    const tool = pickString$2(item, ["toolName", "tool", "name"]) ?? pickString$2(asRecord$1(item.input), ["toolName", "tool", "name"]);
    const added = pickNumber$1(item, ["additions", "added", "insertions", "linesAdded", "addedLines"]);
    const removed = pickNumber$1(item, ["deletions", "removed", "linesRemoved", "removedLines"]);
    let title = "Activity";
    if (signal.includes("search") || signal.includes("read")) {
      title = "Explored";
    } else if (signal.includes("edit") || signal.includes("patch") || signal.includes("write") || signal.includes("diff")) {
      title = "Edited";
    } else if (signal.includes("command") || signal.includes("exec") || signal.includes("shell") || signal.includes("run")) {
      title = "Ran";
    } else if (signal.includes("plan")) {
      title = "Planned";
    }
    const lines = [title];
    if (command) {
      lines.push(`Command: \`${truncate(command, 180)}\``);
    }
    if (path) {
      lines.push(`Path: \`${truncate(path, 140)}\``);
    }
    if (tool) {
      lines.push(`Tool: ${truncate(tool, 80)}`);
    }
    if (added !== null || removed !== null) {
      lines.push(`Changes: +${added ?? 0} -${removed ?? 0}`);
    }
    if (lines.length === 1) {
      lines.push(`Event: ${method}`);
    }
    return lines.join("\n");
  };
  const isSyntheticReadMethod = (method) => method === "message/read" || method === "item/read";
  const shouldPreserveRawChunk = (method, role) => {
    const normalized = method.toLowerCase();
    return normalized.includes("delta") && role !== "user";
  };
  const buildStableMessageId = (params) => {
    const resolvedTurnId = params.turnId ?? extractTurnId(null, params.record);
    const fingerprintSource = params.payload.toolCall ? [
      params.payload.toolCall.name,
      params.payload.toolCall.input ?? "",
      params.payload.toolCall.output ?? ""
    ].join(" ") : params.payload.content;
    const fingerprint = stableMessageFingerprint(fingerprintSource) ?? stableMessageFingerprint(
      pickString$2(params.record, ["type", "itemType", "kind", "name"]) ?? "message"
    ) ?? "message";
    return [
      params.threadId,
      resolvedTurnId ?? "no-turn",
      params.role,
      params.eventType ?? "message",
      params.method.replaceAll("/", "-"),
      fingerprint,
      ...params.payload.toolCall ? [] : [params.createdAt]
    ].join("::");
  };
  const toTimelineMessageId = (params) => {
    if (params.eventType !== "reasoning") {
      return params.baseId;
    }
    const suffix = `::${params.createdAt}`;
    return params.baseId.endsWith(suffix) ? params.baseId : `${params.baseId}${suffix}`;
  };
  const extractTurnId = (params, record) => {
    const paramTurn = asRecord$1(params?.turn);
    const recordTurn = asRecord$1(record.turn);
    return pickString$2(record, ["turnId", "turn_id"]) ?? pickString$2(recordTurn, ["id", "turnId", "turn_id"]) ?? pickString$2(params, ["turnId", "turn_id"]) ?? pickString$2(paramTurn, ["id", "turnId", "turn_id"]);
  };
  const stableMessageFingerprint = (value) => {
    const normalized = value.toLowerCase().replace(/\s+/g, " ").trim().replace(/[^a-z0-9._/-]+/g, "-").replace(/-+/g, "-").replace(/^[-/]+|[-/]+$/g, "");
    if (normalized.length === 0) {
      return null;
    }
    return normalized.slice(0, 80);
  };
  const asRecord$1 = (value) => typeof value === "object" && value !== null ? value : null;
  const pickString$2 = (value, keys) => {
    if (!value) {
      return null;
    }
    for (const key of keys) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate;
      }
    }
    return null;
  };
  const pickStringDeep = (input, keys, depth = 0) => {
    if (depth > 5) {
      return null;
    }
    const record = asRecord$1(input);
    if (record) {
      const direct = pickString$2(record, keys);
      if (direct) {
        return direct;
      }
      for (const nested of Object.values(record)) {
        const found = pickStringDeep(nested, keys, depth + 1);
        if (found) {
          return found;
        }
      }
    }
    if (Array.isArray(input)) {
      for (const entry of input) {
        const found = pickStringDeep(entry, keys, depth + 1);
        if (found) {
          return found;
        }
      }
    }
    return null;
  };
  const pickNumber$1 = (value, keys) => {
    if (!value) {
      return null;
    }
    for (const key of keys) {
      const candidate = value[key];
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return candidate;
      }
      if (typeof candidate === "string") {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return null;
  };
  const pickNumberDeep = (input, keys, depth = 0) => {
    if (depth > 5) {
      return null;
    }
    const record = asRecord$1(input);
    if (record) {
      const direct = pickNumber$1(record, keys);
      if (direct !== null) {
        return direct;
      }
      for (const nested of Object.values(record)) {
        const found = pickNumberDeep(nested, keys, depth + 1);
        if (found !== null) {
          return found;
        }
      }
    }
    if (Array.isArray(input)) {
      for (const entry of input) {
        const found = pickNumberDeep(entry, keys, depth + 1);
        if (found !== null) {
          return found;
        }
      }
    }
    return null;
  };
  const truncate = (value, maxLength) => value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
  const DEFAULT_MODEL = "gpt-5.3-codex";
  const DEFAULT_MODELS = ["gpt-5.3-codex", "gpt-5.2", "gpt-5.1-codex-mini"];
  const BASE_THREADS = {
    local: [
      {
        id: "thread-mock-001",
        title: "Investigate blank renderer startup",
        cwd: "/Users/mock/workspace/codex-app-electron",
        updatedAt: "2026-03-12T09:30:00.000Z",
        model: DEFAULT_MODEL,
        messages: [
          {
            id: "msg-mock-001-user",
            role: "user",
            content: "Why is the Electron renderer blank on launch?",
            createdAt: "2026-03-12T09:28:00.000Z"
          },
          {
            id: "msg-mock-001-assistant",
            role: "assistant",
            content: "The renderer boot path is failing before first paint. Capture preload, console, and IPC milestones first.",
            createdAt: "2026-03-12T09:29:10.000Z"
          }
        ]
      },
      {
        id: "thread-mock-002",
        title: "Theme toggle follow-up",
        cwd: "/Users/mock/workspace/codex-app-electron",
        updatedAt: "2026-03-12T08:14:00.000Z",
        model: "gpt-5.2",
        messages: [
          {
            id: "msg-mock-002-user",
            role: "user",
            content: "Make the light and dark themes feel more intentional.",
            createdAt: "2026-03-12T08:10:00.000Z"
          },
          {
            id: "msg-mock-002-assistant",
            role: "assistant",
            content: "Use a brighter paper background in light mode and denser panel contrast in dark mode.",
            createdAt: "2026-03-12T08:12:25.000Z"
          }
        ]
      },
      {
        id: "thread-mock-003",
        title: "Tool chronology regression fixture",
        cwd: "/Users/mock/workspace/codex-app-electron",
        updatedAt: "2026-03-12T07:30:00.000Z",
        model: DEFAULT_MODEL,
        messages: [
          {
            id: "user-turn-1",
            role: "user",
            content: "Run pwd once",
            createdAt: "2026-03-08T09:10:00.000Z"
          },
          {
            id: "call-reused",
            role: "tool",
            eventType: "tool_call",
            content: 'Tool: exec_command\n\nInput:\n{"cmd":"pwd"}\n\nOutput:\n/Users/demo/project-1',
            createdAt: "2026-03-08T09:10:01.000Z",
            toolCall: {
              name: "exec_command",
              input: '{"cmd":"pwd"}',
              output: "/Users/demo/project-1",
              status: "completed"
            }
          },
          {
            id: "user-turn-2",
            role: "user",
            content: "Run pwd again",
            createdAt: "2026-03-08T09:11:00.000Z"
          },
          {
            id: "call-reused",
            role: "tool",
            eventType: "tool_call",
            content: 'Tool: exec_command\n\nInput:\n{"cmd":"pwd"}\n\nOutput:\n/Users/demo/project-2',
            createdAt: "2026-03-08T09:11:01.000Z",
            toolCall: {
              name: "exec_command",
              input: '{"cmd":"pwd"}',
              output: "/Users/demo/project-2",
              status: "completed"
            }
          }
        ]
      }
    ],
    ssh: [
      {
        id: "thread-ssh-001",
        title: "Remote smoke validation",
        cwd: "/srv/mock/codex-app-electron",
        updatedAt: "2026-03-12T07:00:00.000Z",
        model: DEFAULT_MODEL,
        messages: [
          {
            id: "msg-ssh-001-user",
            role: "user",
            content: "Check the remote app-server health.",
            createdAt: "2026-03-12T06:58:00.000Z"
          },
          {
            id: "msg-ssh-001-assistant",
            role: "assistant",
            content: "Remote mock health is stable. SSH forwarder metrics look clean.",
            createdAt: "2026-03-12T06:59:10.000Z"
          }
        ]
      }
    ]
  };
  const BASE_DIRECTORIES = {
    local: {
      "/Users/mock": ["workspace/"],
      "/Users/mock/workspace": ["codex-app-electron/", "docs/", "playgrounds/"],
      "/Users/mock/workspace/codex-app-electron": [
        "src/",
        "build/",
        "scripts/",
        ".git/",
        "README.md"
      ]
    },
    ssh: {
      "/srv": ["mock/"],
      "/srv/mock": ["codex-app-electron/"],
      "/srv/mock/codex-app-electron": ["src/", "logs/", "README.md"]
    }
  };
  const runtimeRegistry = /* @__PURE__ */ new Map();
  const getMockRuntime = (endpoint) => {
    const existing = runtimeRegistry.get(endpoint);
    if (existing) {
      return existing;
    }
    const created = createMockRuntime(endpoint);
    runtimeRegistry.set(endpoint, created);
    return created;
  };
  const isMockEndpoint = (endpoint) => endpoint.startsWith("mock://");
  const createMockRuntime = (endpoint) => {
    const state = createInitialState(resolveEndpointKind(endpoint));
    const notificationHandlers = /* @__PURE__ */ new Set();
    const subscribe = (handler) => {
      notificationHandlers.add(handler);
      return () => {
        notificationHandlers.delete(handler);
      };
    };
    const emitNotification = (method, params) => {
      for (const handler of notificationHandlers) {
        handler({ method, params });
      }
    };
    return {
      subscribe,
      async call(method, params) {
        switch (method) {
          case "initialize":
          case "initialized":
            return {};
          case "account/read":
            return { authenticated: state.accountAuthenticated };
          case "model/list":
            return { models: [...state.models] };
          case "thread/list":
            return {
              data: [...state.threads].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)).map(toThreadListRecord)
            };
          case "thread/read": {
            const threadId = pickThreadId(params);
            const thread = requireThread(state, threadId);
            return {
              thread: {
                ...toThreadListRecord(thread),
                messages: thread.messages.map((message) => ({ ...message }))
              }
            };
          }
          case "thread/resume": {
            const thread = requireThread(state, pickThreadId(params));
            return { threadId: thread.id, model: thread.model };
          }
          case "thread/start": {
            const cwd = pickString$1(params, "cwd") ?? defaultCwd(state.kind);
            state.threadCounter += 1;
            const thread = {
              id: `thread-mock-${String(state.threadCounter).padStart(3, "0")}`,
              title: "New mock session",
              cwd,
              updatedAt: timestampForCounter(state.threadCounter, 40),
              model: DEFAULT_MODEL,
              messages: []
            };
            state.threads = [thread, ...state.threads];
            emitNotification("thread/created", { threadId: thread.id });
            return {
              threadId: thread.id,
              cwd,
              model: thread.model,
              thread: toThreadListRecord(thread)
            };
          }
          case "turn/start": {
            const thread = requireThread(state, pickThreadId(params));
            state.turnCounter += 1;
            const prompt = extractPrompt(params) ?? "Continue.";
            const userMessage = {
              id: `msg-${thread.id}-user-${String(state.turnCounter).padStart(3, "0")}`,
              role: "user",
              content: prompt,
              createdAt: timestampForCounter(state.turnCounter, 50)
            };
            const assistantMessage = {
              id: `msg-${thread.id}-assistant-${String(state.turnCounter).padStart(3, "0")}`,
              role: "assistant",
              content: `Mock response for: ${prompt}`,
              createdAt: timestampForCounter(state.turnCounter, 51)
            };
            thread.messages = [...thread.messages, userMessage, assistantMessage];
            thread.updatedAt = assistantMessage.createdAt;
            emitNotification("thread/updated", {
              threadId: thread.id,
              turnId: `turn-${String(state.turnCounter).padStart(3, "0")}`
            });
            return { turnId: `turn-${String(state.turnCounter).padStart(3, "0")}` };
          }
          case "command/exec": {
            const command = pickCommand(params);
            const cwd = pickString$1(params, "cwd") ?? defaultCwd(state.kind);
            if (command.startsWith("ls ")) {
              const entries = state.directories[cwd] ?? [];
              return {
                exitCode: 0,
                stdout: `${entries.join("\n")}${entries.length > 0 ? "\n" : ""}`,
                stderr: ""
              };
            }
            return {
              exitCode: 0,
              stdout: "",
              stderr: ""
            };
          }
          default:
            throw new Error(`Unsupported mock RPC method: ${method}`);
        }
      }
    };
  };
  const createInitialState = (kind) => ({
    kind,
    accountAuthenticated: true,
    models: [...DEFAULT_MODELS],
    directories: structuredClone(BASE_DIRECTORIES[kind]),
    threads: structuredClone(BASE_THREADS[kind]),
    threadCounter: BASE_THREADS[kind].length,
    turnCounter: 0
  });
  const resolveEndpointKind = (endpoint) => endpoint.includes("/ssh/") ? "ssh" : "local";
  const toThreadListRecord = (thread) => ({
    id: thread.id,
    title: thread.title,
    preview: thread.messages.at(-1)?.content ?? "",
    updatedAt: thread.updatedAt,
    cwd: thread.cwd,
    model: thread.model
  });
  const requireThread = (state, threadId) => {
    const thread = state.threads.find((entry) => entry.id === threadId);
    if (!thread) {
      throw new Error(`Unknown mock thread: ${threadId}`);
    }
    return thread;
  };
  const pickThreadId = (params) => {
    const threadId = pickString$1(params, "threadId") ?? pickString$1(params, "thread_id") ?? pickString$1(params, "id");
    if (!threadId) {
      throw new Error("Mock RPC request is missing threadId.");
    }
    return threadId;
  };
  const pickString$1 = (value, key) => {
    if (!value || typeof value !== "object") {
      return null;
    }
    const candidate = value[key];
    return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
  };
  const pickCommand = (params) => {
    if (!params || typeof params !== "object") {
      return "";
    }
    const command = params.command;
    if (Array.isArray(command)) {
      return command.map((entry) => String(entry)).join(" ");
    }
    return typeof command === "string" ? command : "";
  };
  const extractPrompt = (params) => {
    if (!params || typeof params !== "object") {
      return null;
    }
    const input = params.input;
    return extractPromptFromValue(input);
  };
  const extractPromptFromValue = (value) => {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        const nested = extractPromptFromValue(entry);
        if (nested) {
          return nested;
        }
      }
      return null;
    }
    if (value && typeof value === "object") {
      const record = value;
      for (const key of ["text", "content"]) {
        const nested = extractPromptFromValue(record[key]);
        if (nested) {
          return nested;
        }
      }
    }
    return null;
  };
  const defaultCwd = (kind) => kind === "ssh" ? "/srv/mock/codex-app-electron" : "/Users/mock/workspace/codex-app-electron";
  const timestampForCounter = (counter, offsetSeconds) => new Date(Date.UTC(2026, 2, 12, 10, 0, counter * 2 + offsetSeconds)).toISOString();
  class JsonRpcClient {
    url;
    socket = null;
    mockRuntime = null;
    nextId = 1;
    pending = /* @__PURE__ */ new Map();
    notificationHandlers = /* @__PURE__ */ new Set();
    mockUnsubscribe = null;
    static CONNECT_MAX_ATTEMPTS = 45;
    static CONNECT_RETRY_DELAY_MS = 250;
    constructor(url) {
      this.url = url;
    }
    async connect() {
      if (isMockEndpoint(this.url)) {
        if (!this.mockRuntime) {
          this.mockRuntime = getMockRuntime(this.url);
          this.mockUnsubscribe = this.mockRuntime.subscribe((notification) => {
            for (const handler of this.notificationHandlers) {
              handler({
                method: notification.method,
                params: notification.params
              });
            }
          });
        }
        return;
      }
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        return;
      }
      if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
        await this.waitForOpen(this.socket);
        return;
      }
      let lastError = null;
      for (let attempt = 1; attempt <= JsonRpcClient.CONNECT_MAX_ATTEMPTS; attempt += 1) {
        const socket = new WebSocket(this.url);
        this.socket = socket;
        socket.addEventListener("message", (event) => {
          this.handleMessage(event.data);
        });
        socket.addEventListener("close", () => {
          for (const [id, resolver] of this.pending) {
            resolver.reject(new Error(`RPC request ${id} aborted: websocket closed`));
          }
          this.pending.clear();
        });
        socket.addEventListener("error", () => {
        });
        try {
          await this.waitForOpen(socket);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(`Failed to connect to websocket endpoint: ${this.url}`);
          try {
            socket.close();
          } catch {
          }
          if (this.socket === socket) {
            this.socket = null;
          }
          if (attempt < JsonRpcClient.CONNECT_MAX_ATTEMPTS) {
            await sleep(JsonRpcClient.CONNECT_RETRY_DELAY_MS);
          }
        }
      }
      throw lastError ?? new Error(`Failed to connect to websocket endpoint: ${this.url}`);
    }
    close() {
      this.mockUnsubscribe?.();
      this.mockUnsubscribe = null;
      this.mockRuntime = null;
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
    }
    async call(method, params) {
      await this.connect();
      if (this.mockRuntime) {
        return this.mockRuntime.call(method, params);
      }
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket not connected");
      }
      const id = this.nextId;
      this.nextId += 1;
      const payload = {
        jsonrpc: "2.0",
        id,
        method,
        ...params === void 0 ? {} : { params }
      };
      const responsePromise = new Promise((resolve, reject) => {
        this.pending.set(id, {
          resolve: (value) => resolve(value),
          reject
        });
      });
      this.socket.send(JSON.stringify(payload));
      return responsePromise;
    }
    onNotification(handler) {
      this.notificationHandlers.add(handler);
      return () => {
        this.notificationHandlers.delete(handler);
      };
    }
    async waitForOpen(socket) {
      if (socket.readyState === WebSocket.OPEN) {
        return;
      }
      await new Promise((resolve, reject) => {
        const onOpen = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error(`Failed to connect to websocket endpoint: ${this.url}`));
        };
        const onClose = () => {
          cleanup();
          reject(new Error(`Websocket closed while connecting: ${this.url}`));
        };
        const cleanup = () => {
          socket.removeEventListener("open", onOpen);
          socket.removeEventListener("error", onError);
          socket.removeEventListener("close", onClose);
        };
        socket.addEventListener("open", onOpen);
        socket.addEventListener("error", onError);
        socket.addEventListener("close", onClose);
      });
    }
    handleMessage(raw) {
      if (typeof raw !== "string") {
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      if (!isObject(parsed)) {
        return;
      }
      if (typeof parsed.method === "string") {
        const notification = {
          method: parsed.method,
          params: parsed.params
        };
        for (const handler of this.notificationHandlers) {
          handler({ method: notification.method, params: notification.params });
        }
        return;
      }
      if (typeof parsed.id === "number") {
        const response = parsed;
        const pending = this.pending.get(response.id);
        if (!pending) {
          return;
        }
        this.pending.delete(response.id);
        if (response.error) {
          pending.reject(
            new Error(`${response.error.message} (code ${response.error.code})`)
          );
        } else {
          pending.resolve(response.result);
        }
      }
    }
  }
  const isObject = (value) => typeof value === "object" && value !== null;
  const sleep = (durationMs) => new Promise((resolve) => {
    globalThis.setTimeout(resolve, durationMs);
  });
  const toolCallCompletenessScore = (message) => {
    if (!message.toolCall) {
      return 0;
    }
    return (message.toolCall.name.trim().length > 0 ? 1 : 0) + (message.toolCall.input?.trim().length ? 1 : 0) + (message.toolCall.output?.trim().length ? 2 : 0) + (message.toolCall.status === "completed" || message.toolCall.status === "failed" ? 1 : 0);
  };
  const parseMessageTimestampMs = (value) => {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? -1 : parsed;
  };
  const compareMessageTimelineOrder = (a, b) => {
    if (typeof a.timelineOrder === "number" && typeof b.timelineOrder === "number" && a.timelineOrder !== b.timelineOrder) {
      return a.timelineOrder - b.timelineOrder;
    }
    return 0;
  };
  const sortMessagesAscending = (a, b) => {
    const aMs = parseMessageTimestampMs(a.createdAt);
    const bMs = parseMessageTimestampMs(b.createdAt);
    if (aMs === -1 && bMs === -1) {
      return compareMessageTimelineOrder(a, b);
    }
    if (aMs === -1) {
      return 1;
    }
    if (bMs === -1) {
      return -1;
    }
    if (aMs === bMs) {
      return compareMessageTimelineOrder(a, b);
    }
    return aMs - bMs;
  };
  const assignMissingTimelineOrder = (messages) => messages.map((message, index) => ({
    ...message,
    ...typeof message.timelineOrder === "number" ? {} : { timelineOrder: index }
  }));
  const clients = /* @__PURE__ */ new Map();
  const ROLLOUT_TOOL_CACHE_KEY_SEPARATOR = "";
  const rolloutToolMessagesCache = /* @__PURE__ */ new Map();
  const rolloutToolMessagesInFlight = /* @__PURE__ */ new Map();
  const rolloutToolMessagesLatestKeyByPath = /* @__PURE__ */ new Map();
  const closeDeviceClient = (deviceId) => {
    const existing = clients.get(deviceId);
    if (!existing) {
      return;
    }
    existing.unsubscribe?.();
    existing.client.close();
    clients.delete(deviceId);
    clearRolloutToolMessagesForDevice(deviceId);
  };
  const closeAllClients = () => {
    for (const deviceId of clients.keys()) {
      closeDeviceClient(deviceId);
    }
  };
  const ensureClientState = async (device) => {
    const endpoint = device.connection?.endpoint;
    if (!endpoint) {
      throw new Error(`Device ${device.name} is not connected`);
    }
    const existing = clients.get(device.id);
    if (existing && existing.endpoint === endpoint) {
      return existing;
    }
    if (existing) {
      existing.unsubscribe?.();
      existing.client.close();
    }
    const client = new JsonRpcClient(endpoint);
    const unsubscribe = client.onNotification((notification) => {
    });
    const state = {
      endpoint,
      client,
      initialized: false,
      unsubscribe
    };
    clients.set(device.id, state);
    return state;
  };
  const ensureInitialized = async (device) => {
    const state = await ensureClientState(device);
    const client = state.client;
    await client.connect();
    if (!state.initialized) {
      try {
        await client.call("initialize", {
          clientInfo: {
            name: "codex-session-monitor",
            version: "0.1.0"
          }
        });
      } catch (error) {
        throw new Error(
          `Failed to initialize app-server for device ${device.name}: ${asErrorMessage(error)}`
        );
      }
      try {
        await client.call("initialized", {});
      } catch {
        try {
          await client.call("initialized");
        } catch {
        }
      }
      state.initialized = true;
    }
    return client;
  };
  const readThread = async (device, threadId, options) => {
    const client = await ensureInitialized(device);
    const result = await callWithFallback(client, "thread/read", [
      { threadId, includeTurns: true },
      { threadId }
    ]);
    const root = asRecord(result);
    const thread = asRecord(root?.thread) ?? root;
    const preview = pickSummaryPreview(thread);
    const baseTitle = deriveSessionBaseTitle(thread, threadId, preview);
    const cwd = pickString(thread, ["cwd", "workingDirectory", "working_directory"]);
    const rolloutPath = pickString(thread, ["path"]);
    const folderName = folderNameFromPath(cwd);
    const model = pickThreadModel(thread);
    const session = {
      key: makeSessionKey(device.id, threadId),
      threadId,
      deviceId: device.id,
      deviceLabel: device.name,
      deviceAddress: deviceAddress(device),
      title: formatSessionTitle(baseTitle, threadId),
      preview,
      updatedAt: pickTimestampIso(thread) ?? "",
      cwd: cwd ?? void 0,
      folderName: folderName ?? void 0
    };
    const threadMessages = options?.skipMessages ? [] : parseMessagesFromThread(device.id, threadId, thread);
    const rolloutMessages = options?.skipMessages || options?.includeRolloutMessages === false ? [] : await readRolloutTimelineMessages(device, threadId, rolloutPath, session.updatedAt);
    const messages = options?.skipMessages ? [] : rolloutMessages.length > 0 ? rolloutMessages : dedupeHistoricalMessages(threadMessages);
    if (!options?.skipMessages) {
      const firstUserMessage = messages.find((message) => message.role === "user");
      const latestPreviewMessage = [...messages].reverse().find((message) => message.role === "assistant" || message.role === "user") ?? messages.at(-1);
      session.title = formatSessionTitle(
        firstUserMessage ? truncateForTitle(firstUserMessage.content.trim()) : baseTitle,
        threadId
      );
      session.preview = latestPreviewMessage?.content?.trim() || session.preview;
      session.updatedAt = session.updatedAt || messages.at(-1)?.createdAt || "";
    }
    return {
      session,
      messages,
      ...rolloutPath ? { rolloutPath } : {},
      ...model ? { model } : {}
    };
  };
  const readRolloutTimelineMessages = async (device, threadId, rolloutPath, revision) => {
    if (!rolloutPath || rolloutPath.trim().length === 0) {
      return [];
    }
    const normalizedPath = rolloutPath.trim();
    const pathKey = buildRolloutToolMessagesPathKey(device.id, threadId, normalizedPath);
    const cacheKey = buildRolloutToolMessagesCacheKey(pathKey, revision ?? "");
    const previousCacheKey = rolloutToolMessagesLatestKeyByPath.get(pathKey);
    if (previousCacheKey && previousCacheKey !== cacheKey) {
      rolloutToolMessagesCache.delete(previousCacheKey);
    }
    rolloutToolMessagesLatestKeyByPath.set(pathKey, cacheKey);
    const cached = rolloutToolMessagesCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const inFlight = rolloutToolMessagesInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }
    let pending;
    pending = readRolloutTimelineMessagesUncached(device, threadId, normalizedPath).then((messages) => {
      if (rolloutToolMessagesLatestKeyByPath.get(pathKey) === cacheKey) {
        rolloutToolMessagesCache.set(cacheKey, messages);
      }
      return messages;
    }).finally(() => {
      if (rolloutToolMessagesInFlight.get(cacheKey) === pending) {
        rolloutToolMessagesInFlight.delete(cacheKey);
      }
    });
    rolloutToolMessagesInFlight.set(cacheKey, pending);
    return pending;
  };
  const readRolloutTimelineMessagesUncached = async (device, threadId, rolloutPath) => {
    if (rolloutPath.trim().length === 0) {
      return [];
    }
    const client = await ensureInitialized(device);
    const result = await client.call("command/exec", {
      command: [
        "sh",
        "-lc",
        [
          `path=${quotePosixShell(rolloutPath)}`,
          '[ -f "$path" ] || exit 0',
          "if command -v python3 >/dev/null 2>&1; then py=python3",
          "elif command -v python >/dev/null 2>&1; then py=python",
          "else exit 0",
          "fi",
          `"${"$"}py" -c ${quotePosixShell(buildCompactRolloutPythonScript())} "$path"`
        ].join("; ")
      ],
      cwd: "."
    });
    const response = asRecord(result);
    const exitCodeRaw = response?.exitCode ?? response?.exit_code;
    const exitCode = typeof exitCodeRaw === "number" ? exitCodeRaw : typeof exitCodeRaw === "string" ? Number.parseInt(exitCodeRaw, 10) : 0;
    if (!Number.isFinite(exitCode) || exitCode !== 0) {
      return [];
    }
    const stdout = typeof response?.stdout === "string" ? response.stdout.trim() : "";
    if (stdout.length === 0) {
      return [];
    }
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((value) => toTimelineMessageFromRolloutRecord(device.id, threadId, asRecord(value))).filter((value) => value !== null).map((message, index) => ({
      ...message,
      ...typeof message.timelineOrder === "number" ? {} : { timelineOrder: index }
    })).sort(sortMessagesAscending);
  };
  const clearRolloutToolMessagesForDevice = (deviceId) => {
    const devicePrefix = `${deviceId}${ROLLOUT_TOOL_CACHE_KEY_SEPARATOR}`;
    for (const key of rolloutToolMessagesCache.keys()) {
      if (key.startsWith(devicePrefix)) {
        rolloutToolMessagesCache.delete(key);
      }
    }
    for (const key of rolloutToolMessagesInFlight.keys()) {
      if (key.startsWith(devicePrefix)) {
        rolloutToolMessagesInFlight.delete(key);
      }
    }
    for (const [pathKey] of rolloutToolMessagesLatestKeyByPath) {
      if (pathKey.startsWith(devicePrefix)) {
        rolloutToolMessagesLatestKeyByPath.delete(pathKey);
      }
    }
  };
  const buildRolloutToolMessagesPathKey = (deviceId, threadId, rolloutPath) => [deviceId, threadId, rolloutPath].join(ROLLOUT_TOOL_CACHE_KEY_SEPARATOR);
  const buildRolloutToolMessagesCacheKey = (pathKey, revision) => [pathKey, revision].join(ROLLOUT_TOOL_CACHE_KEY_SEPARATOR);
  const toTimelineMessageFromRolloutRecord = (deviceId, threadId, record) => {
    if (!record) {
      return null;
    }
    const kind = pickString(record, ["kind"]);
    if (kind === "message") {
      return toHistoryMessageFromRolloutRecord(deviceId, threadId, record);
    }
    const id = pickString(record, ["id"]);
    const name = pickString(record, ["name"]);
    const createdAt = normalizeIso(pickString(record, ["createdAt"])) ?? (/* @__PURE__ */ new Date()).toISOString();
    if (!id || !name) {
      return null;
    }
    const entry = {
      id,
      name,
      createdAt,
      updatedAt: normalizeIso(pickString(record, ["updatedAt"])) ?? createdAt,
      ...typeof pickNumber(record, ["order"]) === "number" ? { order: pickNumber(record, ["order"]) ?? void 0 } : {},
      ...pickString(record, ["input"]) ? { input: pickString(record, ["input"]) ?? void 0 } : {},
      ...pickString(record, ["output"]) ? { output: pickString(record, ["output"]) ?? void 0 } : {},
      ...normalizeToolStatus(pickString(record, ["status"])) ? { status: normalizeToolStatus(pickString(record, ["status"])) } : {}
    };
    return toToolMessageFromRolloutEntry(deviceId, threadId, entry);
  };
  const toHistoryMessageFromRolloutRecord = (deviceId, threadId, record) => {
    const id = pickString(record, ["id"]);
    const role = pickString(record, ["role"]);
    const createdAt = normalizeIso(pickString(record, ["createdAt"])) ?? (/* @__PURE__ */ new Date()).toISOString();
    if (!id || role !== "user" && role !== "assistant" && role !== "system") {
      return null;
    }
    const sourceType = pickString(record, ["sourceType", "source_type"]);
    if (sourceType === "response_item" && role !== "assistant") {
      return null;
    }
    const images = toImagesFromRolloutRecord(record);
    const eventType = pickString(record, ["eventType"]);
    return {
      id,
      key: makeSessionKey(deviceId, threadId),
      threadId,
      deviceId,
      role,
      content: pickString(record, ["content"]) ?? "",
      createdAt,
      ...typeof pickNumber(record, ["order"]) === "number" ? { timelineOrder: pickNumber(record, ["order"]) ?? void 0 } : {},
      ...images.length > 0 ? { images } : {},
      ...eventType === "reasoning" || eventType === "activity" || eventType === "tool_call" ? { eventType } : {}
    };
  };
  const toImagesFromRolloutRecord = (record) => {
    const rawImages = Array.isArray(record.images) ? record.images : [];
    const seen = /* @__PURE__ */ new Set();
    const images = [];
    for (const rawImage of rawImages) {
      const imageRecord = asRecord(rawImage);
      const url = pickString(imageRecord, ["url"]);
      if (!url || seen.has(url)) {
        continue;
      }
      seen.add(url);
      images.push({
        id: pickString(imageRecord, ["id"]) ?? `image-${images.length + 1}`,
        url,
        mimeType: pickString(imageRecord, ["mimeType", "mime_type"]) ?? void 0,
        fileName: pickString(imageRecord, ["fileName", "filename", "name"]) ?? void 0
      });
    }
    return images;
  };
  const toToolMessageFromRolloutEntry = (deviceId, threadId, entry) => ({
    id: entry.id,
    key: makeSessionKey(deviceId, threadId),
    threadId,
    deviceId,
    role: "tool",
    eventType: "tool_call",
    content: formatRolloutToolMessageContent(entry),
    createdAt: entry.createdAt,
    ...typeof entry.order === "number" ? { timelineOrder: entry.order } : {},
    toolCall: {
      name: entry.name,
      ...entry.input ? { input: entry.input } : {},
      ...entry.output ? { output: entry.output } : {},
      ...entry.status ? { status: entry.status } : {}
    }
  });
  const normalizeToolStatus = (value) => {
    if (!value) {
      return void 0;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized.includes("fail") || normalized.includes("error")) {
      return "failed";
    }
    if (normalized.includes("complete") || normalized.includes("success") || normalized.includes("done")) {
      return "completed";
    }
    if (normalized.includes("run") || normalized.includes("progress") || normalized.includes("pending") || normalized.includes("start")) {
      return "running";
    }
    return void 0;
  };
  const formatRolloutToolMessageContent = (entry) => {
    const parts = [`Tool: ${entry.name}`];
    if (entry.input) {
      parts.push(`Input:
${entry.input}`);
    }
    if (entry.output) {
      parts.push(`Output:
${entry.output}`);
    }
    return parts.join("\n\n");
  };
  const quotePosixShell = (value) => {
    if (value.length === 0) {
      return "''";
    }
    return `'${value.replace(/'/g, `'"'"'`)}'`;
  };
  const buildCompactRolloutPythonScript = () => [
    "import hashlib, json, re, sys",
    "path = sys.argv[1]",
    "tool_entries = {}",
    "message_entries = {}",
    "order_counter = 0",
    "",
    "def fmt_args(value):",
    "    if not isinstance(value, str) or not value.strip():",
    "        return None",
    "    try:",
    "        return json.dumps(json.loads(value), indent=2)",
    "    except Exception:",
    "        return value",
    "",
    "def fmt_output(name, value):",
    "    if value is None:",
    "        return None",
    "    if name == 'view_image':",
    "        return '[image output omitted]'",
    "    text = value if isinstance(value, str) else json.dumps(value)",
    "    try:",
    "        parsed = json.loads(text)",
    "        if isinstance(parsed, dict) and isinstance(parsed.get('output'), str):",
    "            text = parsed['output']",
    "        elif isinstance(parsed, list):",
    "            return '[structured output omitted]'",
    "    except Exception:",
    "        pass",
    "    text = re.sub(r'\\x1b\\[[0-?]*[ -/]*[@-~]', '', text)",
    "    text = text.replace('\\r', '')",
    "    text = re.sub(r'\\n{3,}', '\\n\\n', text).strip()",
    "    return text if len(text) <= 4000 else text[:4000] + '\\n...[truncated]'",
    "",
    "def fmt_search_action(action):",
    "    if not isinstance(action, dict):",
    "        return None",
    "    result = {'type': action.get('type') or 'search'}",
    "    if isinstance(action.get('query'), str) and action['query'].strip():",
    "        result['query'] = action['query']",
    "    if isinstance(action.get('url'), str) and action['url'].strip():",
    "        result['url'] = action['url']",
    "    if isinstance(action.get('pattern'), str) and action['pattern'].strip():",
    "        result['pattern'] = action['pattern']",
    "    queries = [",
    "        entry.strip()",
    "        for entry in (action.get('queries') or [])",
    "        if isinstance(entry, str) and entry.strip()",
    "    ]",
    "    if queries:",
    "        result['queries'] = queries",
    "    return json.dumps(result, indent=2) if result else None",
    "",
    "def extract_text(value):",
    "    if isinstance(value, str):",
    "        return value",
    "    if isinstance(value, list):",
    "        parts = [extract_text(item).strip() for item in value]",
    "        return '\\n'.join(part for part in parts if part)",
    "    if isinstance(value, dict):",
    "        for key in ('text', 'message', 'content', 'output_text', 'input_text', 'summary'):",
    "            if key in value:",
    "                text = extract_text(value.get(key))",
    "                if isinstance(text, str) and text.strip():",
    "                    return text",
    "    return ''",
    "",
    "def normalize_image_url(value):",
    "    if not isinstance(value, str) or not value.strip():",
    "        return None",
    "    text = value.strip()",
    "    if text.startswith('/'):",
    "        return 'file://' + text",
    "    return text",
    "",
    "def add_message(timestamp, role, content, raw_images, event_type=None, source_type=None):",
    "    global order_counter",
    "    if role not in {'user', 'assistant'}:",
    "        return",
    "    text = content if isinstance(content, str) else ''",
    "    text = text if len(text) <= 8000 else text[:8000] + '\\n...[truncated]'",
    "    normalized_images = []",
    "    if isinstance(raw_images, list):",
    "        for raw in raw_images:",
    "            image_url = normalize_image_url(raw)",
    "            if image_url and image_url not in normalized_images:",
    "                normalized_images.append(image_url)",
    "    if not text.strip() and not normalized_images:",
    "        return",
    "    digest = hashlib.sha1(json.dumps({",
    "        'timestamp': timestamp,",
    "        'role': role,",
    "        'content': text,",
    "        'images': normalized_images,",
    "        'eventType': event_type",
    "    }, sort_keys=True).encode('utf-8')).hexdigest()[:16]",
    "    entry = {",
    "        'kind': 'message',",
    "        'id': f'message-{digest}',",
    "        'role': role,",
    "        'content': text,",
    "        'createdAt': timestamp,",
    "        'order': order_counter",
    "    }",
    "    order_counter += 1",
    "    if event_type:",
    "        entry['eventType'] = event_type",
    "    if source_type:",
    "        entry['sourceType'] = source_type",
    "    if normalized_images:",
    "        entry['images'] = [",
    "            {'id': f'image-{index + 1}', 'url': image_url}",
    "            for index, image_url in enumerate(normalized_images)",
    "        ]",
    "    message_entries[entry['id']] = entry",
    "",
    "with open(path, encoding='utf-8') as handle:",
    "    for raw_line in handle:",
    "        try:",
    "            obj = json.loads(raw_line)",
    "        except Exception:",
    "            continue",
    "        payload = obj.get('payload') if isinstance(obj.get('payload'), dict) else None",
    "        if not payload:",
    "            continue",
    "        payload_type = payload.get('type')",
    "        if obj.get('type') == 'event_msg' and payload_type in {'user_message', 'agent_message'}:",
    "            add_message(",
    "                obj.get('timestamp'),",
    "                'user' if payload_type == 'user_message' else 'assistant',",
    "                payload.get('message'),",
    "                (payload.get('images') or []) + (payload.get('local_images') or []),",
    "                None,",
    "                'event_msg'",
    "            )",
    "            continue",
    "        if obj.get('type') == 'response_item' and payload_type == 'message':",
    "            if payload.get('role') != 'assistant':",
    "                continue",
    "            add_message(",
    "                obj.get('timestamp'),",
    "                payload.get('role'),",
    "                extract_text(payload.get('content')),",
    "                [],",
    "                None,",
    "                'response_item'",
    "            )",
    "            continue",
    "        if obj.get('type') == 'response_item' and payload_type == 'reasoning':",
    "            reasoning_text = extract_text(payload.get('summary'))",
    "            if isinstance(reasoning_text, str) and reasoning_text.strip():",
    "                add_message(",
    "                    obj.get('timestamp'),",
    "                    'assistant',",
    "                    reasoning_text,",
    "                    [],",
    "                    'reasoning',",
    "                    'response_item'",
    "                )",
    "            continue",
    "        if payload_type == 'web_search_call':",
    "            search_input = fmt_search_action(payload.get('action'))",
    "            digest_source = json.dumps({",
    "                'timestamp': obj.get('timestamp'),",
    "                'action': payload.get('action')",
    "            }, sort_keys=True, default=str)",
    "            call_id = 'web_search-' + hashlib.sha1(digest_source.encode('utf-8')).hexdigest()[:16]",
    "            tool_entries[call_id] = {",
    "                'id': call_id,",
    "                'kind': 'tool',",
    "                'name': 'web_search',",
    "                'createdAt': obj.get('timestamp'),",
    "                'updatedAt': obj.get('timestamp'),",
    "                'order': order_counter,",
    "                'status': payload.get('status') or 'completed'",
    "            }",
    "            if isinstance(search_input, str) and search_input:",
    "                tool_entries[call_id]['input'] = search_input",
    "            order_counter += 1",
    "            continue",
    "        if payload_type not in {'function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output'}:",
    "            continue",
    "        call_id = payload.get('call_id') or payload.get('callId')",
    "        if not call_id:",
    "            continue",
    "        entry = tool_entries.setdefault(call_id, {",
    "            'id': call_id,",
    "            'kind': 'tool',",
    "            'name': 'tool',",
    "            'createdAt': obj.get('timestamp'),",
    "            'updatedAt': obj.get('timestamp'),",
    "            'order': order_counter",
    "        })",
    "        if entry.get('order') == order_counter:",
    "            order_counter += 1",
    "        if payload_type in {'function_call', 'custom_tool_call'}:",
    "            if isinstance(payload.get('name'), str) and payload['name'].strip():",
    "                entry['name'] = payload['name']",
    "            tool_input = fmt_args(payload.get('arguments')) if payload_type == 'function_call' else payload.get('input')",
    "            if isinstance(tool_input, str) and tool_input:",
    "                entry['input'] = tool_input",
    "            if isinstance(payload.get('status'), str) and payload['status'].strip():",
    "                entry['status'] = payload['status']",
    "        else:",
    "            tool_output = fmt_output(entry.get('name'), payload.get('output'))",
    "            if isinstance(tool_output, str) and tool_output:",
    "                entry['output'] = tool_output",
    "            entry['status'] = 'completed'",
    "            entry['updatedAt'] = obj.get('timestamp')",
    "",
    "timeline = list(message_entries.values()) + list(tool_entries.values())",
    "timeline.sort(key=lambda entry: ((entry.get('createdAt') or ''), int(entry.get('order') or 0)))",
    "if len(timeline) > 300:",
    "    timeline = timeline[-300:]",
    "print(json.dumps(timeline))"
  ].join("\n");
  const callWithFallback = async (client, method, attempts) => {
    let lastError = null;
    for (const params of attempts) {
      try {
        return await client.call(method, params);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`RPC call failed: ${method}`);
  };
  const parseMessagesFromThread = (deviceId, threadId, thread) => {
    if (!thread) {
      return [];
    }
    const threadFallbackCreatedAt = pickTimestampIso(thread) ?? (/* @__PURE__ */ new Date()).toISOString();
    const fromMessages = ensureArray(thread.messages).flatMap(
      (entry) => parseMessageLike(deviceId, threadId, entry, threadFallbackCreatedAt)
    );
    const turns = ensureArray(thread.turns);
    const fromTurns = turns.flatMap((turn) => {
      const turnRecord = asRecord(turn);
      const turnCreatedAt = normalizeIso(
        pickString(turnRecord, ["createdAt", "created_at", "startedAt", "started_at"])
      ) ?? threadFallbackCreatedAt;
      const messages = ensureArray(turnRecord?.messages).flatMap(
        (entry) => parseMessageLike(deviceId, threadId, entry, turnCreatedAt)
      );
      const items = ensureArray(turnRecord?.items).flatMap(
        (item) => parseItemLike(deviceId, threadId, item, turnCreatedAt)
      );
      return [...messages, ...items];
    });
    if (fromTurns.length === 0) {
      return dedupeHistoricalMessages(fromMessages);
    }
    const turnMessageKeys = new Set(
      fromTurns.map((message) => messageIdentityWithoutTimestamp(message))
    );
    const supplementalTopLevelMessages = fromMessages.filter(
      (message) => !turnMessageKeys.has(messageIdentityWithoutTimestamp(message))
    );
    return dedupeHistoricalMessages([...fromTurns, ...supplementalTopLevelMessages]);
  };
  const dedupeHistoricalMessages = (messages) => {
    const deduped = /* @__PURE__ */ new Map();
    for (const message of messages) {
      const key = strictMessageIdentityKey(message);
      const existing = deduped.get(key);
      deduped.set(key, existing ? preferRicherMessage(existing, message) : message);
    }
    return assignMissingTimelineOrder([...deduped.values()]).sort(sortMessagesAscending);
  };
  const strictMessageIdentityKey = (message) => {
    const normalizedTimestamp = normalizeIso(message.createdAt) ?? message.createdAt;
    const imageSignature = (message.images ?? []).map((image) => image.url.trim()).filter((url) => url.length > 0).join("|");
    return [
      message.id,
      message.role,
      message.eventType ?? "",
      normalizedTimestamp,
      imageSignature
    ].join("::");
  };
  const messageIdentityWithoutTimestamp = (message) => [message.id, message.role, message.eventType ?? ""].join("::");
  const preferRicherMessage = (current, incoming) => {
    const currentToolScore = toolCallCompletenessScore(current);
    const incomingToolScore = toolCallCompletenessScore(incoming);
    if (currentToolScore !== incomingToolScore) {
      return incomingToolScore > currentToolScore ? incoming : current;
    }
    const currentImageCount = current.images?.length ?? 0;
    const incomingImageCount = incoming.images?.length ?? 0;
    if (currentImageCount !== incomingImageCount) {
      return incomingImageCount > currentImageCount ? incoming : current;
    }
    return incoming.content.length >= current.content.length ? incoming : current;
  };
  const parseMessageLike = (deviceId, threadId, value, fallbackCreatedAt) => {
    const record = asRecord(value);
    if (!record) {
      return [];
    }
    const role = inferRole(record);
    const payload = extractItemMessagePayload(record, "message/read", role);
    if (!payload) {
      return [];
    }
    const images = extractImageAttachments(record);
    const createdAt = normalizeIso(
      pickString(record, [
        "completedAt",
        "completed_at",
        "updatedAt",
        "updated_at",
        "createdAt",
        "created_at",
        "startedAt",
        "started_at"
      ])
    ) ?? fallbackCreatedAt;
    const baseId = pickString(record, ["id", "messageId", "itemId"]) ?? buildStableMessageId({
      threadId,
      role,
      eventType: payload.eventType,
      method: "message/read",
      createdAt,
      record,
      payload
    });
    return [
      {
        id: toTimelineMessageId({
          baseId,
          eventType: payload.eventType,
          createdAt
        }),
        key: makeSessionKey(deviceId, threadId),
        threadId,
        deviceId,
        role,
        content: payload.content,
        createdAt,
        ...images.length > 0 ? { images } : {},
        ...payload.eventType ? { eventType: payload.eventType } : {},
        ...payload.toolCall ? { toolCall: payload.toolCall } : {}
      }
    ];
  };
  const parseItemLike = (deviceId, threadId, value, fallbackCreatedAt) => {
    const record = asRecord(value);
    if (!record) {
      return [];
    }
    const role = inferRole(record);
    const payload = extractItemMessagePayload(record, "item/read", role);
    if (!payload) {
      return [];
    }
    const images = extractImageAttachments(record);
    const createdAt = normalizeIso(
      pickString(record, [
        "completedAt",
        "completed_at",
        "updatedAt",
        "updated_at",
        "createdAt",
        "created_at",
        "startedAt",
        "started_at"
      ])
    ) ?? fallbackCreatedAt;
    const baseId = pickString(record, ["id", "itemId"]) ?? buildStableMessageId({
      threadId,
      role,
      eventType: payload.eventType,
      method: "item/read",
      createdAt,
      record,
      payload
    });
    return [
      {
        id: toTimelineMessageId({
          baseId,
          eventType: payload.eventType,
          createdAt
        }),
        key: makeSessionKey(deviceId, threadId),
        threadId,
        deviceId,
        role,
        content: payload.content,
        createdAt,
        ...images.length > 0 ? { images } : {},
        ...payload.eventType ? { eventType: payload.eventType } : {},
        ...payload.toolCall ? { toolCall: payload.toolCall } : {}
      }
    ];
  };
  const inferRole = (record) => {
    const role = pickString(record, ["role", "author"]);
    if (role === "user" || role === "assistant" || role === "system" || role === "tool") {
      return role;
    }
    const type = (pickString(record, ["type", "itemType"]) ?? "").toLowerCase();
    if (type.includes("user")) {
      return "user";
    }
    if (type.includes("assistant") || type.includes("agent")) {
      return "assistant";
    }
    if (type.includes("tool")) {
      return "tool";
    }
    return "system";
  };
  const ensureArray = (value) => {
    if (Array.isArray(value)) {
      return value;
    }
    return [];
  };
  const asRecord = (value) => typeof value === "object" && value !== null ? value : null;
  const pickString = (value, keys) => {
    if (!value) {
      return null;
    }
    for (const key of keys) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate;
      }
    }
    return null;
  };
  const pickNumber = (value, keys) => {
    if (!value) {
      return null;
    }
    for (const key of keys) {
      const candidate = value[key];
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return candidate;
      }
      if (typeof candidate === "string") {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return null;
  };
  const normalizeIso = (value) => {
    if (value === null) {
      return null;
    }
    let normalizedValue = value;
    if (typeof normalizedValue === "number") {
      normalizedValue = normalizedValue < 1e12 ? normalizedValue * 1e3 : normalizedValue;
    }
    if (typeof normalizedValue === "string" && normalizedValue.trim().length === 0) {
      return null;
    }
    const date = new Date(normalizedValue);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  };
  const pickTimestampIso = (value, depth = 0) => {
    if (!value || depth > 1) {
      return null;
    }
    const isoDirect = normalizeIso(
      pickString(value, [
        "updatedAt",
        "updated_at",
        "updated",
        "updatedDate",
        "updated_date",
        "lastActivityAt",
        "last_activity_at",
        "lastActiveAt",
        "last_active_at",
        "lastModifiedAt",
        "last_modified_at",
        "lastMessageAt",
        "last_message_at",
        "lastTurnAt",
        "last_turn_at",
        "modifiedAt",
        "modified_at",
        "mtime",
        "createdAt",
        "created_at"
      ])
    );
    if (isoDirect) {
      return isoDirect;
    }
    const isoNumeric = normalizeIso(
      pickNumber(value, [
        "updatedAtMs",
        "updated_at_ms",
        "updatedMs",
        "updated_ms",
        "lastActivityMs",
        "last_activity_ms",
        "lastActiveMs",
        "last_active_ms",
        "lastMessageMs",
        "last_message_ms",
        "lastTurnMs",
        "last_turn_ms",
        "modifiedAtMs",
        "modified_at_ms",
        "mtimeMs",
        "mtime_ms",
        "updatedAt",
        "updated_at",
        "lastActivityAt",
        "last_activity_at",
        "lastMessageAt",
        "last_message_at"
      ])
    );
    if (isoNumeric) {
      return isoNumeric;
    }
    const nestedCandidates = [
      "lastMessage",
      "last_message",
      "latestMessage",
      "latest_message",
      "lastTurn",
      "last_turn",
      "activity",
      "metadata"
    ];
    for (const key of nestedCandidates) {
      const nested = asRecord(value[key]);
      const nestedTimestamp = pickTimestampIso(nested, depth + 1);
      if (nestedTimestamp) {
        return nestedTimestamp;
      }
    }
    return null;
  };
  const pickSummaryPreview = (value) => truncateForPreview(
    pickString(value, [
      "preview",
      "lastMessage",
      "last_message",
      "snippet",
      "summary"
    ]) ?? ""
  );
  const deriveSessionBaseTitle = (value, threadId, preview) => {
    const candidate = pickString(value, [
      "title",
      "name",
      "summary",
      "firstUserMessage",
      "first_user_message",
      "firstPrompt",
      "first_prompt"
    ]) ?? preview;
    const normalized = truncateForTitle(candidate.trim());
    if (normalized.length === 0) {
      return threadId;
    }
    if (normalized.toLowerCase() === "thread" || normalized.startsWith("Thread ")) {
      return threadId;
    }
    return normalized;
  };
  const pickThreadModel = (value, depth = 0) => {
    if (!value || depth > 2) {
      return null;
    }
    const direct = pickString(value, ["model", "modelId", "model_id", "modelName", "model_name"]);
    if (direct) {
      return direct;
    }
    const nestedCandidates = [
      "config",
      "settings",
      "metadata",
      "modelInfo",
      "model_info",
      "turn",
      "lastTurn",
      "last_turn",
      "latestMessage",
      "latest_message"
    ];
    for (const key of nestedCandidates) {
      const nested = asRecord(value[key]);
      const nestedModel = pickThreadModel(nested, depth + 1);
      if (nestedModel) {
        return nestedModel;
      }
    }
    return null;
  };
  const truncateForPreview = (value) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= 180) {
      return normalized;
    }
    return `${normalized.slice(0, 177)}...`;
  };
  const truncateForTitle = (value) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= 120) {
      return normalized;
    }
    return `${normalized.slice(0, 117)}...`;
  };
  const formatSessionTitle = (baseTitle, threadId) => `${baseTitle || threadId} (${threadId})`;
  const folderNameFromPath = (value) => {
    if (!value) {
      return null;
    }
    const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!normalized) {
      return null;
    }
    const segments = normalized.split("/");
    return segments[segments.length - 1] || null;
  };
  const deviceAddress = (device) => {
    if (device.config.kind === "ssh") {
      return `${device.config.user}@${device.config.host}:${device.config.sshPort}`;
    }
    return "127.0.0.1";
  };
  const asErrorMessage = (error) => error instanceof Error ? error.message : "Unknown error";
  const workerScope = globalThis;
  const postWorkerMessage = (message) => {
    workerScope.postMessage(message);
  };
  const readThreadBase = async (request) => {
    const { device, requestId, threadId, skipMessages } = request;
    try {
      const payload = await readThread(device, threadId, {
        includeRolloutMessages: false,
        skipMessages
      });
      postWorkerMessage({
        type: "thread-base-read",
        requestId,
        payload
      });
    } catch (error) {
      postWorkerMessage({
        type: "thread-read-error",
        requestId,
        sessionKey: makeSessionKey(device.id, threadId),
        error: toErrorMessage(error)
      });
    }
  };
  const readThreadRollout = async (request) => {
    const { device, requestId, threadId, rolloutPath, revision } = request;
    try {
      const messages = await readRolloutTimelineMessages(
        device,
        threadId,
        rolloutPath,
        revision
      );
      postWorkerMessage({
        type: "thread-rollout-read",
        requestId,
        payload: {
          sessionKey: makeSessionKey(device.id, threadId),
          threadId,
          deviceId: device.id,
          messages,
          ...revision ? { revision } : {},
          rolloutPath
        }
      });
    } catch (error) {
      postWorkerMessage({
        type: "thread-read-error",
        requestId,
        sessionKey: makeSessionKey(device.id, threadId),
        error: toErrorMessage(error)
      });
    }
  };
  workerScope.onmessage = (event) => {
    const request = event.data;
    if (!request) {
      return;
    }
    switch (request.type) {
      case "read-thread-base": {
        void readThreadBase(request);
        return;
      }
      case "read-thread-rollout": {
        void readThreadRollout(request);
        return;
      }
      case "close-device": {
        closeDeviceClient(request.deviceId);
        return;
      }
      case "shutdown": {
        closeAllClients();
        return;
      }
      default: {
        return;
      }
    }
  };
  const toErrorMessage = (error) => {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  };
})();
