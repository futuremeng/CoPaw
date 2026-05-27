import { request } from "../request";
import type {
  FlowCommandRequest,
  FlowCommandResponse,
  FlowDefinition,
  FlowRunCreateRequest,
  FlowRunRecord,
  FlowRunTimeline,
} from "../types";

export const flowsApi = {
  listFlowDefinitions: () => request<FlowDefinition[]>("/flows/definitions"),

  listFlowRuns: (params?: { scopeKind?: string; scopeId?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.scopeKind) {
      searchParams.set("scope_kind", params.scopeKind);
    }
    if (params?.scopeId) {
      searchParams.set("scope_id", params.scopeId);
    }
    const query = searchParams.toString();
    return request<FlowRunRecord[]>(`/flows/runs${query ? `?${query}` : ""}`);
  },

  createFlowRun: (payload: FlowRunCreateRequest) =>
    request<FlowRunRecord>("/flows/runs", {
      method: "POST",
      body: JSON.stringify({
        definition_id: payload.definition_id,
        scope_kind: payload.scope_kind,
        scope_id: payload.scope_id,
        priority: payload.priority ?? 100,
        idempotency_key: payload.idempotency_key ?? "",
      }),
    }),

  getFlowRun: (runId: string) =>
    request<FlowRunTimeline>(`/flows/runs/${encodeURIComponent(runId)}`),

  commandFlowRun: (runId: string, payload: FlowCommandRequest) =>
    request<FlowCommandResponse>(`/flows/runs/${encodeURIComponent(runId)}/commands`, {
      method: "POST",
      body: JSON.stringify({
        command_type: payload.command_type,
        payload: payload.payload ?? {},
      }),
    }),
};