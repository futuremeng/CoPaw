import type {
  GraphEdge,
  GraphNode,
  GraphQueryRecord,
  GraphVisualizationData,
} from "../../../api/types";

/**
 * View model for displaying a graph query record as a table row.
 */
export interface GraphQueryRecordViewModel {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  score: number;
  sourceId: string;
  sourceType: string;
  documentPath: string;
  documentTitle: string;
}

/**
 * State of a graph query result.
 */
export type GraphQueryState = "idle" | "loading" | "success" | "error";

/**
 * Input for building graph query view models.
 */
export interface BuildGraphQueryViewModelsInput {
  records: GraphQueryRecord[];
  summary: string;
  provenance: Record<string, unknown>;
  warnings: string[];
  query: string;
}

/**
 * Convert a GraphQueryResponse into view models for table display.
 */
export function buildGraphQueryRecordViewModels(
  input: BuildGraphQueryViewModelsInput,
): {
  records: GraphQueryRecordViewModel[];
  summary: string;
  warnings: string[];
  recordCount: number;
} {
  const records = input.records.map((record, index) => ({
    id: `${record.source_id}-${record.subject}-${index}`,
    subject: record.subject,
    predicate: record.predicate,
    object: record.object,
    score: record.score,
    sourceId: record.source_id,
    sourceType: record.source_type,
    documentPath: record.document_path,
    documentTitle: record.document_title,
  }));

  return {
    records,
    summary: input.summary,
    warnings: input.warnings,
    recordCount: records.length,
  };
}

/**
 * Format score as a percentage or relevance badge.
 */
export function formatScore(score: number): {
  value: string;
  level: "high" | "medium" | "low";
} {
  if (score >= 0.7) {
    return { value: `${(score * 100).toFixed(0)}%`, level: "high" };
  }
  if (score >= 0.4) {
    return { value: `${(score * 100).toFixed(0)}%`, level: "medium" };
  }
  return { value: `${(score * 100).toFixed(0)}%`, level: "low" };
}

/**
 * Get color for score badge.
 */
export function getScoreColor(level: "high" | "medium" | "low"): string {
  switch (level) {
    case "high":
      return "#52c41a";
    case "medium":
      return "#faad14";
    case "low":
    default:
      return "#d9d9d9";
  }
}

/**
 * Filter records by query text (search in subject, object, title).
 */
export function filterGraphQueryRecords(
  records: GraphQueryRecordViewModel[],
  filterText: string,
): GraphQueryRecordViewModel[] {
  if (!filterText.trim()) {
    return records;
  }

  const query = filterText.toLowerCase();
  return records.filter(
    (r) =>
      r.subject.toLowerCase().includes(query) ||
      r.object.toLowerCase().includes(query) ||
      r.documentTitle.toLowerCase().includes(query) ||
      r.sourceId.toLowerCase().includes(query),
  );
}

/**
 * Sort records by score (descending) or other fields.
 */
export function sortGraphQueryRecords(
  records: GraphQueryRecordViewModel[],
  sortBy: "score" | "subject" | "title",
  descending: boolean = true,
): GraphQueryRecordViewModel[] {
  const sorted = [...records];
  sorted.sort((a, b) => {
    let aVal: string | number = "";
    let bVal: string | number = "";

    switch (sortBy) {
      case "score":
        aVal = a.score;
        bVal = b.score;
        break;
      case "subject":
        aVal = a.subject;
        bVal = b.subject;
        break;
      case "title":
        aVal = a.documentTitle;
        bVal = b.documentTitle;
        break;
    }

    if (typeof aVal === "number" && typeof bVal === "number") {
      return descending ? bVal - aVal : aVal - bVal;
    }

    const aStr = String(aVal).toLowerCase();
    const bStr = String(bVal).toLowerCase();
    return descending
      ? bStr.localeCompare(aStr)
      : aStr.localeCompare(bStr);
  });

  return sorted;
}

/**
 * Get status badge info for query warnings.
 */
export function getWarningsBadge(warnings: string[]): {
  count: number;
  status: "warning" | "info" | "success";
  label: string;
} {
  if (warnings.length === 0) {
    return { count: 0, status: "success", label: "No warnings" };
  }

  const hasErrors = warnings.some((w) =>
    w.includes("ERROR") || w.includes("FAILED"),
  );

  return {
    count: warnings.length,
    status: hasErrors ? "warning" : "info",
    label: `${warnings.length} warning${warnings.length > 1 ? "s" : ""}`,
  };
}

function safeNodeId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseObjectTriples(
  input: string,
): Array<{ relation: string; target: string; confidence: string }> {
  const parts = (input || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  const triples: Array<{ relation: string; target: string; confidence: string }> = [];

  parts.forEach((part) => {
    const arrowIndex = part.lastIndexOf("-->");
    if (arrowIndex <= 0) {
      return;
    }
    const target = part.slice(arrowIndex + 3).trim();
    const left = part.slice(0, arrowIndex).trim();
    const relMatch = left.match(/--([^[]+)(\[([^\]]*)\])?$/);
    const relation = relMatch?.[1]?.trim() || "related";
    const confidence = relMatch?.[3]?.trim() || "";
    if (target) {
      triples.push({ relation, target, confidence });
    }
  });

  return triples;
}

export function recordsToVisualizationData(
  records: GraphQueryRecord[],
  summary: string,
  provenance: Record<string, unknown>,
): GraphVisualizationData {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  let edgeCounter = 0;

  records.forEach((record, index) => {
    const subjectId = `subject-${safeNodeId(record.subject || `n-${index}`)}`;
    if (!nodes.has(subjectId)) {
      nodes.set(subjectId, {
        id: subjectId,
        label: record.subject,
        title: record.document_title,
        type: record.source_type,
        score: Number.isFinite(record.score) ? record.score : 0,
        source_id: record.source_id,
        document_path: record.document_path,
      });
    }

    const triples = parseObjectTriples(record.object);
    if (!triples.length) {
      return;
    }

    triples.forEach((triple) => {
      const targetId = `target-${safeNodeId(triple.target)}`;
      if (!nodes.has(targetId)) {
        nodes.set(targetId, {
          id: targetId,
          label: triple.target,
          title: record.document_title,
          type: record.source_type,
          score: Math.max(
            0.05,
            (Number.isFinite(record.score) ? record.score : 0) * 0.85,
          ),
          source_id: record.source_id,
          document_path: record.document_path,
        });
      }

      const edgeKey = `${subjectId}->${targetId}:${triple.relation}`;
      if (!edges.has(edgeKey)) {
        edges.set(edgeKey, {
          id: `edge-${edgeCounter++}`,
          source: subjectId,
          target: targetId,
          label: triple.relation,
          confidence: triple.confidence,
        });
      }
    });
  });

  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
    summary,
    provenance,
  };
}
