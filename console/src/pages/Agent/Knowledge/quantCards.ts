import {
  buildKnowledgeQuantCardModels,
  getKnowledgeQuantActionDescriptor,
  type KnowledgeQuantActionKey,
  type KnowledgeQuantMetrics,
} from "./metrics";

export interface KnowledgeQuantCardActionViewModel {
  labelI18nKey: string;
  defaultLabel: string;
  onClick: () => void;
  loading: boolean;
}

export interface KnowledgeQuantCardViewModel {
  key: string;
  labelI18nKey: string;
  defaultLabel: string;
  value: string | number;
  assessment: { tone: "neutral" | "positive" | "warning"; status: "healthy" | "attention" | "neutral" };
  reason: { key: string; params?: Record<string, number | string>; defaultLabel?: string };
  action?: KnowledgeQuantCardActionViewModel;
}

export interface BuildKnowledgeQuantCardViewModelsInput {
  metrics: KnowledgeQuantMetrics;
  handlers: Record<KnowledgeQuantActionKey, () => void>;
  loading: Record<KnowledgeQuantActionKey, boolean>;
}

export function buildKnowledgeQuantCardViewModels(
  input: BuildKnowledgeQuantCardViewModelsInput,
): KnowledgeQuantCardViewModel[] {
  return buildKnowledgeQuantCardModels(input.metrics).map((item) => {
    const actionKey = item.actionKey;
    const actionDescriptor = actionKey
      ? getKnowledgeQuantActionDescriptor(actionKey)
      : undefined;

    return {
      ...item,
      action: actionDescriptor
        ? {
            labelI18nKey: actionDescriptor.labelI18nKey,
            defaultLabel: actionDescriptor.defaultLabel,
            onClick: input.handlers[actionDescriptor.key],
            loading: input.loading[actionDescriptor.key],
          }
        : undefined,
    };
  });
}
