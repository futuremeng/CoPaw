import type {
  ActiveModelsInfo,
  AgentsRunningConfig,
  ProviderInfo,
} from "../api/types";

export type PipelineExecutionBudget = {
  profile: "default" | "local-balanced" | "local-constrained";
  maxAutoOperations: number;
  maxParseRetryCount: number;
  maxPromptSteps: number;
  maxUserRequirementChars: number;
  maxTokens?: number;
  maxInputLength?: number;
  modelId?: string;
  providerId?: string;
};

type PipelineExecutionBudgetInput = {
  providers?: ProviderInfo[];
  activeModels?: ActiveModelsInfo | null;
  runningConfig?: AgentsRunningConfig | null;
};

const DEFAULT_BUDGET: PipelineExecutionBudget = {
  profile: "default",
  maxAutoOperations: 6,
  maxParseRetryCount: 1,
  maxPromptSteps: 16,
  maxUserRequirementChars: 2400,
};

function extractModelSizeB(modelId: string): number | null {
  const match = modelId.match(/(\d+(?:\.\d+)?)\s*b\b/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractMaxTokens(provider?: ProviderInfo): number | undefined {
  const raw = provider?.generate_kwargs?.max_tokens;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function isLikelyLocalProvider(provider?: ProviderInfo): boolean {
  if (!provider) return false;
  if (provider.is_local) return true;

  const combined = `${provider.id} ${provider.name} ${provider.base_url}`.toLowerCase();
  return /(ollama|lmstudio|llama|mlx|127\.0\.0\.1|localhost)/.test(combined);
}

export function getDefaultPipelineExecutionBudget(): PipelineExecutionBudget {
  return { ...DEFAULT_BUDGET };
}

export function derivePipelineExecutionBudget(
  input: PipelineExecutionBudgetInput,
): PipelineExecutionBudget {
  const activeProviderId = input.activeModels?.active_llm?.provider_id;
  const activeModelId = input.activeModels?.active_llm?.model;
  const provider = input.providers?.find((item) => item.id === activeProviderId);
  const maxTokens = extractMaxTokens(provider);
  const maxInputLength = input.runningConfig?.max_input_length;
  const modelSizeB = activeModelId ? extractModelSizeB(activeModelId) : null;
  const localProvider = isLikelyLocalProvider(provider);

  let score = 0;
  if (localProvider) score += 2;
  if ((modelSizeB ?? 0) >= 20) score += 2;
  else if ((modelSizeB ?? 0) >= 7) score += 1;
  if ((maxTokens ?? 0) >= 4096) score += 1;
  else if ((maxTokens ?? 0) >= 3000) score += 1;
  const combinedBudget = (maxInputLength ?? 0) + (maxTokens ?? 0);
  if (combinedBudget >= 32000) score += 2;
  else if (combinedBudget >= 24000) score += 1;

  if (score >= 5) {
    return {
      profile: "local-constrained",
      maxAutoOperations: 4,
      maxParseRetryCount: 1,
      maxPromptSteps: 12,
      maxUserRequirementChars: 1600,
      maxTokens,
      maxInputLength,
      modelId: activeModelId,
      providerId: activeProviderId,
    };
  }

  if (score >= 3) {
    return {
      profile: "local-balanced",
      maxAutoOperations: 5,
      maxParseRetryCount: 1,
      maxPromptSteps: 14,
      maxUserRequirementChars: 2000,
      maxTokens,
      maxInputLength,
      modelId: activeModelId,
      providerId: activeProviderId,
    };
  }

  return {
    ...DEFAULT_BUDGET,
    maxTokens,
    maxInputLength,
    modelId: activeModelId,
    providerId: activeProviderId,
  };
}