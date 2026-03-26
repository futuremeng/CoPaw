import { describe, expect, it } from "vitest";
import {
  derivePipelineExecutionBudget,
  getDefaultPipelineExecutionBudget,
} from "./pipelineModelBudget";

describe("pipelineModelBudget", () => {
  it("falls back to default budget when model metadata is unavailable", () => {
    const budget = derivePipelineExecutionBudget({});

    expect(budget).toEqual(getDefaultPipelineExecutionBudget());
  });

  it("detects constrained local large-model profile", () => {
    const budget = derivePipelineExecutionBudget({
      providers: [
        {
          id: "ollama",
          name: "Ollama",
          api_key_prefix: "",
          chat_model: "qwen3.5:27b",
          models: [],
          extra_models: [],
          is_custom: false,
          is_local: true,
          support_model_discovery: true,
          support_connection_check: true,
          freeze_url: false,
          require_api_key: false,
          api_key: "",
          base_url: "http://127.0.0.1:11434",
          generate_kwargs: { max_tokens: 4096 },
        },
      ],
      activeModels: {
        active_llm: {
          provider_id: "ollama",
          model: "qwen3.5:27b",
        },
      },
      runningConfig: {
        max_iters: 50,
        llm_retry_enabled: true,
        llm_max_retries: 2,
        llm_backoff_base: 1,
        llm_backoff_cap: 8,
        max_input_length: 30000,
        memory_compact_ratio: 0.8,
        memory_reserve_ratio: 0.9,
        tool_result_compact_recent_n: 4,
        tool_result_compact_old_threshold: 1200,
        tool_result_compact_recent_threshold: 2400,
        tool_result_compact_retention_days: 7,
        knowledge_enabled: true,
        knowledge_auto_collect_chat_files: true,
        knowledge_auto_collect_chat_urls: true,
        knowledge_auto_collect_long_text: true,
        knowledge_long_text_min_chars: 500,
        knowledge_chunk_size: 1000,
      },
    });

    expect(budget.profile).toBe("local-constrained");
    expect(budget.maxAutoOperations).toBe(4);
    expect(budget.maxUserRequirementChars).toBe(1600);
  });

  it("keeps a looser budget for non-local or lighter setups", () => {
    const budget = derivePipelineExecutionBudget({
      providers: [
        {
          id: "cloud",
          name: "Cloud",
          api_key_prefix: "sk-",
          chat_model: "gpt-4.1",
          models: [],
          extra_models: [],
          is_custom: false,
          is_local: false,
          support_model_discovery: true,
          support_connection_check: true,
          freeze_url: false,
          require_api_key: true,
          api_key: "",
          base_url: "https://api.example.com/v1",
          generate_kwargs: { max_tokens: 2048 },
        },
      ],
      activeModels: {
        active_llm: {
          provider_id: "cloud",
          model: "gpt-4.1",
        },
      },
      runningConfig: {
        max_iters: 50,
        llm_retry_enabled: true,
        llm_max_retries: 2,
        llm_backoff_base: 1,
        llm_backoff_cap: 8,
        max_input_length: 12000,
        memory_compact_ratio: 0.8,
        memory_reserve_ratio: 0.9,
        tool_result_compact_recent_n: 4,
        tool_result_compact_old_threshold: 1200,
        tool_result_compact_recent_threshold: 2400,
        tool_result_compact_retention_days: 7,
        knowledge_enabled: true,
        knowledge_auto_collect_chat_files: true,
        knowledge_auto_collect_chat_urls: true,
        knowledge_auto_collect_long_text: true,
        knowledge_long_text_min_chars: 500,
        knowledge_chunk_size: 1000,
      },
    });

    expect(budget.profile).toBe("default");
    expect(budget.maxAutoOperations).toBe(6);
  });
});