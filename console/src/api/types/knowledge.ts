export type KnowledgeSourceType =
  | "file"
  | "directory"
  | "url"
  | "text"
  | "chat";

export interface KnowledgeSourceSpec {
  id: string;
  name: string;
  type: KnowledgeSourceType;
  location: string;
  content: string;
  enabled: boolean;
  recursive: boolean;
  project_id?: string;
  tags: string[];
  summary: string;
}

export interface KnowledgeIndexConfig {
  engine: string;
  chunk_size: number;
  chunk_overlap: number;
  max_file_size: number;
  include_globs: string[];
  exclude_globs: string[];
  updated_at?: string | null;
}

export type ProjectKnowledgeProcessingMode = "fast" | "nlp" | "agentic";

export interface ProjectKnowledgeProcessingModeStatePayload {
  mode: ProjectKnowledgeProcessingMode;
  status: "idle" | "queued" | "running" | "ready" | "failed";
  available: boolean;
  progress?: number | null;
  stage: string;
  summary: string;
  last_updated_at?: string;
  run_id?: string;
  job_id?: string;
  document_count?: number;
  chunk_count?: number;
  entity_count?: number;
  relation_count?: number;
  quality_score?: number | null;
}

export interface ProjectKnowledgeOutputResolutionPayload {
  active_mode: ProjectKnowledgeProcessingMode;
  available_modes: ProjectKnowledgeProcessingMode[];
  fallback_chain: ProjectKnowledgeProcessingMode[];
  reason: string;
}

export interface ProjectKnowledgeProcessingSchedulerPayload {
  strategy: "parallel";
  mode_order: ProjectKnowledgeProcessingMode[];
  running_modes: ProjectKnowledgeProcessingMode[];
  queued_modes: ProjectKnowledgeProcessingMode[];
  ready_modes: ProjectKnowledgeProcessingMode[];
  failed_modes: ProjectKnowledgeProcessingMode[];
  next_mode?: ProjectKnowledgeProcessingMode | null;
  consumption_mode: ProjectKnowledgeProcessingMode;
  reason: string;
}

export interface ProjectKnowledgeModeArtifactPayload {
  kind: string;
  label: string;
  path: string;
}

export interface ProjectKnowledgeModeOutputPayload {
  mode: ProjectKnowledgeProcessingMode;
  source: string;
  summary_lines: string[];
  artifacts: ProjectKnowledgeModeArtifactPayload[];
}

export interface ProjectKnowledgeSyncState {
  project_id: string;
  task_type?: string;
  status:
    | "idle"
    | "queued"
    | "pending"
    | "indexing"
    | "graphifying"
    | "succeeded"
    | "failed";
  current_stage: string;
  stage?: string;
  stage_message?: string;
  progress: number;
  percent?: number;
  current?: number;
  total?: number;
  eta_seconds?: number | null;
  auto_enabled: boolean;
  dirty: boolean;
  dirty_after_run: boolean;
  last_trigger: string;
  changed_paths: string[];
  pending_changed_paths: string[];
  changed_count: number;
  scheduled_for?: string | null;
  queued_at?: string | null;
  last_change_at?: string | null;
  debounce_seconds?: number;
  cooldown_seconds?: number;
  last_error: string;
  last_started_at?: string | null;
  last_finished_at?: string | null;
  last_success_at?: string | null;
  updated_at?: string | null;
  latest_job_id: string;
  latest_workflow_run_id?: string;
  latest_source_id: string;
  last_result: Record<string, unknown>;
  processing_modes?: ProjectKnowledgeProcessingModeStatePayload[];
  active_output_resolution?: ProjectKnowledgeOutputResolutionPayload;
  processing_scheduler?: ProjectKnowledgeProcessingSchedulerPayload;
  mode_outputs?: Partial<Record<ProjectKnowledgeProcessingMode, ProjectKnowledgeModeOutputPayload>>;
}

