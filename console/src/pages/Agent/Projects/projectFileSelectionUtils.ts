export function isPreviewablePath(path: string): boolean {
  if (!path) {
    return false;
  }
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  for (let index = 0; index < segments.length - 1; index += 1) {
    if ((segments[index] || "").startsWith(".")) {
      return false;
    }
  }
  return true;
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
  const unique = Array.from(new Set(paths.map((item) => item.trim()).filter(Boolean)));
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
