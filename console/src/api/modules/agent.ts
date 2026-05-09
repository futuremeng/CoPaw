import { request } from "../request";
import type { AgentRequest, AgentsRunningConfig } from "../types";

type NlpStrategyPayload = {
  mode?: "auto" | "manual" | "hybrid";
  default_model_id?: string;
  task_overrides?: Record<string, string>;
  auto_classical_chinese?: {
    enabled?: boolean;
    threshold?: number;
    model_id?: string;
  };
};

type NlpStrategyDecisionPayload = {
  task_key: string;
  strategy_mode: string;
  detected_style: string;
  detection_score: number;
  selected_model: string;
  matched_rules: string[];
  fallback_used: boolean;
};

// Agent API
export const agentApi = {
  agentRoot: () => request<unknown>("/agent/"),

  healthCheck: () => request<unknown>("/agent/health"),

  agentApi: (body: AgentRequest) =>
    request<unknown>("/agent/process", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getProcessStatus: () => request<unknown>("/agent/admin/status"),

  shutdownSimple: () =>
    request<void>("/agent/shutdown", {
      method: "POST",
    }),

  shutdown: () =>
    request<void>("/agent/admin/shutdown", {
      method: "POST",
    }),

  getAgentRunningConfig: () =>
    request<AgentsRunningConfig>("/agent/running-config"),

  updateAgentRunningConfig: (config: AgentsRunningConfig) =>
    request<AgentsRunningConfig>("/agent/running-config", {
      method: "PUT",
      body: JSON.stringify(config),
    }),

  getAgentLanguage: () => request<{ language: string }>("/agent/language"),

  updateAgentLanguage: (language: string) =>
    request<{ language: string; copied_files: string[] }>("/agent/language", {
      method: "PUT",
      body: JSON.stringify({ language }),
    }),

  getAudioMode: () => request<{ audio_mode: string }>("/agent/audio-mode"),

  updateAudioMode: (audio_mode: string) =>
    request<{ audio_mode: string }>("/agent/audio-mode", {
      method: "PUT",
      body: JSON.stringify({ audio_mode }),
    }),

  getTranscriptionProviders: () =>
    request<{
      providers: { id: string; name: string; available: boolean }[];
      configured_provider_id: string;
    }>("/agent/transcription-providers"),

  updateTranscriptionProvider: (provider_id: string) =>
    request<{ provider_id: string }>("/agent/transcription-provider", {
      method: "PUT",
      body: JSON.stringify({ provider_id }),
    }),

  getTranscriptionProviderType: () =>
    request<{ transcription_provider_type: string }>(
      "/agent/transcription-provider-type",
    ),

  updateTranscriptionProviderType: (transcription_provider_type: string) =>
    request<{ transcription_provider_type: string }>(
      "/agent/transcription-provider-type",
      {
        method: "PUT",
        body: JSON.stringify({ transcription_provider_type }),
      },
    ),

  getLocalWhisperStatus: () =>
    request<{
      available: boolean;
      ffmpeg_installed: boolean;
      whisper_installed: boolean;
    }>("/agent/local-whisper-status"),

  installLocalWhisper: () =>
    request<{
      success: boolean;
      already_available: boolean;
      status_before: {
        available: boolean;
        ffmpeg_installed: boolean;
        whisper_installed: boolean;
      };
      status_after: {
        available: boolean;
        ffmpeg_installed: boolean;
        whisper_installed: boolean;
      };
      operations: {
        name: string;
        attempted: boolean;
        installer: string | null;
        command: string;
        ok: boolean;
        output: string;
        returncode: number | null;
      }[];
      manual_steps: string[];
    }>("/agent/local-whisper-install", {
      method: "POST",
    }),

  getNlpStatus: () =>
    request<{
      provider: string;
      strategy?: {
        mode?: string;
        default_model_id?: string;
        task_overrides?: Record<string, string>;
        auto_classical_chinese?: {
          enabled?: boolean;
          threshold?: number;
          model_id?: string;
        };
      };
      sidecar: {
        status: string;
        reason_code: string;
        reason: string;
        enabled: boolean;
        python_executable: string;
        python_version?: string;
        managed: boolean;
        uv_available: boolean;
        uv_executable: string;
        model_home: string;
        model_cache_path?: string;
      };
      model: {
        status: string;
        reason_code: string;
        reason: string;
        model_id: string;
      };
      preload?: {
        enabled: boolean;
        scope: "critical" | "all_enabled_tasks";
        status: string;
        reason: string;
        model_cache_path?: string;
        started_at?: number | null;
        finished_at?: number | null;
        preloaded_models?: Array<{
          task_key: string;
          model_id: string;
          status: string;
        }>;
        task_results?: Record<string, {
          status: string;
          reason_code?: string;
          reason?: string;
          model_id?: string;
        }>;
      };
      deprecated?: boolean;
      migration?: {
        message?: string;
        target_endpoint?: string;
      };
    }>("/sidecar/nlp-status"),

  getNlpLocalModelsStatus: () =>
    request<{
      provider?: string;
      engine: string;
      status: string;
      reason_code: string;
      reason: string;
      python_version?: string;
      require_local_models: boolean;
      hanlp_home?: string;
      model_cache_path?: string;
      items: Array<{
        scope: string;
        task_key: string;
        task_name: string;
        model_id: string;
        local_available: boolean;
      }>;
    }>("/sidecar/nlp-local-models"),

    downloadMissingNlpLocalModels: () =>
      request<{
        provider?: string;
        success: boolean;
        requested: string[];
        attempts: Array<{
          model_id: string;
          status: string;
          reason_code: string;
          reason: string;
        }>;
        before: {
          status: string;
          reason_code: string;
          missing_count: number;
        };
        after: {
          status: string;
          reason_code: string;
          missing_count: number;
        };
        remaining: Array<{
          scope: string;
          task_key: string;
          task_name: string;
          model_id: string;
          local_available: boolean;
        }>;
        model_cache_path?: string;
      }>("/sidecar/nlp-local-models/download-missing", {
        method: "POST",
        body: JSON.stringify({}),
      }),

  updateNlpStrategy: (strategy: NlpStrategyPayload) =>
    request<{
      strategy: NlpStrategyPayload;
    }>("/agent/nlp-strategy", {
      method: "PUT",
      body: JSON.stringify(strategy),
    }),

  dryRunNlpStrategy: (payload: { text: string; task_key: string }) =>
    request<{
      decision: NlpStrategyDecisionPayload;
      strategy: NlpStrategyPayload;
    }>("/agent/nlp-strategy/dry-run", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateNlpPreload: (payload: {
    enabled: boolean;
    scope: "critical" | "all_enabled_tasks";
  }) =>
    request<{
      preload: {
        enabled: boolean;
        scope: "critical" | "all_enabled_tasks";
        status: string;
        reason: string;
      };
    }>("/agent/nlp-preload", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  triggerNlpPreload: (payload?: { force?: boolean }) =>
    request<{
      preload: {
        enabled: boolean;
        scope: "critical" | "all_enabled_tasks";
        status: string;
        reason: string;
      };
    }>("/agent/nlp-preload", {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    }),

  getHanlpStatus: () =>
    request<{
      sidecar: {
        status: string;
        reason_code: string;
        reason: string;
        enabled: boolean;
        python_executable: string;
        managed: boolean;
        uv_available: boolean;
        uv_executable: string;
        model_home?: string;
        hanlp_home?: string;
        model_cache_path?: string;
      };
      model: {
        status: string;
        reason_code: string;
        reason: string;
        model_id: string;
      };
      deprecated?: boolean;
      migration?: {
        message?: string;
        target_endpoint?: string;
      };
    }>("/agent/hanlp-status"),

  installHanlp: () =>
    request<{
      success: boolean;
      already_available: boolean;
      status_before: {
        sidecar: { status: string };
        model: { status: string };
      };
      status_after: {
        sidecar: { status: string };
        model: { status: string };
      };
      operations: {
        name: string;
        attempted: boolean;
        installer: string | null;
        command: string;
        ok: boolean;
        output: string;
        returncode: number | null;
      }[];
      manual_steps: string[];
    }>("/agent/hanlp-install", {
      method: "POST",
    }),

  downloadHanlpModel: () =>
    request<{
      success: boolean;
      status_before: {
        sidecar: { status: string };
        model: { status: string };
      };
      status_after: {
        sidecar: { status: string };
        model: { status: string };
      };
      model_result: {
        status: string;
        reason_code: string;
        reason: string;
        model_id: string;
      };
      manual_steps: string[];
    }>("/agent/hanlp-download-model", {
      method: "POST",
    }),
};
