export interface FlowStepDefinition {
  id: string;
  name: string;
  kind: string;
  executor: string;
  description: string;
  depends_on: string[];
  retry_policy: Record<string, unknown>;
}

export interface FlowDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  steps: FlowStepDefinition[];
  tags: string[];
  system_owned: boolean;
  created_at: string;
  updated_at: string;
}

export interface FlowRunRecord {
  id: string;
  agent_id: string;
  definition_id: string;
  scope_kind: string;
  scope_id: string;
  status: string;
  priority: number;
  idempotency_key: string;
  current_step_id: string;
  created_at: string;
  updated_at: string;
}

export interface FlowEventRecord {
  id: string;
  agent_id: string;
  run_id: string;
  event_type: string;
  status: string;
  step_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface FlowCommandRecord {
  id: string;
  agent_id: string;
  run_id: string;
  command_type: string;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface FlowRunTimeline {
  run: FlowRunRecord;
  events: FlowEventRecord[];
  commands: FlowCommandRecord[];
}

export interface FlowRunCreateRequest {
  definition_id: string;
  scope_kind: string;
  scope_id: string;
  priority?: number;
  idempotency_key?: string;
}

export interface FlowCommandRequest {
  command_type: "pause" | "resume" | "cancel";
  payload?: Record<string, unknown>;
}

export interface FlowCommandResponse {
  command: FlowCommandRecord;
  run: FlowRunRecord;
}