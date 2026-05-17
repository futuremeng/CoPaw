type TranslateFn = (key: string, defaultValue: string) => string;

const ENTITY_TYPE_LABELS: Record<string, [string, string]> = {
  document: ["copaw.projects.knowledge.graphEntityType.document", "Document"],
  entity: ["copaw.projects.knowledge.graphEntityType.entity", "Entity"],
  path: ["copaw.projects.knowledge.graphEntityType.path", "Path"],
  version: ["copaw.projects.knowledge.graphEntityType.version", "Version"],
  snapshot: ["copaw.projects.knowledge.graphEntityType.snapshot", "Snapshot"],
};

const RELATION_TYPE_LABELS: Record<string, [string, string]> = {
  mentions: ["copaw.projects.knowledge.graphRelationType.mentions", "Mentions"],
  co_occurs_with: ["copaw.projects.knowledge.graphRelationType.co_occurs_with", "Co-occurs with"],
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