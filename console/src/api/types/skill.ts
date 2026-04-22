export type SkillSyncStatus =
  | "-"
  | "synced"
  | "outdated"
  | "not_synced"
  | "conflict";

export interface SkillSpec {
  name: string;
  description?: string;
  version_text?: string;
  content: string;
  source: string;
  path?: string;
  enabled?: boolean;
  channels?: string[];
  tags?: string[];
  config?: Record<string, unknown>;
  last_updated?: string;
  emoji?: string;
}

export interface PoolSkillSpec {
  name: string;
  description?: string;
  version_text?: string;
  content: string;
  source: string;
  protected: boolean;
  commit_text?: string;
  sync_status?: SkillSyncStatus | "";
  latest_version_text?: string;
  builtin_language?: string;
  available_builtin_languages?: string[];
  tags?: string[];
  config?: Record<string, unknown>;
  last_updated?: string;
  emoji?: string;
}

export interface BuiltinLanguageSpec {
  language: string;
  description?: string;
  version_text?: string;
  source_name?: string;
  status?: "missing" | "current" | "outdated" | "conflict" | string;
}

export interface WorkspaceSkillSummary {
  agent_id: string;
  agent_name?: string;
  workspace_dir: string;
  skills: SkillSpec[];
}

export interface BuiltinImportSpec {
  name: string;
  description?: string;
  version_text?: string;
  current_version_text?: string;
  current_source?: string;
  current_language?: string;
  available_languages?: string[];
  languages?: Record<string, BuiltinLanguageSpec>;
  status?: "missing" | "current" | "outdated" | "conflict" | string;
}

export interface BuiltinRemovedSpec {
  name: string;
  description?: string;
  current_version_text?: string;
  current_source?: string;
}

export interface BuiltinUpdateNotice {
  fingerprint: string;
  has_updates: boolean;
  total_changes: number;
  actionable_skill_names: string[];
  added: BuiltinImportSpec[];
  missing: BuiltinImportSpec[];
  updated: BuiltinImportSpec[];
  removed: BuiltinRemovedSpec[];
}

export interface HubSkillSpec {
  slug: string;
  name: string;
  description?: string;
  version?: string;
  source_url?: string;
}

export interface HubInstallTaskResponse {
  task_id: string;
  bundle_url: string;
  version: string;
  enable: boolean;
  status: "pending" | "importing" | "completed" | "failed" | "cancelled";
  error: string | null;
  result: {
    installed?: boolean;
    name?: string;
    enabled?: boolean;
    source_url?: string;
    conflicts?: Array<{
      reason?: string;
      skill_name?: string;
      suggested_name?: string;
    }>;
    [key: string]: unknown;
  } | null;
  created_at: number;
  updated_at: number;
}

export interface SkillsMarketSpec {
  id: string;
  name: string;
  url: string;
  branch?: string;
  path: string;
  enabled: boolean;
  order: number;
  trust?: "official" | "community" | "custom" | null;
}

export interface SkillsMarketsPayload {
  version: number;
  cache: {
    ttl_sec: number;
  };
  install: {
    overwrite_default: boolean;
  };
  markets: SkillsMarketSpec[];
}

export interface ValidateMarketResponse {
  ok: boolean;
  normalized: SkillsMarketSpec;
  warnings: string[];
}

export interface MarketError {
  market_id: string;
  code: string;
  message: string;
  retryable: boolean;
}

export interface MarketplaceItem {
  market_id: string;
  skill_id: string;
  name: string;
  description: string;
  version: string;
  source_url: string;
  install_url: string;
  tags: string[];
}

export interface MarketplaceMeta {
  enabled_market_count: number;
  success_market_count: number;
  item_count: number;
}

export interface MarketplaceResponse {
  items: MarketplaceItem[];
  market_errors: MarketError[];
  meta: MarketplaceMeta;
}

export interface InstallMarketplacePayload {
  market_id: string;
  skill_id: string;
  enable?: boolean;
  overwrite?: boolean;
}

export interface InstallSkillResult {
  installed: boolean;
  name: string;
  enabled: boolean;
  source_url: string;
}
