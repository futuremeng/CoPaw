import type { ProjectKnowledgeFilterKey } from "./metrics";

export type FileMetricFilterKey = "original" | "derived" | "skills" | "scripts" | "flows" | "cases" | "builtin";
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
    case "derived":
      return { i18nKey: "projects.filesDerived", defaultLabel: "Derived Files" };
    case "skills":
      return { i18nKey: "projects.artifacts.skill", defaultLabel: "Skills" };
    case "scripts":
      return { i18nKey: "projects.artifacts.script", defaultLabel: "Scripts" };
    case "flows":
      return { i18nKey: "projects.artifacts.flow", defaultLabel: "Flows" };
    case "cases":
      return { i18nKey: "projects.artifacts.case", defaultLabel: "Cases" };
    case "builtin":
      return { i18nKey: "projects.filesBuiltIn", defaultLabel: "Built-in Files" };
    case "knowledgeCandidates":
      return { i18nKey: "projects.quantKnowledgeCandidates", defaultLabel: "Knowledge Candidates" };
    case "markdown":
      return { i18nKey: "projects.quantMarkdownFiles", defaultLabel: "Markdown Files" };
    case "textLike":
      return { i18nKey: "projects.quantTextLikeFiles", defaultLabel: "Text-like Files" };
    case "recent":
      return { i18nKey: "projects.quantRecentlyUpdated", defaultLabel: "Updated in 7d" };
    default:
      return { i18nKey: "projects.files", defaultLabel: "Files" };
  }
}
