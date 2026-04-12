// Multi-agent management types
export interface ProjectArtifactItem {
  id: string;
  name: string;
  kind: "skill" | "script" | "flow" | "case";
  origin: string;
  status: string;
  version: string;
  artifact_file_path?: string;
  version_history?: Array<{
    version: string;
    file_path?: string;
    note?: string;
  }>;
  tags: string[];
  derived_from_ids: string[];
  distillation_note: string;
  market_source_id?: string | null;
  market_item_id?: string | null;
}

export interface ProjectArtifactProfile {
  skills: ProjectArtifactItem[];
  scripts: ProjectArtifactItem[];
  flows: ProjectArtifactItem[];
  cases: ProjectArtifactItem[];
}

export interface AgentProjectSummary {
  id: string;
  name: string;
  description: string;
  status: string;
  workspace_dir: string;
  data_dir: string;
  metadata_file: string;
  tags: string[];
  artifact_distill_mode: "file_scan" | "conversation_evidence";
  artifact_profile: ProjectArtifactProfile;
  project_auto_knowledge_sink: boolean;
  preferred_workspace_chat_id?: string;
  updated_time: string;
}

export interface UpdateProjectWorkspaceChatBindingRequest {
  preferred_workspace_chat_id: string;
}

export interface UpdateProjectKnowledgeSinkRequest {
  project_auto_knowledge_sink: boolean;
}

export interface AgentProjectFileInfo {
  filename: string;
  path: string;
  size: number;
  modified_time: string;
}

export interface AgentProjectFileTreeNode {
  filename: string;
  path: string;
  size: number;
  modified_time: string;
  is_directory: boolean;
  child_count: number;
  descendant_file_count: number;
}

export interface AgentProjectFileSummary {
  total_files: number;
  builtin_files: number;
  visible_files: number;
  original_files: number;
  derived_files: number;
  knowledge_candidate_files: number;
  markdown_files: number;
  text_like_files: number;
  recently_updated_files: number;
}

export interface AgentProjectFileContent {
  content: string;
}

export interface CloneProjectRequest {
  target_id?: string;
  target_name?: string;
  include_pipeline_runs?: boolean;
}

export interface CreateProjectRequest {
  id?: string;
  name: string;
  description?: string;
  status?: string;
  data_dir?: string;
  tags?: string[];
  project_auto_knowledge_sink?: boolean;
  artifact_profile?: ProjectArtifactProfile;
}

export interface DeleteProjectResponse {
  success: boolean;
  project_id: string;
}

export interface PromoteProjectArtifactRequest {
  target_name?: string;
  overwrite?: boolean;
  enable?: boolean;
}

export interface PromoteProjectArtifactResponse {
  promoted: boolean;
  artifact_kind: string;
  artifact_id: string;
  target_name: string;
  target_path: string;
  project: AgentProjectSummary;
}

export interface UpdateProjectArtifactDistillModeRequest {
  artifact_distill_mode: "file_scan" | "conversation_evidence";
}

export interface DistillProjectSkillsDraftResponse {
  drafted_count: number;
  skipped_count: number;
  drafted_ids: string[];
  artifact_distill_mode: "file_scan" | "conversation_evidence";
  project: AgentProjectSummary;
}

export interface AutoDistillProjectSkillsDraftRequest {
  run_id?: string;
}

export interface ConfirmProjectSkillStableResponse {
  confirmed: boolean;
  artifact_id: string;
  status: string;
  project: AgentProjectSummary;
}

export interface ProjectPipelineTemplateStep {
  id: string;
  name: string;
  kind: string;
  description: string;
  inputs?: Record<string, unknown>;
  prompt?: string;
  script?: string;
  outputs?: Record<string, unknown>;
  depends_on?: string[];
  input_bindings?: Record<string, string>;
  retry_policy?: Record<string, unknown>;
}

export interface PipelineValidationError {
  error_code: string;
  message: string;
  field_path: string;
  step_id: string;
  expected: string;
  actual: string;
  suggestion: string;
}

export interface AgentPipelineDraftInfo {
  md_path: string;
  md_relative_path: string;
  flow_memory_path: string;
  flow_memory_relative_path: string;
  md_mtime: number;
  revision: number;
  content_hash: string;
  validation_errors: PipelineValidationError[];
  compilation_status: string;
  steps: ProjectPipelineTemplateStep[];
}

export interface ProjectPipelineTemplateInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  steps: ProjectPipelineTemplateStep[];
  revision?: number;
  content_hash?: string;
  md_mtime?: number;
  validation_errors?: PipelineValidationError[];
  compilation_status?: string;
}

export interface PlatformFlowTemplateInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  steps: ProjectPipelineTemplateStep[];
  revision?: number;
  content_hash?: string;
  md_mtime?: number;
  validation_errors?: PipelineValidationError[];
  compilation_status?: string;
  tags: string[];
  source_project_id?: string | null;
  source_project_template_id?: string | null;
  source_project_template_version?: string | null;
}

export interface ProjectFlowInstanceInfo extends ProjectPipelineTemplateInfo {
  project_id: string;
  source_platform_template_id?: string | null;
  source_platform_template_version?: string | null;
}

export interface ImportPlatformTemplateRequest {
  platform_template_id: string;
  target_template_id?: string;
}

