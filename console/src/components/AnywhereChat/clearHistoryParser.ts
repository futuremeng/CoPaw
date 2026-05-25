export function messageRequestsHistoryClear(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }

  const metadata = (message as Record<string, unknown>).metadata;
  if (!metadata || typeof metadata !== "object") {
    return false;
  }

  const meta = metadata as Record<string, unknown>;
  if (meta.clear_history === true) {
    return true;
  }

  const nested = meta.metadata;
  return (
    !!nested
    && typeof nested === "object"
    && (nested as Record<string, unknown>).clear_history === true
  );
}

export function payloadRequestsHistoryClear(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  const candidates: unknown[] = [];

  if (record.object === "message") {
    candidates.push(record);
  }

  if (record.object === "response" && Array.isArray(record.output)) {
    candidates.push(...record.output);
  }

  return candidates.some(messageRequestsHistoryClear);
}

export function payloadCompletesResponse(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return record.object === "response" && record.status === "completed";
}
