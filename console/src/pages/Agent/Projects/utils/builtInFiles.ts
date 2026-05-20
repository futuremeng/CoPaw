function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isBuiltInProjectFile(path: string): boolean {
  const normalized = normalizeProjectPath(path);
  const lowered = normalized.toLowerCase();
  const segments = lowered.split("/").filter(Boolean);
  if (segments.length === 0) {
    return false;
  }

  for (let index = 0; index < segments.length - 1; index += 1) {
    if ((segments[index] || "").startsWith(".")) {
      return true;
    }
  }

  return false;
}
