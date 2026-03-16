export interface AgentRequest {
  input: unknown;
  session_id?: string | null;
  user_id?: string | null;
  channel?: string | null;
  [key: string]: unknown;
}

export interface AgentsRunningConfig {
  max_iters: number;
  max_input_length: number;
  memory_compact_ratio: number;
  memory_reserve_ratio: number;
  enable_tool_result_compact: boolean;
  tool_result_compact_keep_n: number;
  auto_collect_chat_files: boolean;
  auto_collect_chat_urls: boolean;
  auto_collect_long_text: boolean;
  long_text_min_chars: number;
  knowledge_chunk_size: number;
  knowledge_maintenance_llm_yield_seconds: number;
  knowledge_title_regen_adaptive_active_window_seconds: number;
  knowledge_title_regen_adaptive_burst_window_seconds: number;
  knowledge_title_regen_adaptive_active_multiplier: number;
  knowledge_title_regen_adaptive_burst_multiplier: number;
  knowledge_title_regen_prompt: string;
  auto_backfill_history_data: boolean;
}