export interface ProjectKnowledgeSyncRunRequest {
  projectId: string;
  trigger?: string;
  changedPaths?: string[];
  force?: boolean;
}

export interface ProjectKnowledgeSyncRunResponse {
  accepted: boolean;
  reason: string;
  state: ProjectKnowledgeSyncState;
}

export interface KnowledgeAutomationConfig {
  knowledge_auto_collect_chat_files: boolean;
  knowledge_auto_collect_chat_urls: boolean;
  knowledge_auto_collect_long_text: boolean;
  knowledge_long_text_min_chars: number;
}

export interface KnowledgeConfig {
  version: number;
  enabled: boolean;
  sources: KnowledgeSourceSpec[];
  index: KnowledgeIndexConfig;
  automation: KnowledgeAutomationConfig;
  memify_enabled?: boolean;
}

export interface KnowledgeSourceStatus {
  indexed: boolean;
  indexed_at: string | null;
  document_count: number;
  chunk_count: number;
  sentence_count?: number;
  needs_reindex?: boolean;
  error: string | null;
  remote_status?: string;
  remote_cache_state?: string;
  remote_fail_count?: number;
  remote_next_retry_at?: string | null;
  remote_last_error?: string | null;
  remote_updated_at?: string | null;
}

export interface KnowledgeSourceItem extends KnowledgeSourceSpec {
  subject?: string;
  keywords?: string[];
  status: KnowledgeSourceStatus;
}

export interface KnowledgeSourcesResponse {
  enabled: boolean;
  sources: KnowledgeSourceItem[];
}

export interface KnowledgeIndexResult {
  source_id: string;
  document_count: number;
  chunk_count: number;
  sentence_count?: number;
  indexed_at: string;
}

export interface KnowledgeBulkIndexResult {
  indexed_sources: number;
  results: KnowledgeIndexResult[];
}

export interface KnowledgeSearchHit {
  source_id: string;
  source_name: string;
  source_type: KnowledgeSourceType;
  document_path: string;
  document_title: string;
  score: number;
  snippet: string;
}

export interface KnowledgeSearchResponse {
  query: string;
  hits: KnowledgeSearchHit[];
}

export interface KnowledgeHistoryBackfillStatus {
  has_backfill_record: boolean;
  backfill_completed: boolean;
  marked_unbackfilled: boolean;
  history_chat_count: number;
  has_pending_history: boolean;
  progress?: KnowledgeHistoryBackfillProgress;
}

export interface KnowledgeHistoryBackfillProgress {
  task_type?: string;
  running: boolean;
  completed: boolean;
  failed: boolean;
  stage?: string;
  current_stage?: string;
  stage_message?: string;
  progress?: number;
  percent?: number;
  current?: number;
  total?: number;
  eta_seconds?: number | null;
  total_sessions: number;
  traversed_sessions: number;
  processed_sessions: number;
  current_session_id?: string | null;
  error?: string | null;
  updated_at?: string | null;
  reason?: string | null;
}

export interface KnowledgeHistoryBackfillRunResponse {
  result: {
    changed: boolean;
    skipped: boolean;
    reason?: string;
    processed_sessions?: number;
    file_sources?: number;
    url_sources?: number;
    text_sources?: number;
  };
  status: KnowledgeHistoryBackfillStatus;
}

export interface KnowledgeSourceDocument {
  path: string;
  title: string;
  text: string;
}

export interface KnowledgeSourceContent {
  indexed: boolean;
  indexed_at?: string | null;
  document_count?: number;
  chunk_count?: number;
  sentence_count?: number;
  documents: KnowledgeSourceDocument[];
}

export interface KnowledgeClearResponse {
  cleared: boolean;
  cleared_indexes: number;
  cleared_sources: number;
  removed_source_configs: boolean;
}

/**
 * Graph query record from graph knowledge engine.
 * Compatible with Graphify/Cognee graph records.
 */
export interface GraphQueryRecord {
  subject: string;
  predicate: string;
  object: string;
  score: number;
  source_id: string;
  source_type: string;
  document_path: string;
  document_title: string;
}

