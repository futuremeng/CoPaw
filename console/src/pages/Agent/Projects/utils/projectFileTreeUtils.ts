/**
 * Pure utility functions for project file tree.
 * These have no React/JSX dependency and can be tested in isolation.
 */

export function normalizeTreeKeys(keys: string[]): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const normalized = String(key || "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
}

export function compareTreePathDepth(left: string, right: string): number {
  const leftDepth = left.split("/").filter(Boolean).length;
  const rightDepth = right.split("/").filter(Boolean).length;
  if (leftDepth !== rightDepth) {
    return leftDepth - rightDepth;
  }
  return left.localeCompare(right);
}

export function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

export function isOriginalInputFile(path: string): boolean {
  const normalized = normalizeProjectPath(path);
  return normalized === "original" || normalized.startsWith("original/");
}

export function isPathInStandardDir(
  path: string,
  dir: "original" | "intermediate" | "output",
): boolean {
  const normalized = normalizeProjectPath(path);
  return normalized === dir || normalized.startsWith(`${dir}/`);
}

export function isIntermediateFile(path: string): boolean {
  const normalized = normalizeProjectPath(path);
  return (
    isPathInStandardDir(path, "intermediate")
    || normalized.startsWith("metadata/")
    || normalized.startsWith("cross-book/")
    || normalized.startsWith("term-candidates/")
    || normalized.startsWith("review/")
  );
}

export function isArtifactFile(path: string): boolean {
  return isPathInStandardDir(path, "output");
}

export type ProjectFileStage = "original" | "intermediate" | "artifact" | "other";

export function resolveProjectFileStage(
  file: { path: string; stage?: string },
): ProjectFileStage {
  if (file.stage === "original" || file.stage === "intermediate" || file.stage === "artifact") {
    return file.stage;
  }
  if (isOriginalInputFile(file.path)) {
    return "original";
  }
  if (isIntermediateFile(file.path)) {
    return "intermediate";
  }
  if (isArtifactFile(file.path)) {
    return "artifact";
  }
  return "other";
}

export function isAgentProjectFile(path: string): boolean {
  return normalizeProjectPath(path).startsWith(".agent/");
}

export function isStandardTreeRootDir(dir: string): boolean {
  return [
    "original",
    "intermediate",
    "output",
    ".pipelines",
    ".skills",
    ".scripts",
    "metadata",
  ].includes(dir);
}

export function matchesProjectPathQuery(
  path: string,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) {
    return true;
  }
  const normalizedPath = normalizeProjectPath(path);
  const fileName = normalizedPath.split("/").pop() || "";
  return normalizedPath.includes(normalizedQuery) || fileName.includes(normalizedQuery);
}

export function collectDirectoryKeys(
  nodes: { key: string; children?: { key: string; children?: unknown[] }[] }[],
): string[] {
  const keys: string[] = [];
  const walk = (items: { key: string; children?: unknown[] }[]) => {
    for (const item of items) {
      if (item.children && item.children.length > 0) {
        keys.push(item.key);
        walk(item.children as { key: string; children?: unknown[] }[]);
      }
    }
  };
  walk(nodes);
  return keys;
}

export function resolveRangePaths(
  paths: string[],
  anchorPath: string,
  targetPath: string,
): string[] {
  const anchorIndex = paths.indexOf(anchorPath);
  const targetIndex = paths.indexOf(targetPath);
  if (anchorIndex < 0 || targetIndex < 0) {
    return [targetPath];
  }
  const [start, end] = anchorIndex <= targetIndex
    ? [anchorIndex, targetIndex]
    : [targetIndex, anchorIndex];
  return paths.slice(start, end + 1);
}
