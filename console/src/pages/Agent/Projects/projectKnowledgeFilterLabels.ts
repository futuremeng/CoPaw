type TranslateFn = (key: string, defaultValue: string) => string;

const ENTITY_TYPE_LABELS: Record<string, [string, string]> = {
  document: ["projects.knowledge.graphEntityType.document", "Document"],
  entity: ["projects.knowledge.graphEntityType.entity", "Entity"],
  path: ["projects.knowledge.graphEntityType.path", "Path"],
  version: ["projects.knowledge.graphEntityType.version", "Version"],
  snapshot: ["projects.knowledge.graphEntityType.snapshot", "Snapshot"],
};

const RELATION_TYPE_LABELS: Record<string, [string, string]> = {
  mentions: ["projects.knowledge.graphRelationType.mentions", "Mentions"],
  co_occurs_with: ["projects.knowledge.graphRelationType.co_occurs_with", "Co-occurs with"],
};

function humanizeGraphFilterValue(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatGraphEntityTypeLabel(value: string, t: TranslateFn): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  const labelConfig = ENTITY_TYPE_LABELS[normalized];
  if (labelConfig) {
    return t(labelConfig[0], labelConfig[1]);
  }
  return humanizeGraphFilterValue(normalized);
}

export function formatGraphRelationTypeLabel(value: string, t: TranslateFn): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  const labelConfig = RELATION_TYPE_LABELS[normalized];
  if (labelConfig) {
    return t(labelConfig[0], labelConfig[1]);
  }
  return humanizeGraphFilterValue(normalized);
}