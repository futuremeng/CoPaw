const BUILT_IN_FILE_NAMES = new Set([
  "agents.md",
  "project.md",
  "plan.md",
  "heartbeat.md",
]);

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

  const fileName = segments[segments.length - 1] || "";
  if (BUILT_IN_FILE_NAMES.has(fileName)) {
    return true;
  }

  if (segments.length === 1 && fileName.startsWith(".")) {
    return true;
  }

  for (let index = 0; index < segments.length - 1; index += 1) {
    if ((segments[index] || "").startsWith(".")) {
      return true;
    }
  }

  return false;
}
