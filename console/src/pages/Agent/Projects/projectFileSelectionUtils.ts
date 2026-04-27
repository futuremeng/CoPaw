import { isBuiltInProjectFile } from "./builtInFiles";
import type { AgentProjectFileTreeNode } from "../../../api/types/agents";

export function isPreviewablePath(path: string): boolean {
  return Boolean(path);
}

export function pickPreviewablePathFromTreeNodes(
  nodes: AgentProjectFileTreeNode[],
): string {
  return nodes.find((item) => !item.is_directory && isPreviewablePath(item.path))?.path || "";
}

export function resolveArtifactSelectionPath(
  path: string,
  nodes?: AgentProjectFileTreeNode[] | null,
): {
  selectedPath: string;
  expandedDirectoryPath: string | null;
} {
  if (!path) {
    return {
      selectedPath: "",
      expandedDirectoryPath: null,
    };
  }

  if (Array.isArray(nodes)) {
    const previewableChildPath = pickPreviewablePathFromTreeNodes(nodes);
    if (previewableChildPath) {
      return {
        selectedPath: previewableChildPath,
        expandedDirectoryPath: path,
      };
    }
    return {
      selectedPath: "",
      expandedDirectoryPath: path,
    };
  }

  return {
    selectedPath: path,
    expandedDirectoryPath: null,
  };
}

export function isIgnoredProjectFile(path: string): boolean {
  if (!path) {
    return false;
  }
  const normalized = path.replace(/\\/g, "/");
  const fileName = (normalized.split("/").pop() || "").toLowerCase();
  return [".ds_store", ".gitkeep", "thumbs.db"].includes(fileName);
}

function isTextSourcePath(path: string): boolean {
  const normalized = path.toLowerCase();
  return (
    normalized.endsWith(".md") ||
    normalized.endsWith(".markdown") ||
    normalized.endsWith(".mdx") ||
    normalized.endsWith(".txt")
  );
}

export function selectSeedSourceFiles(paths: string[]): string[] {
  const unique = Array.from(
    new Set(
      paths
        .map((item) => item.trim())
        .filter((item) => item && !isBuiltInProjectFile(item)),
    ),
  );
  const textFiles = unique.filter((item) => isTextSourcePath(item));
  const fallback = textFiles.length > 0 ? textFiles : unique;
  const prioritized = [...fallback].sort((a, b) => {
    const aPriority = a.includes("/data/") || a.includes("/raw/") ? 0 : 1;
    const bPriority = b.includes("/data/") || b.includes("/raw/") ? 0 : 1;
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }
    return a.localeCompare(b);
  });
  return prioritized.slice(0, 4);
}