/**
 * Graph provenance metadata (engine, dataset scope, etc.)
 */
export type GraphProvenance = Record<string, unknown>;

/**
 * Response from graph query operation.
 */
export interface GraphQueryResponse {
  records: GraphQueryRecord[];
  summary: string;
  provenance: GraphProvenance;
  warnings: string[];
}

/**
 * Graph visualization data model.
 * Used to convert query records into node/edge structure for rendering.
 */
export interface GraphNode {
  id: string;
  label: string;
  title: string;
  type: string;
  score: number;
  source_id: string;
  document_path: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  confidence?: string;
}

export interface GraphVisualizationData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  summary: string;
  provenance: GraphProvenance;
}

export interface MemifyStartRequest {
  pipeline_type?: string;
  dataset_scope?: string[];
  idempotency_key?: string;
  dry_run?: boolean;
  project_id?: string;
}

export interface MemifyStartResponse {
  accepted: boolean;
  job_id: string;
  estimated_steps?: number;
  status_url: string;
  reason?: string;
}

export interface QualityLoopStartRequest {
  max_rounds?: number;
  dry_run?: boolean;
  dataset_scope?: string[];
  project_id?: string;
}

export interface QualityLoopStartResponse {
  accepted: boolean;
  job_id: string;
  status_url: string;
  estimated_rounds?: number;
  reason?: string;
}

export interface QualityLoopJobStatus {
  job_id: string;
  task_type?: string;
  status: string;
  stage?: string;
  current_stage?: string;
  stage_message?: string;
  progress?: number;
  percent?: number;
  current?: number;
  total?: number;
  updated_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  stop_reason?: string;
  score_before?: number | null;
  score_after?: number | null;
  delta?: number | null;
  rounds?: Array<Record<string, unknown>>;
  warnings?: string[];
  error?: string | null;
}

export interface QualityLoopJobsListResponse {
  items: QualityLoopJobStatus[];
  count: number;
}

export interface MemifyJobStatus {
  job_id: string;
  task_type?: string;
  pipeline_type: string;
  dataset_scope: string[];
  idempotency_key: string;
  dry_run: boolean;
  status: "pending" | "running" | "succeeded" | "failed";
  progress: number;
  percent?: number;
  stage?: string;
  current_stage?: string;
  stage_message?: string;
  current?: number;
  total?: number;
  eta_seconds?: number | null;
  estimated_steps: number;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  warnings: string[];
  engine: string;
  updated_at?: string | null;
  sentence_count?: number;
  sentence_with_entities_count?: number;
  entity_mentions_count?: number;
  avg_entities_per_sentence?: number;
  avg_entity_char_ratio?: number;
}

export interface KnowledgeTaskProgress {
  task_id: string;
  task_type?: string;
  job_id?: string;
  status: string;
  stage?: string;
  current_stage?: string;
  stage_message?: string;
  progress?: number;
  percent?: number;
  current?: number;
  total?: number;
  eta_seconds?: number | null;
  updated_at?: string | null;
  warnings?: string[];
  error?: string | null;
  document_count?: number;
  chunk_count?: number;
  sentence_count?: number;
  sentence_with_entities_count?: number;
  entity_mentions_count?: number;
  avg_entities_per_sentence?: number;
  avg_entity_char_ratio?: number;
  node_count?: number;
  relation_count?: number;
  enrichment_metrics?: {
    edge_count?: number;
    node_count?: number;
    relation_normalized_count?: number;
    entity_canonicalized_count?: number;
    low_confidence_edges?: number;
    missing_evidence_edges?: number;
    [key: string]: unknown;
  };
}

export interface KnowledgeTasksSnapshot {
  tasks: KnowledgeTaskProgress[];
  updated_at?: string | null;
  project_id?: string;
}

export interface KnowledgeRestoreResponse {
  success: boolean;
  replace_existing: boolean;
  restored_sources: number;
}