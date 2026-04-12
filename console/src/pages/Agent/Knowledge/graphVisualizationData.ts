import type { GraphVisualizationData } from "../../../api/types";

export interface GraphDisplayData {
  nodes: GraphVisualizationData["nodes"];
  edges: GraphVisualizationData["edges"];
  isolatedNodeIds: string[];
  connectedNodeIds: string[];
}

export interface GraphEntitySummaryItem {
  id: string;
  label: string;
  degree: number;
  score: number;
}

export interface GraphEntitySummary {
  totalNodes: number;
  connectedNodes: number;
  isolatedNodes: number;
  topEntities: GraphEntitySummaryItem[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function parseEdgeStrength(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return clamp01(raw > 1 ? raw / 100 : raw);
  }
  const text = String(raw ?? "").trim();
  if (!text) {
    return 0.5;
  }
  const matched = text.match(/\d+(\.\d+)?/);
  if (!matched) {
    return 0.5;
  }
  const parsed = Number(matched[0]);
  if (!Number.isFinite(parsed)) {
    return 0.5;
  }
  if (text.includes("%") || parsed > 1) {
    return clamp01(parsed / 100);
  }
  return clamp01(parsed);
}

export function buildGraphDisplayData(
  data: GraphVisualizationData,
  edgeStrengthThreshold: number,
): GraphDisplayData {
  const filteredEdges = data.edges.filter((edge) => {
    const strength = parseEdgeStrength(edge.confidence);
    return strength >= edgeStrengthThreshold;
  });
  const connectedNodeIds = new Set<string>();
  filteredEdges.forEach((edge) => {
    connectedNodeIds.add(edge.source);
    connectedNodeIds.add(edge.target);
  });

  return {
    nodes: data.nodes,
    edges: filteredEdges,
    isolatedNodeIds: data.nodes
      .filter((node) => !connectedNodeIds.has(node.id))
      .map((node) => node.id),
    connectedNodeIds: Array.from(connectedNodeIds),
  };
}

export function summarizeGraphEntities(data: GraphDisplayData): GraphEntitySummary {
  const degree = new Map<string, number>();
  data.nodes.forEach((node) => {
    degree.set(node.id, 0);
  });
  data.edges.forEach((edge) => {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  });

  const topEntities = data.nodes
    .map((node) => ({
      id: node.id,
      label: node.label,
      degree: degree.get(node.id) || 0,
      score: Number(node.score || 0),
    }))
    .sort((left, right) => right.degree - left.degree || right.score - left.score || left.label.localeCompare(right.label))
    .slice(0, 6);

  return {
    totalNodes: data.nodes.length,
    connectedNodes: data.connectedNodeIds.length,
    isolatedNodes: data.isolatedNodeIds.length,
    topEntities,
  };
}

export { parseEdgeStrength };