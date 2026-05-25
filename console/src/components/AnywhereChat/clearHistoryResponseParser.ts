import {
  payloadCompletesResponse,
  payloadRequestsHistoryClear,
} from "./clearHistoryParser";

export function createClearHistoryResponseParser(options: {
  markPendingClearHistory: () => void;
  clearHistoryWhenCompleted: () => void;
}) {
  return (chunk: string): Record<string, unknown> => {
    const payload = JSON.parse(chunk) as Record<string, unknown>;

    if (payloadRequestsHistoryClear(payload)) {
      options.markPendingClearHistory();
      if (payloadCompletesResponse(payload)) {
        options.clearHistoryWhenCompleted();
      }
    }

    return payload;
  };
}
