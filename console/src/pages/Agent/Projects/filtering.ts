import type { ProjectKnowledgeFilterKey } from "./metrics";

export type FileMetricFilterKey =
  | "original"
  | "intermediate"
  | "artifact"
  | "agent"
  | "skill"
  | "flow"
  | "case"
  | "builtin";
export type ProjectFileFilterKey = FileMetricFilterKey | ProjectKnowledgeFilterKey;

export interface FilterLabelDescriptor {
  i18nKey: string;
  defaultLabel: string;
}

export function toggleProjectFileFilter(
  current: ProjectFileFilterKey | "",
  next: ProjectFileFilterKey,
): ProjectFileFilterKey | "" {
  return current === next ? "" : next;
}

export function getProjectFilterLabelDescriptor(
  filter: ProjectFileFilterKey,
): FilterLabelDescriptor {
  switch (filter) {
    case "original":
      return { i18nKey: "projects.filesOriginal", defaultLabel: "Original Files" };
    case "intermediate":
      return { i18nKey: "projects.filesIntermediate", defaultLabel: "Intermediate Files" };
    case "artifact":
      return { i18nKey: "projects.filesArtifact", defaultLabel: "Artifact Files" };
    case "agent":
      return { i18nKey: "projects.filesAgent", defaultLabel: "智能体" };
    case "skill":
      return { i18nKey: "projects.filesSkill", defaultLabel: "技能" };
    case "flow":
      return { i18nKey: "projects.filesFlow", defaultLabel: "流程" };
    case "case":
      return { i18nKey: "projects.filesCase", defaultLabel: "案例" };
    case "builtin":
      return { i18nKey: "projects.filesBuiltIn", defaultLabel: "Built-in Files" };
    case "markdown":
      return { i18nKey: "projects.quantMarkdownFiles", defaultLabel: "Markdown" };
    case "text":
      return { i18nKey: "projects.quantTextFiles", defaultLabel: "文本文件" };
    case "script":
      return { i18nKey: "projects.quantScriptFiles", defaultLabel: "脚本 (.py)" };
    case "otherType":
      return { i18nKey: "projects.quantOtherTypeFiles", defaultLabel: "其他类型" };
    default:
      return { i18nKey: "projects.files", defaultLabel: "Files" };
  }
}
