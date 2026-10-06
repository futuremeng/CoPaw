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
      return { i18nKey: "projects.filesOriginal" };
    case "intermediate":
      return { i18nKey: "projects.filesIntermediate" };
    case "artifact":
      return { i18nKey: "projects.filesArtifact" };
    case "agent":
      return { i18nKey: "projects.filesAgent" };
    case "skill":
      return { i18nKey: "projects.filesSkill" };
    case "flow":
      return { i18nKey: "projects.filesFlow" };
    case "case":
      return { i18nKey: "projects.filesCase" };
    case "builtin":
      return { i18nKey: "projects.filesBuiltIn" };
    case "markdown":
      return { i18nKey: "projects.quantMarkdownFiles" };
    case "text":
      return { i18nKey: "projects.quantTextFiles" };
    case "script":
      return { i18nKey: "projects.quantScriptFiles" };
    case "otherType":
      return { i18nKey: "projects.quantOtherTypeFiles" };
    default:
      return { i18nKey: "projects.files" };
  }
}
