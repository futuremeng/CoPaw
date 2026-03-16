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
  tags: string[];
  description: string;
}

export interface KnowledgeIndexConfig {
  chunk_size: number;
  chunk_overlap: number;
  max_file_size: number;
  include_globs: string[];
  exclude_globs: string[];
}

export interface KnowledgeAutomationConfig {
  auto_collect_chat_files: boolean;
  auto_collect_chat_urls: boolean;
  auto_collect_long_text: boolean;
  long_text_min_chars: number;
}

export interface KnowledgeConfig {
  version: number;
  enabled: boolean;
  sources: KnowledgeSourceSpec[];
  index: KnowledgeIndexConfig;
  automation: KnowledgeAutomationConfig;
}

export interface KnowledgeSourceStatus {
  indexed: boolean;
  indexed_at: string | null;
  document_count: number;
  chunk_count: number;
  error: string | null;
  remote_status?: string;
  remote_cache_state?: string;
  remote_fail_count?: number;
  remote_next_retry_at?: string | null;
  remote_last_error?: string | null;
  remote_updated_at?: string | null;
}

export interface KnowledgeSourceItem extends KnowledgeSourceSpec {
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

export interface KnowledgeRegenerateTitlesResponse {
  queued: boolean;
  force_clear?: boolean;
  restarted?: boolean;
  cleared_jobs?: number;
  cleared_job_ids?: string[];
  job: {
    job_id: string;
    status: string;
    priority: string;
    use_llm: boolean;
    enabled_only: boolean;
    batch_size: number;
    source_ids?: string[];
    cursor?: number;
    total: number;
    processed: number;
    updated: number;
    updated_at?: string;
    yield_interval_seconds?: number;
    effective_yield_seconds?: number;
    yield_mode?: string;
    yield_reason?: string;
    dispatch_age_seconds?: number | null;
    current_source_id?: string | null;
    last_processed_source_id?: string | null;
    yielding_until?: string | null;
    last_item_duration_ms?: number | null;
    avg_item_duration_ms?: number | null;
    timing_samples?: number;
  };
}

export interface KnowledgeRegenerateTitlesQueueStatus {
  has_active_job: boolean;
  active_job: KnowledgeRegenerateTitlesResponse["job"] | null;
  queued_jobs: number;
  running_jobs: number;
  last_completed_job: KnowledgeRegenerateTitlesResponse["job"] | null;
  updated_at?: string;
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
  documents: KnowledgeSourceDocument[];
}