export interface PublishProjectTemplateRequest {
  platform_template_id?: string;
  bump?: "major" | "minor" | "patch";
  tags?: string[];
}

export interface PlatformTemplateVersionRecord {
  template_id: string;
  version: string;
  published_at: string;
  source_project_id?: string | null;
  source_project_template_id?: string | null;
  source_project_template_version?: string | null;
  bump: string;
}

export interface PipelineSaveStreamEvent {
  event: string;
  agent_id: string;
  pipeline_id: string;
  payload: Record<string, unknown>;
}

export interface ProjectPipelineRunSummary {
  id: string;
  template_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  focus_chat_id?: string | null;
  focus_type?: string | null;
  focus_path?: string | null;
}

export interface ProjectPipelineRunStep {
  id: string;
  name: string;
  kind: string;
  description: string;
  inputs: Record<string, unknown>;
  prompt: string;
  script: string;
  outputs: Record<string, unknown>;
  depends_on: string[];
  input_bindings: Record<string, string>;
  retry_policy: Record<string, unknown>;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  metrics: Record<string, unknown>;
  evidence: string[];
}

export interface ProjectPipelineCollaborationEvent {
  ts: string;
  event: string;
  step_id: string;
  role: string;
  actor: string;
  status: string;
  message: string;
  evidence: string[];
  metrics: Record<string, unknown>;
}

export interface ProjectPipelineArtifactRecord {
  artifact_id: string;
  path: string;
  name: string;
  kind: string;
  format: string;
  human_readable: boolean;
  run_id: string;
  producer_step_id?: string | null;
  producer_step_name?: string | null;
  consumer_step_ids: string[];
  consumer_step_names: string[];
  created_at: string;
}

export interface ProjectPipelineNextAction {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  target_step_id?: string | null;
  suggested_prompt: string;
}

export interface ProjectPipelineConvergence {
  stage: string;
  score: number;
  passed_checks: number;
  total_checks: number;
  blocking_issues: string[];
  highlights: string[];
}

export interface ProjectPipelineRunDetail extends ProjectPipelineRunSummary {
  project_id: string;
  parameters: Record<string, unknown>;
  steps: ProjectPipelineRunStep[];
  artifacts: string[];
  artifact_records: ProjectPipelineArtifactRecord[];
  flow_version: string;
  source_platform_template_id?: string | null;
  source_platform_template_version?: string | null;
  collaboration_events: ProjectPipelineCollaborationEvent[];
  convergence: ProjectPipelineConvergence;
  next_actions: ProjectPipelineNextAction[];
}

export interface CreateProjectPipelineRunRequest {
  template_id: string;
  parameters?: Record<string, unknown>;
}

export interface RetryProjectPipelineRunRequest {
  step_id?: string;
  note?: string;
}

export interface AgentsSquareSourceSpec {
  id: string;
  name: string;
  type: string;
  provider: string;
  url: string;
  branch: string;
  path: string;
  enabled: boolean;
  order: number;
  trust: string;
  license_hint: string;
  pinned: boolean;
}

export interface AgentsSquareSourcesPayload {
  version: number;
  cache: {
    ttl_sec: number;
  };
  install: {
    overwrite_default: boolean;
    preserve_workspace_files: boolean;
  };
  sources: AgentsSquareSourceSpec[];
}

export interface ValidateSquareSourceResponse {
  ok: boolean;
  normalized: AgentsSquareSourceSpec;
  warnings: string[];
}

export interface AgentSquareItem {
  source_id: string;
  agent_id: string;
  name: string;
  description: string;
  version: string;
  license: string;
  source_url: string;
  install_url: string;
  tags: string[];
  extra: Record<string, string>;
}

export interface AgentSquareSourceError {
  source_id: string;
  code: string;
  message: string;
  retryable: boolean;
}

export interface AgentSquareItemsResponse {
  items: AgentSquareItem[];
  source_errors: AgentSquareSourceError[];
  meta: {
    source_count?: number;
    item_count?: number;
    cache_hit?: boolean;
    [key: string]: unknown;
  };
}

export interface ImportAgentSquareRequest {
  source_id: string;
  agent_id: string;
  overwrite?: boolean;
  enable?: boolean;
  preferred_name?: string;
}

export interface ImportAgentSquareResponse {
  imported: boolean;
  id: string;
  name: string;
  workspace_dir: string;
  source: Record<string, string>;
}

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  workspace_dir: string;
  enabled: boolean;
  project_count?: number;
  projects?: AgentProjectSummary[];
}

export interface AgentListResponse {
  agents: AgentSummary[];
}

export interface ReorderAgentsResponse {
  success: boolean;
  agent_ids: string[];
}

export interface AgentProfileConfig {
  id: string;
  name: string;
  description?: string;
  workspace_dir?: string;
  channels?: unknown;
  mcp?: unknown;
  heartbeat?: unknown;
  running?: unknown;
  llm_routing?: unknown;
  system_prompt_files?: string[];
  tools?: unknown;
  security?: unknown;
}

export interface CreateAgentRequest {
  name: string;
  description?: string;
  workspace_dir?: string;
  language?: string;
  skill_names?: string[];
}

export interface AgentProfileRef {
  id: string;
  workspace_dir: string;
}
