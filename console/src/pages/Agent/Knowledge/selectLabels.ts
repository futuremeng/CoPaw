import type { TFunction } from "i18next";
import type { KnowledgeSourceType } from "../../../api/types/knowledge";

export type KnowledgeScopeFilter = "combined" | "agent" | "project";
export type GraphSortField = "score" | "subject" | "title";
export type GraphSortOrder = "descend" | "ascend";

type LabeledOption<Value extends string> = {
  label: string;
  value: Value;
};

// Each builder takes the render-time `t` rather than closing over a module-level
// one, so a language switch re-renders these labels instead of freezing them at
// import time (the shape knife 78 hit with descriptor `defaultLabel` fields).
export function sourceTypeOptions(
  t: TFunction,
): Array<LabeledOption<KnowledgeSourceType>> {
  return [
    { label: t("knowledge.sourceType.file"), value: "file" },
    { label: t("knowledge.sourceType.directory"), value: "directory" },
    { label: t("knowledge.sourceType.url"), value: "url" },
    { label: t("knowledge.sourceType.text"), value: "text" },
    { label: t("knowledge.sourceType.chat"), value: "chat" },
  ];
}

export function knowledgeScopeOptions(
  t: TFunction,
): Array<LabeledOption<KnowledgeScopeFilter>> {
  return [
    { label: t("knowledge.graphQuery.scopeCombined"), value: "combined" },
    { label: t("knowledge.graphQuery.scopeAgent"), value: "agent" },
    { label: t("knowledge.graphQuery.scopeProject"), value: "project" },
  ];
}

export function graphSortFieldOptions(
  t: TFunction,
): Array<LabeledOption<GraphSortField>> {
  return [
    { label: t("knowledge.graphQuery.score"), value: "score" },
    { label: t("knowledge.graphQuery.subject"), value: "subject" },
    { label: t("knowledge.graphQuery.documentTitle"), value: "title" },
  ];
}

export function graphSortOrderOptions(
  t: TFunction,
): Array<LabeledOption<GraphSortOrder>> {
  return [
    { label: t("knowledge.graphQuery.sortDescending"), value: "descend" },
    { label: t("knowledge.graphQuery.sortAscending"), value: "ascend" },
  ];
}

export function weightLegendLabels(
  t: TFunction,
): Record<"low" | "mid" | "high", string> {
  return {
    low: t("knowledge.graphQuery.weightLow"),
    mid: t("knowledge.graphQuery.weightMid"),
    high: t("knowledge.graphQuery.weightHigh"),
  };
}
