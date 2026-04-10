export const PATH_CONTEXT_PREFIX = "Path context:";

export function buildPathContextLine(pathSummary: string): string {
  return `${PATH_CONTEXT_PREFIX} ${pathSummary}`;
}

export function appendUniqueContextLine(
  prevQuery: string,
  contextLine: string,
): string {
  const exists = prevQuery
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .includes(contextLine);
  if (exists) {
    return prevQuery;
  }
  return prevQuery.trim() ? `${prevQuery}\n${contextLine}` : contextLine;
}