import { humanizeFlowKey } from "./viewModel.ts";

export function formatPipelineDateTime(value?: string): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function getCanonicalStageLabel(key: string): string {
  switch (key) {
    case "snapshot_raw":
      return "Snapshot Raw";
    case "build_chunks":
      return "Build Chunks";
    case "build_interlinear":
      return "Build Interlinear";
    case "tokenize":
      return "Tokenize";
    case "pos_tagging":
      return "POS Tagging";
    case "syntax_parse":
      return "Syntax Parse";
    case "semantic_role_labeling":
      return "Semantic Role Labeling";
    default:
      return humanizeFlowKey(key);
  }
}