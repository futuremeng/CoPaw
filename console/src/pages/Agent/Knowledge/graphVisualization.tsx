import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Card,
  Empty,
  Input,
  Modal,
  message,
  Select,
  Slider,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  AimOutlined,
  CopyOutlined,
  ExportOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { ColumnType } from "antd/es/table";
import type {
  GraphNode,
  GraphQueryRecord,
  GraphVisualizationData,
} from "../../../api/types";
import {
  buildGraphQueryRecordViewModels,
  filterGraphQueryRecords,
  formatScore,
  getScoreColor,
  sortGraphQueryRecords,
  type GraphQueryRecordViewModel,
} from "./graphQuery";
import styles from "./index.module.less";

interface GraphQueryResultsProps {
  records: GraphQueryRecord[];
  summary: string;
  warnings: string[];
  provenance: Record<string, unknown>;
  query: string;
  title?: string;
  queryHeader?: ReactNode;
  loading?: boolean;
  onRefresh?: () => void;
  activeNodeId?: string | null;
  onRecordClick?: (nodeId: string) => void;
}

interface GraphVisualizationProps {
  data: GraphVisualizationData;
  loading?: boolean;
  onNodeClick?: (node: GraphNode) => void;
  onNodeHover?: (nodeId: string | null) => void;
  activeNodeId?: string | null;
  onActiveNodeChange?: (nodeId: string | null) => void;
  onUsePathContext?: (pathSummary: string, runNow?: boolean) => void;
  onInsightFocusChange?: (payload: { keyword: string; active: boolean }) => void;
}

interface G6Graph {
  setData: (data: unknown) => void;
  render: () => Promise<void>;
  destroy: () => void;
  setSize: (width: number, height: number) => void;
  on: (event: string, handler: (evt: unknown) => void) => void;
  setElementState: (
    state: Record<string, string[]>,
    animation?: boolean,
  ) => Promise<void>;
  focusElement: (id: string, animation?: unknown) => Promise<void>;
  getNeighborNodesData: (id: string) => Array<{ id?: string | number }>;
  zoomBy?: (ratio: number, animation?: unknown, origin?: [number, number]) => void;
  fitView?: (options?: unknown, animation?: unknown) => void;
}

type GraphTopologyData = {
  nodes: GraphVisualizationData["nodes"];
  edges: GraphVisualizationData["edges"];
};

type GraphInsightCard = {
  key: string;
  title: string;
  detail: string;
  nodeIds: string[];
  edgeIds: string[];
};

type GraphColorMode = "type" | "weight";

const TYPE_COLOR_PALETTE = [
  "#1677ff",
  "#13c2c2",
  "#52c41a",
  "#faad14",
  "#eb2f96",
  "#722ed1",
  "#fa541c",
  "#2f54eb",
];

function subjectToNodeId(subject: string): string {
  const normalized = (subject || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `subject-${normalized || "unknown"}`;
}

function resolveEventElementId(evt: unknown): string | null {
  if (!evt || typeof evt !== "object") {
    return null;
  }
  const raw = evt as { target?: { id?: string } };
  return raw.target?.id || null;
}

function buildStateMap(
  data: GraphTopologyData,
  focusedNodeId: string | null,
  neighborIds: Set<string>,
  pathNodeIds: Set<string>,
  pathEdgeIds: Set<string>,
  insightNodeIds: Set<string>,
  insightEdgeIds: Set<string>,
): Record<string, string[]> {
  const stateMap: Record<string, string[]> = {};

  data.nodes.forEach((node) => {
    if (!focusedNodeId) {
      if (pathNodeIds.has(node.id)) {
        stateMap[node.id] = ["path"];
        return;
      }
      stateMap[node.id] = insightNodeIds.has(node.id) ? ["insight"] : [];
      return;
    }
    if (pathNodeIds.has(node.id)) {
      stateMap[node.id] = ["path"];
      return;
    }
    if (node.id === focusedNodeId) {
      stateMap[node.id] = ["active", "hover"];
      return;
    }
    if (neighborIds.has(node.id)) {
      stateMap[node.id] = ["active"];
      return;
    }
    stateMap[node.id] = ["dim"];
  });

  data.edges.forEach((edge) => {
    if (!focusedNodeId) {
      if (pathEdgeIds.has(edge.id)) {
        stateMap[edge.id] = ["path"];
        return;
      }
      stateMap[edge.id] = insightEdgeIds.has(edge.id) ? ["insight"] : [];
      return;
    }
    if (pathEdgeIds.has(edge.id)) {
      stateMap[edge.id] = ["path"];
      return;
    }
    const isConnected = edge.source === focusedNodeId || edge.target === focusedNodeId;
    stateMap[edge.id] = isConnected ? ["active"] : ["dim"];
  });

  return stateMap;
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

function getNodeGroupId(nodeId: string, nodeType: string): string {
  if (nodeType) {
    return nodeType;
  }
  if (nodeId.startsWith("subject-")) {
    return "subject";
  }
  if (nodeId.startsWith("target-")) {
    return "target";
  }
  return "other";
}

function colorByIndex(index: number): string {
  return TYPE_COLOR_PALETTE[index % TYPE_COLOR_PALETTE.length];
}

function buildWeightColor(weight: number): string {
  const w = clamp01(weight);
  if (w < 0.25) {
    return "#d9d9d9";
  }
  if (w < 0.5) {
    return "#91caff";
  }
  if (w < 0.75) {
    return "#40a9ff";
  }
  return "#0958d9";
}

function buildEdgeColor(weight: number): string {
  const w = clamp01(weight);
  if (w < 0.25) {
    return "#d9d9d9";
  }
  if (w < 0.5) {
    return "#b7eb8f";
  }
  if (w < 0.75) {
    return "#73d13d";
  }
  return "#389e0d";
}

export function GraphQueryResults(props: GraphQueryResultsProps) {
  const { t } = useTranslation();
  const [filterText, setFilterText] = useState("");
  const [sortBy, setSortBy] = useState<"score" | "subject" | "title">("score");
  const [sortOrder, setSortOrder] = useState<"descend" | "ascend">("descend");
  const [pageSize, setPageSize] = useState(10);

  const viewModels = useMemo(() => {
    const input = {
      records: props.records,
      summary: props.summary,
      provenance: props.provenance,
      warnings: props.warnings,
      query: props.query,
    };
    const built = buildGraphQueryRecordViewModels(input);
    let filtered = filterGraphQueryRecords(built.records, filterText);
    filtered = sortGraphQueryRecords(filtered, sortBy, sortOrder === "descend");
    return { ...built, records: filtered };
  }, [
    filterText,
    props.provenance,
    props.query,
    props.records,
    props.summary,
    props.warnings,
    sortBy,
    sortOrder,
  ]);

  const columns: ColumnType<GraphQueryRecordViewModel>[] = [
    {
      title: t("knowledge.graphQuery.subject"),
      dataIndex: "subject",
      key: "subject",
      width: "20%",
      ellipsis: { showTitle: false },
      render: (text: string) => (
        <Tooltip title={text}>
          <span>{text}</span>
        </Tooltip>
      ),
    },
    {
      title: t("knowledge.graphQuery.predicate"),
      dataIndex: "predicate",
      key: "predicate",
      width: "10%",
      render: (text: string) => <Tag color="blue">{text}</Tag>,
    },
    {
      title: t("knowledge.graphQuery.object"),
      dataIndex: "object",
      key: "object",
      width: "30%",
      ellipsis: { showTitle: false },
      render: (text: string) => (
        <Tooltip title={text}>
          <span>{text}</span>
        </Tooltip>
      ),
    },
    {
      title: t("knowledge.graphQuery.score"),
      dataIndex: "score",
      key: "score",
      width: "10%",
      sorter: (a, b) => a.score - b.score,
      render: (score: number) => {
        const formatted = formatScore(score);
        return <Tag color={getScoreColor(formatted.level)}>{formatted.value}</Tag>;
      },
    },
    {
      title: t("knowledge.graphQuery.source"),
      dataIndex: "sourceId",
      key: "sourceId",
      width: "15%",
      ellipsis: { showTitle: false },
      render: (text: string) => (
        <Tooltip title={text}>
          <span>{text}</span>
        </Tooltip>
      ),
    },
    {
      title: t("knowledge.graphQuery.type"),
      dataIndex: "sourceType",
      key: "sourceType",
      width: "10%",
      render: (text: string) => <Tag color="green">{text}</Tag>,
    },
  ];

  return (
    <div className={styles.graphQueryResults}>
      <Card
        title={props.title || t("knowledge.graphQuery.results")}
        extra={
          <Space>
            <Tooltip title={t("knowledge.graphQuery.refresh")}>
              <Button
                icon={<ReloadOutlined />}
                loading={props.loading}
                onClick={props.onRefresh}
              />
            </Tooltip>
          </Space>
        }
        loading={props.loading}
        style={{ marginBottom: 16 }}
      >
        {props.queryHeader}
        <Space direction="vertical" style={{ width: "100%", marginBottom: 16 }}>
          <Space wrap>
            <span>{t("knowledge.graphQuery.filter")}:</span>
            <Input
              value={filterText}
              onChange={(event) => setFilterText(event.target.value)}
              placeholder={t("knowledge.graphQuery.filterPlaceholder")}
              style={{ width: 260 }}
            />
            <span>{t("knowledge.graphQuery.sortBy")}:</span>
            <Select
              value={sortBy}
              onChange={setSortBy}
              options={[
                { label: "Score", value: "score" },
                { label: "Subject", value: "subject" },
                { label: "Document Title", value: "title" },
              ]}
              style={{ width: 150 }}
            />
            <Select
              value={sortOrder}
              onChange={(value) => setSortOrder(value as "ascend" | "descend")}
              options={[
                { label: "Descending", value: "descend" },
                { label: "Ascending", value: "ascend" },
              ]}
              style={{ width: 120 }}
            />
          </Space>

          {props.warnings.length > 0 ? (
            <div className={styles.graphQueryWarningBox}>
              <strong>{t("knowledge.graphQuery.warnings")}:</strong>
              {props.warnings.map((warning) => (
                <div key={warning}>- {warning}</div>
              ))}
            </div>
          ) : null}

          <Typography.Text type="secondary">
            {t("knowledge.graphQuery.resultsSummary", {
              count: viewModels.recordCount,
            })}
            {props.summary ? ` - ${props.summary}` : ""}
          </Typography.Text>
        </Space>

        {viewModels.records.length === 0 ? (
          <Empty description={t("knowledge.graphQuery.noResults")} />
        ) : (
          <Table
            columns={columns}
            dataSource={viewModels.records}
            rowKey="id"
            rowClassName={(record) =>
              props.activeNodeId === subjectToNodeId(record.subject)
                ? styles.graphTableRowSelected
                : ""
            }
            onRow={(record) => ({
              onClick: () => {
                props.onRecordClick?.(subjectToNodeId(record.subject));
              },
            })}
            pagination={{
              pageSize,
              onChange: (_, size) => setPageSize(size),
              showSizeChanger: true,
              pageSizeOptions: ["10", "20", "50", "100"],
            }}
            size="small"
            scroll={{ x: 1200 }}
          />
        )}
      </Card>
    </div>
  );
}

export function GraphVisualization(props: GraphVisualizationProps) {
  const { t } = useTranslation();
  const {
    data,
    loading,
    onNodeClick,
    onNodeHover,
    activeNodeId,
    onActiveNodeChange,
    onUsePathContext,
    onInsightFocusChange,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<G6Graph | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(
    activeNodeId || null,
  );
  const [pathStartNodeId, setPathStartNodeId] = useState<string | null>(null);
  const [pathEndNodeId, setPathEndNodeId] = useState<string | null>(null);
  const [pathNodeIds, setPathNodeIds] = useState<string[]>([]);
  const [pathEdgeIds, setPathEdgeIds] = useState<string[]>([]);
  const [autoFillPathEndpoints, setAutoFillPathEndpoints] = useState(false);
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);
  const [colorMode, setColorMode] = useState<GraphColorMode>("type");
  const [edgeStrengthThreshold, setEdgeStrengthThreshold] = useState(0);
  const [activeInsightKey, setActiveInsightKey] = useState("");

  const nodeTypeColorMap = useMemo(() => {
    const groups = Array.from(new Set(data.nodes.map((node) => getNodeGroupId(node.id, String(node.type || "")))));
    const map = new Map<string, string>();
    groups.forEach((group, index) => {
      map.set(group, colorByIndex(index));
    });
    return map;
  }, [data.nodes]);

  const graphData = useMemo(() => {
    const filteredEdges = data.edges.filter((edge) => {
      const strength = parseEdgeStrength(edge.confidence);
      return strength >= edgeStrengthThreshold;
    });
    if (!filteredEdges.length) {
      return {
        nodes: data.nodes,
        edges: filteredEdges,
      };
    }

    const connectedNodeIds = new Set<string>();
    filteredEdges.forEach((edge) => {
      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
    });
    const filteredNodes = data.nodes.filter((node) => connectedNodeIds.has(node.id));
    return {
      nodes: filteredNodes,
      edges: filteredEdges,
    };
  }, [data.edges, data.nodes, edgeStrengthThreshold]);

  const nodeOptions = useMemo(
    () =>
      graphData.nodes
        .map((node) => ({
          label: node.label,
          value: node.id,
          score: Number(node.score || 0),
        }))
        .sort((left, right) => right.score - left.score),
    [graphData.nodes],
  );

  const hotNodes = useMemo(() => nodeOptions.slice(0, 6), [nodeOptions]);

  const edgeLookup = useMemo(() => {
    const map = new Map<string, string>();
    graphData.edges.forEach((edge) => {
      map.set(`${edge.source}->${edge.target}`, edge.id);
      map.set(`${edge.target}->${edge.source}`, edge.id);
    });
    return map;
  }, [graphData.edges]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, GraphNode>();
    graphData.nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [graphData.nodes]);

  const pathSummary = useMemo(() => {
    if (!pathNodeIds.length) {
      return "";
    }
    return pathNodeIds
      .map((nodeId) => nodeMap.get(nodeId)?.label || nodeId)
      .join(" -> ");
  }, [nodeMap, pathNodeIds]);

  const pathHopCount = useMemo(() => {
    return Math.max(0, pathNodeIds.length - 1);
  }, [pathNodeIds.length]);

  const focusedNodeLabel = useMemo(() => {
    if (!focusedNodeId) {
      return "";
    }
    return nodeMap.get(focusedNodeId)?.label || focusedNodeId;
  }, [focusedNodeId, nodeMap]);

  const focusedNodeRelations = useMemo(() => {
    if (!focusedNodeId) {
      return {
        outgoing: [] as Array<{ edgeId: string; label: string; nodeId: string; nodeLabel: string; strength: number }> ,
        incoming: [] as Array<{ edgeId: string; label: string; nodeId: string; nodeLabel: string; strength: number }> ,
      };
    }

    const outgoing = graphData.edges
      .filter((edge) => edge.source === focusedNodeId)
      .map((edge) => ({
        edgeId: edge.id,
        label: edge.label,
        nodeId: edge.target,
        nodeLabel: nodeMap.get(edge.target)?.label || edge.target,
        strength: parseEdgeStrength(edge.confidence),
      }))
      .sort((left, right) => right.strength - left.strength);

    const incoming = graphData.edges
      .filter((edge) => edge.target === focusedNodeId)
      .map((edge) => ({
        edgeId: edge.id,
        label: edge.label,
        nodeId: edge.source,
        nodeLabel: nodeMap.get(edge.source)?.label || edge.source,
        strength: parseEdgeStrength(edge.confidence),
      }))
      .sort((left, right) => right.strength - left.strength);

    return { outgoing, incoming };
  }, [focusedNodeId, graphData.edges, nodeMap]);

  const insightCards = useMemo<GraphInsightCard[]>(() => {
    const degree = new Map<string, number>();
    const neighbors = new Map<string, Set<string>>();
    graphData.nodes.forEach((node) => {
      degree.set(node.id, 0);
      neighbors.set(node.id, new Set());
    });
    graphData.edges.forEach((edge) => {
      degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
      neighbors.get(edge.source)?.add(edge.target);
      neighbors.get(edge.target)?.add(edge.source);
    });

    const isolatedNodeIds = graphData.nodes
      .filter((node) => (degree.get(node.id) || 0) <= 1)
      .slice(0, 10)
      .map((node) => node.id);

    const weakEdges = graphData.edges
      .map((edge) => ({ edge, strength: parseEdgeStrength(edge.confidence) }))
      .filter((item) => item.strength < 0.35)
      .sort((left, right) => left.strength - right.strength)
      .slice(0, 20);
    const weakEdgeIds = weakEdges.map((item) => item.edge.id);
    const weakNodeIds = Array.from(
      new Set(weakEdges.flatMap((item) => [item.edge.source, item.edge.target])),
    ).slice(0, 12);

    const bridgeNodeIds = graphData.nodes
      .map((node) => {
        const n = Array.from(neighbors.get(node.id) || []);
        const groups = new Set(
          n.map((nid) => getNodeGroupId(nid, String(nodeMap.get(nid)?.type || ""))),
        );
        return {
          id: node.id,
          groupCount: groups.size,
          degree: degree.get(node.id) || 0,
        };
      })
      .filter((item) => item.groupCount >= 2 && item.degree >= 3)
      .sort((left, right) => right.groupCount - left.groupCount || right.degree - left.degree)
      .slice(0, 8)
      .map((item) => item.id);

    const bridgeEdges = graphData.edges
      .filter((edge) => bridgeNodeIds.includes(edge.source) || bridgeNodeIds.includes(edge.target))
      .slice(0, 20)
      .map((edge) => edge.id);

    return [
      {
        key: "isolated",
        title: t("knowledge.graphQuery.insightIsolated", "Isolated Nodes"),
        detail: `${isolatedNodeIds.length} nodes with degree <= 1`,
        nodeIds: isolatedNodeIds,
        edgeIds: [],
      },
      {
        key: "weak-links",
        title: t("knowledge.graphQuery.insightWeakLinks", "Weak Links"),
        detail: `${weakEdgeIds.length} low-confidence edges`,
        nodeIds: weakNodeIds,
        edgeIds: weakEdgeIds,
      },
      {
        key: "bridges",
        title: t("knowledge.graphQuery.insightBridges", "Bridge Nodes"),
        detail: `${bridgeNodeIds.length} cross-group connectors`,
        nodeIds: bridgeNodeIds,
        edgeIds: bridgeEdges,
      },
    ];
  }, [graphData.edges, graphData.nodes, nodeMap, t]);

  const activeInsight = useMemo(
    () => insightCards.find((item) => item.key === activeInsightKey) || null,
    [activeInsightKey, insightCards],
  );

  const autoFillTargetKey = useMemo(() => {
    if (!pathStartNodeId) {
      return "knowledge.graphQuery.pathAutoTargetStart";
    }
    if (!pathEndNodeId) {
      return "knowledge.graphQuery.pathAutoTargetEnd";
    }
    return "knowledge.graphQuery.pathAutoTargetRolling";
  }, [pathEndNodeId, pathStartNodeId]);

  useEffect(() => {
    const validNodeIds = new Set(graphData.nodes.map((node) => node.id));
    const validEdgeIds = new Set(graphData.edges.map((edge) => edge.id));

    setFocusedNodeId((prev) => (prev && validNodeIds.has(prev) ? prev : null));
    setPathStartNodeId((prev) => (prev && validNodeIds.has(prev) ? prev : null));
    setPathEndNodeId((prev) => (prev && validNodeIds.has(prev) ? prev : null));
    setPathNodeIds((prev) => prev.filter((id) => validNodeIds.has(id)));
    setPathEdgeIds((prev) => prev.filter((id) => validEdgeIds.has(id)));
  }, [graphData.edges, graphData.nodes]);

  useEffect(() => {
    setFocusedNodeId(activeNodeId || null);
  }, [activeNodeId]);

  const updateFocusState = useCallback(
    async (nodeId: string | null, shouldFocusElement: boolean) => {
      if (!graphRef.current) {
        return;
      }
      const pathNodeSet = new Set(pathNodeIds);
      const pathEdgeSet = new Set(pathEdgeIds);
      const insightNodeSet = new Set(activeInsight?.nodeIds || []);
      const insightEdgeSet = new Set(activeInsight?.edgeIds || []);
      if (!nodeId) {
        const resetState = buildStateMap(
          graphData,
          null,
          new Set<string>(),
          pathNodeSet,
          pathEdgeSet,
          insightNodeSet,
          insightEdgeSet,
        );
        await graphRef.current.setElementState(resetState, false);
        return;
      }

      const neighbors = new Set(
        graphRef.current
          .getNeighborNodesData(nodeId)
          .map((item) => String(item.id || ""))
          .filter(Boolean),
      );
      const stateMap = buildStateMap(
        graphData,
        nodeId,
        neighbors,
        pathNodeSet,
        pathEdgeSet,
        insightNodeSet,
        insightEdgeSet,
      );
      await graphRef.current.setElementState(stateMap, false);

      if (shouldFocusElement) {
        await graphRef.current.focusElement(nodeId, { duration: 300 });
      }
    },
    [activeInsight?.edgeIds, activeInsight?.nodeIds, graphData, pathEdgeIds, pathNodeIds],
  );

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `knowledge-graph-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleZoomIn = useCallback(() => {
    graphRef.current?.zoomBy?.(1.2, { duration: 200 });
  }, []);

  const handleZoomOut = useCallback(() => {
    graphRef.current?.zoomBy?.(0.8, { duration: 200 });
  }, []);

  const handleFitView = useCallback(() => {
    graphRef.current?.fitView?.({ padding: 24 }, { duration: 260 });
  }, []);

  const handleSelectNode = useCallback(
    (nodeId: string | null) => {
      const nextNodeId = nodeId || null;
      setFocusedNodeId(nextNodeId);
      onActiveNodeChange?.(nextNodeId);
      void updateFocusState(nextNodeId, Boolean(nextNodeId));
      if (!nextNodeId) {
        return;
      }
      const found = nodeMap.get(nextNodeId);
      if (found) {
        onNodeClick?.(found);
      }
    },
    [nodeMap, onActiveNodeChange, onNodeClick, updateFocusState],
  );

  const handleFindPath = useCallback(() => {
    if (!pathStartNodeId || !pathEndNodeId) {
      message.warning(t("knowledge.graphQuery.pathNeedNodes"));
      return;
    }
    if (pathStartNodeId === pathEndNodeId) {
      setPathNodeIds([pathStartNodeId]);
      setPathEdgeIds([]);
      setFocusedNodeId(pathStartNodeId);
      onActiveNodeChange?.(pathStartNodeId);
      void updateFocusState(pathStartNodeId, true);
      return;
    }

    const adjacency = new Map<string, string[]>();
      graphData.edges.forEach((edge) => {
      if (!adjacency.has(edge.source)) {
        adjacency.set(edge.source, []);
      }
      if (!adjacency.has(edge.target)) {
        adjacency.set(edge.target, []);
      }
      adjacency.get(edge.source)?.push(edge.target);
      adjacency.get(edge.target)?.push(edge.source);
    });

    const queue: string[] = [pathStartNodeId];
    const visited = new Set<string>([pathStartNodeId]);
    const parent = new Map<string, string>();
    let found = false;

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }
      if (current === pathEndNodeId) {
        found = true;
        break;
      }
      const neighbors = adjacency.get(current) || [];
      neighbors.forEach((next) => {
        if (visited.has(next)) {
          return;
        }
        visited.add(next);
        parent.set(next, current);
        queue.push(next);
      });
    }

    if (!found) {
      setPathNodeIds([]);
      setPathEdgeIds([]);
      message.info(t("knowledge.graphQuery.pathNotFound"));
      return;
    }

    const pathNodes: string[] = [];
    let cursor = pathEndNodeId;
    pathNodes.push(cursor);
    while (cursor !== pathStartNodeId) {
      const prev = parent.get(cursor);
      if (!prev) {
        break;
      }
      pathNodes.push(prev);
      cursor = prev;
    }
    pathNodes.reverse();

    const edges: string[] = [];
    for (let index = 0; index < pathNodes.length - 1; index += 1) {
      const key = `${pathNodes[index]}->${pathNodes[index + 1]}`;
      const edgeId = edgeLookup.get(key);
      if (edgeId) {
        edges.push(edgeId);
      }
    }

    setPathNodeIds(pathNodes);
    setPathEdgeIds(edges);
    setFocusedNodeId(pathEndNodeId);
    onActiveNodeChange?.(pathEndNodeId);
    void updateFocusState(pathEndNodeId, true);
  }, [
    graphData.edges,
    edgeLookup,
    onActiveNodeChange,
    pathEndNodeId,
    pathStartNodeId,
    t,
    updateFocusState,
  ]);

  const handleClearPath = useCallback(() => {
    setPathNodeIds([]);
    setPathEdgeIds([]);
    setPathStartNodeId(null);
    setPathEndNodeId(null);
    void updateFocusState(focusedNodeId, false);
  }, [focusedNodeId, updateFocusState]);

  const handleSwapPathEndpoints = useCallback(() => {
    setPathStartNodeId(pathEndNodeId || null);
    setPathEndNodeId(pathStartNodeId || null);
  }, [pathEndNodeId, pathStartNodeId]);

  const handleAutoFillPathFromClick = useCallback((nodeId: string) => {
    if (!autoFillPathEndpoints) {
      return;
    }
    if (!pathStartNodeId) {
      setPathStartNodeId(nodeId);
      return;
    }
    if (!pathEndNodeId) {
      if (nodeId !== pathStartNodeId) {
        setPathEndNodeId(nodeId);
      }
      return;
    }
    if (nodeId !== pathEndNodeId) {
      setPathStartNodeId(pathEndNodeId);
      setPathEndNodeId(nodeId);
    }
  }, [autoFillPathEndpoints, pathEndNodeId, pathStartNodeId]);

  const handleCopyPathSummary = useCallback(async () => {
    if (!pathSummary) {
      message.info(t("knowledge.graphQuery.pathSummaryEmpty"));
      return;
    }
    if (!navigator?.clipboard?.writeText) {
      message.error(t("knowledge.graphQuery.pathSummaryCopyFailed"));
      return;
    }
    try {
      await navigator.clipboard.writeText(pathSummary);
      message.success(t("knowledge.graphQuery.pathSummaryCopied"));
    } catch {
      message.error(t("knowledge.graphQuery.pathSummaryCopyFailed"));
    }
  }, [pathSummary, t]);

  const handleUsePathContext = useCallback((runNow?: boolean) => {
    if (!pathSummary) {
      message.info(t("knowledge.graphQuery.pathSummaryEmpty"));
      return;
    }
    onUsePathContext?.(pathSummary, runNow);
    message.success(
      runNow
        ? t("knowledge.graphQuery.pathContextRunApplied")
        : t("knowledge.graphQuery.pathContextApplied"),
    );
  }, [onUsePathContext, pathSummary, t]);

  useEffect(() => {
    let unmounted = false;

    const renderGraph = async () => {
      if (!containerRef.current || !graphData.nodes.length) {
        return;
      }

      const width = containerRef.current.clientWidth || 800;
      const height = 440;
      const g6Data = {
        nodes: graphData.nodes.map((node) => ({
          id: node.id,
          data: {
            label: node.label,
            score: Number(node.score || 0),
            type: node.type,
            source_id: node.source_id,
            document_path: node.document_path,
          },
        })),
        edges: graphData.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          data: {
            label: edge.label,
            confidence: edge.confidence || "",
            strength: parseEdgeStrength(edge.confidence),
          },
        })),
      };

      const module = await import("@antv/g6");
      if (unmounted || !containerRef.current) {
        return;
      }

      if (!graphRef.current) {
        const graph = new module.Graph({
          container: containerRef.current,
          width,
          height,
          autoFit: "view",
          data: g6Data,
          layout: {
            type: "force",
            preventOverlap: true,
            nodeStrength: -300,
            edgeStrength: 0.08,
            linkDistance: 160,
          },
          behaviors: ["drag-canvas", "zoom-canvas", "drag-element"],
          animation: false,
          node: {
            type: "circle",
            style: (datum: {
              data?: { label?: string; score?: number; type?: string };
            }) => {
              const score = Number(datum?.data?.score || 0);
              const group = getNodeGroupId("", String(datum?.data?.type || ""));
              const baseFill =
                colorMode === "type"
                  ? nodeTypeColorMap.get(group) || "#1677ff"
                  : buildWeightColor(score);
              const size = 22 + Math.min(30, Math.max(0, score * 20));
              return {
                size,
                lineWidth: 1,
                fill: `${baseFill}22`,
                stroke: baseFill,
                labelText: datum?.data?.label || "",
                labelPlacement: "bottom",
                labelFontSize: 11,
                cursor: "pointer",
              };
            },
            state: {
              dim: {
                opacity: 0.18,
              },
              active: {
                lineWidth: 2,
                stroke: "#0958d9",
                opacity: 1,
              },
              path: {
                lineWidth: 3,
                stroke: "#389e0d",
                fill: "#f6ffed",
                opacity: 1,
              },
              insight: {
                lineWidth: 3,
                stroke: "#531dab",
                fill: "#f9f0ff",
                opacity: 1,
              },
              hover: {
                lineWidth: 3,
                stroke: "#fa8c16",
              },
            },
          },
          edge: {
            type: "line",
            style: (datum: { data?: { label?: string; strength?: number } }) => {
              const strength = Number(datum?.data?.strength || 0.5);
              return {
              stroke: buildEdgeColor(strength),
              lineWidth: 0.8 + strength * 2,
              endArrow: true,
              labelText: datum?.data?.label || "",
              labelBackground: true,
              labelFontSize: 10,
              labelFill: "#8c8c8c",
            };
            },
            state: {
              dim: {
                opacity: 0.12,
              },
              active: {
                stroke: "#1677ff",
                opacity: 1,
                lineWidth: 1.4,
              },
              path: {
                stroke: "#52c41a",
                opacity: 1,
                lineWidth: 2,
              },
              insight: {
                stroke: "#722ed1",
                opacity: 1,
                lineWidth: 2.2,
              },
            },
          },
        }) as unknown as G6Graph;

        graph.on("node:mouseenter", async (evt: unknown) => {
          const nodeId = resolveEventElementId(evt);
          onNodeHover?.(nodeId);
          if (!nodeId) {
            return;
          }
          await updateFocusState(nodeId, false);
        });

        graph.on("node:mouseleave", async () => {
          onNodeHover?.(null);
          await updateFocusState(focusedNodeId, false);
        });

        graph.on("node:click", async (evt: unknown) => {
          const nodeId = resolveEventElementId(evt);
          if (!nodeId) {
            return;
          }
          handleAutoFillPathFromClick(nodeId);
          setFocusedNodeId(nodeId);
          onActiveNodeChange?.(nodeId);
          await updateFocusState(nodeId, true);
          const found = nodeMap.get(nodeId);
          if (found) {
            onNodeClick?.(found);
          }
        });

        graphRef.current = graph;
        await graphRef.current.render();
      } else {
        graphRef.current.setData(g6Data);
        await graphRef.current.render();
      }

      if (!resizeObserverRef.current && containerRef.current) {
        resizeObserverRef.current = new ResizeObserver((entries) => {
          if (!graphRef.current || !entries.length) {
            return;
          }
          const box = entries[0].contentRect;
          graphRef.current.setSize(Math.max(320, box.width), 440);
        });
        resizeObserverRef.current.observe(containerRef.current);
      }
    };

    void renderGraph();

    return () => {
      unmounted = true;
    };
  }, [
    graphData,
    colorMode,
    focusedNodeId,
    handleAutoFillPathFromClick,
    nodeMap,
    nodeTypeColorMap,
    onActiveNodeChange,
    onNodeClick,
    onNodeHover,
    updateFocusState,
  ]);

  useEffect(() => {
    void updateFocusState(focusedNodeId, false);
  }, [focusedNodeId, updateFocusState]);

  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      graphRef.current?.destroy();
      graphRef.current = null;
    };
  }, []);

  if (!graphData.nodes.length) {
    return (
      <Card title={t("knowledge.graphQuery.visualization")} loading={loading}>
        <Empty description={edgeStrengthThreshold > 0 ? t("knowledge.graphQuery.noVisualizationAfterFilter", "No graph data after threshold filter") : t("knowledge.graphQuery.noVisualization")} />
      </Card>
    );
  }

  return (
    <Card
      title={t("knowledge.graphQuery.visualization")}
      extra={
        <Space>
          <Button icon={<PlusOutlined />} onClick={handleZoomIn}>
            {t("knowledge.graphQuery.zoomIn")}
          </Button>
          <Button icon={<MinusOutlined />} onClick={handleZoomOut}>
            {t("knowledge.graphQuery.zoomOut")}
          </Button>
          <Button icon={<AimOutlined />} onClick={handleFitView}>
            {t("knowledge.graphQuery.fitView")}
          </Button>
          <Button onClick={() => setAdvancedSettingsOpen(true)}>
            {t("knowledge.graphQuery.advancedSettings", "高级设置")}
          </Button>
          <Button icon={<ExportOutlined />} onClick={handleExport}>
            {t("knowledge.graphQuery.export")}
          </Button>
        </Space>
      }
      loading={loading}
    >
      <div className={styles.graphCanvasWrap}>
        <div ref={containerRef} className={styles.graphCanvas} />
      </div>
      <div className={styles.graphLegendRow}>
        <Typography.Text type="secondary">
          {t("knowledge.graphQuery.colorMode", "Color Mode")}: {colorMode === "type" ? t("knowledge.graphQuery.colorModeType", "Type") : t("knowledge.graphQuery.colorModeWeight", "Weight")}
        </Typography.Text>
        <div className={styles.graphLegendList}>
          {colorMode === "type"
            ? Array.from(nodeTypeColorMap.entries()).map(([type, color]) => (
              <span key={type} className={styles.graphLegendItem}>
                <span className={styles.graphLegendSwatch} style={{ backgroundColor: color }} />
                {type}
              </span>
            ))
            : [
              { label: "Low", color: buildWeightColor(0.2) },
              { label: "Mid", color: buildWeightColor(0.55) },
              { label: "High", color: buildWeightColor(0.9) },
            ].map((item) => (
              <span key={item.label} className={styles.graphLegendItem}>
                <span className={styles.graphLegendSwatch} style={{ backgroundColor: item.color }} />
                {item.label}
              </span>
            ))}
        </div>
      </div>
      <Typography.Text type="secondary" className={styles.graphSummaryText}>
        {t("knowledge.graphQuery.nodes")}: {graphData.nodes.length} | {t("knowledge.graphQuery.edges")}: {graphData.edges.length}
      </Typography.Text>
      <div className={styles.graphInsightRow}>
        {insightCards.map((card) => {
          const active = card.key === activeInsightKey;
          return (
            <button
              key={card.key}
              type="button"
              className={`${styles.graphInsightCard} ${active ? styles.graphInsightCardActive : ""}`}
              onClick={() => {
                setActiveInsightKey((prev) => {
                  const nextActive = prev !== card.key;
                  const firstNodeId = card.nodeIds[0] || "";
                  const keyword = firstNodeId ? nodeMap.get(firstNodeId)?.label || "" : "";
                  onInsightFocusChange?.({ keyword, active: nextActive });
                  return nextActive ? card.key : "";
                });
              }}
            >
              <span className={styles.graphInsightTitle}>{card.title}</span>
              <span className={styles.graphInsightDetail}>{card.detail}</span>
            </button>
          );
        })}
      </div>
      {focusedNodeId ? (
        <div className={styles.graphEntityPanel}>
          <div className={styles.graphEntityPanelHeader}>
            <Typography.Text strong>
              {t("knowledge.graphQuery.entityDetail", "Entity Detail")}
            </Typography.Text>
            <Typography.Text type="secondary">{focusedNodeLabel}</Typography.Text>
          </div>
          <div className={styles.graphEntityPanelBody}>
            <div className={styles.graphEntitySection}>
              <Typography.Text type="secondary">
                {t("knowledge.graphQuery.outgoing", "Outgoing")} ({focusedNodeRelations.outgoing.length})
              </Typography.Text>
              <div className={styles.graphEntityRelationList}>
                {focusedNodeRelations.outgoing.slice(0, 8).map((item) => (
                  <button
                    key={item.edgeId}
                    type="button"
                    className={styles.graphEntityRelationItem}
                    onClick={() => handleSelectNode(item.nodeId)}
                  >
                    <span className={styles.graphEntityRelationLabel}>{item.label}</span>
                    <span className={styles.graphEntityRelationTarget}>{item.nodeLabel}</span>
                    <span className={styles.graphEntityRelationStrength}>{Math.round(item.strength * 100)}%</span>
                  </button>
                ))}
                {!focusedNodeRelations.outgoing.length ? (
                  <Typography.Text type="secondary" className={styles.graphEntityEmpty}>
                    {t("knowledge.graphQuery.none", "None")}
                  </Typography.Text>
                ) : null}
              </div>
            </div>
            <div className={styles.graphEntitySection}>
              <Typography.Text type="secondary">
                {t("knowledge.graphQuery.incoming", "Incoming")} ({focusedNodeRelations.incoming.length})
              </Typography.Text>
              <div className={styles.graphEntityRelationList}>
                {focusedNodeRelations.incoming.slice(0, 8).map((item) => (
                  <button
                    key={item.edgeId}
                    type="button"
                    className={styles.graphEntityRelationItem}
                    onClick={() => handleSelectNode(item.nodeId)}
                  >
                    <span className={styles.graphEntityRelationTarget}>{item.nodeLabel}</span>
                    <span className={styles.graphEntityRelationLabel}>{item.label}</span>
                    <span className={styles.graphEntityRelationStrength}>{Math.round(item.strength * 100)}%</span>
                  </button>
                ))}
                {!focusedNodeRelations.incoming.length ? (
                  <Typography.Text type="secondary" className={styles.graphEntityEmpty}>
                    {t("knowledge.graphQuery.none", "None")}
                  </Typography.Text>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <Modal
        title={t("knowledge.graphQuery.advancedSettings", "高级设置")}
        open={advancedSettingsOpen}
        onCancel={() => setAdvancedSettingsOpen(false)}
        footer={null}
        width={960}
      >
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <Space wrap className={styles.graphAdvancedRow}>
            <Typography.Text type="secondary">{t("knowledge.graphQuery.colorMode", "Color Mode")}</Typography.Text>
            <Select
              size="small"
              value={colorMode}
              style={{ width: 180 }}
              onChange={(value) => setColorMode(value as GraphColorMode)}
              options={[
                { label: t("knowledge.graphQuery.colorModeType", "Type Coloring"), value: "type" },
                { label: t("knowledge.graphQuery.colorModeWeight", "Weight Heatmap"), value: "weight" },
              ]}
            />
            <Typography.Text type="secondary">{t("knowledge.graphQuery.edgeThreshold", "Edge threshold")}</Typography.Text>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={edgeStrengthThreshold}
              onChange={(value) => setEdgeStrengthThreshold(Number(value) || 0)}
              style={{ width: 220 }}
            />
            <Typography.Text className={styles.graphThresholdValue}>
              {Math.round(edgeStrengthThreshold * 100)}%
            </Typography.Text>
          </Space>
          <Space wrap className={styles.graphFocusBar}>
            <Typography.Text type="secondary">{t("knowledge.graphQuery.focusNode")}</Typography.Text>
            <Select
              showSearch
              allowClear
              size="small"
              value={focusedNodeId || undefined}
              placeholder={t("knowledge.graphQuery.focusNodePlaceholder")}
              options={nodeOptions.map((item) => ({
                label: item.label,
                value: item.value,
              }))}
              onChange={(value) => handleSelectNode((value as string) || null)}
              style={{ minWidth: 240 }}
              optionFilterProp="label"
            />
            <Button size="small" onClick={() => handleSelectNode(null)}>
              {t("knowledge.graphQuery.clearFocus")}
            </Button>
            <Space size={6}>
              <Typography.Text type="secondary">
                {t("knowledge.graphQuery.pathAutoFillFromClick")}
              </Typography.Text>
              <Switch
                size="small"
                checked={autoFillPathEndpoints}
                onChange={(checked) => setAutoFillPathEndpoints(checked)}
              />
            </Space>
          </Space>
          <Space wrap className={styles.graphPathBar}>
            <Typography.Text type="secondary">{t("knowledge.graphQuery.path")}</Typography.Text>
            {autoFillPathEndpoints ? (
              <Space size={6} className={styles.graphPathHintRow} wrap>
                {focusedNodeLabel ? (
                  <Tag className={styles.graphPathHintTag} color="processing">
                    {t("knowledge.graphQuery.pathRecentClick", {
                      node: focusedNodeLabel,
                    })}
                  </Tag>
                ) : null}
                <Tag className={styles.graphPathHintTag} color="blue">
                  {t("knowledge.graphQuery.pathAutoTarget", {
                    target: t(autoFillTargetKey),
                  })}
                </Tag>
              </Space>
            ) : null}
            <Select
              showSearch
              allowClear
              size="small"
              value={pathStartNodeId || undefined}
              placeholder={t("knowledge.graphQuery.pathStart")}
              options={nodeOptions.map((item) => ({
                label: item.label,
                value: item.value,
              }))}
              onChange={(value) => setPathStartNodeId((value as string) || null)}
              style={{ minWidth: 180 }}
              optionFilterProp="label"
            />
            <Button
              size="small"
              disabled={!focusedNodeId}
              onClick={() => {
                setPathStartNodeId(focusedNodeId);
              }}
            >
              {t("knowledge.graphQuery.pathSetStartFromFocus")}
            </Button>
            <Select
              showSearch
              allowClear
              size="small"
              value={pathEndNodeId || undefined}
              placeholder={t("knowledge.graphQuery.pathEnd")}
              options={nodeOptions.map((item) => ({
                label: item.label,
                value: item.value,
              }))}
              onChange={(value) => setPathEndNodeId((value as string) || null)}
              style={{ minWidth: 180 }}
              optionFilterProp="label"
            />
            <Button
              size="small"
              disabled={!focusedNodeId}
              onClick={() => {
                setPathEndNodeId(focusedNodeId);
              }}
            >
              {t("knowledge.graphQuery.pathSetEndFromFocus")}
            </Button>
            <Button
              size="small"
              icon={<SwapOutlined />}
              disabled={!pathStartNodeId && !pathEndNodeId}
              onClick={handleSwapPathEndpoints}
            >
              {t("knowledge.graphQuery.pathSwap")}
            </Button>
            <Button size="small" type="primary" onClick={handleFindPath}>
              {t("knowledge.graphQuery.pathFind")}
            </Button>
            <Button size="small" onClick={handleClearPath}>
              {t("knowledge.graphQuery.pathClear")}
            </Button>
          </Space>
          {pathNodeIds.length > 0 ? (
            <Space wrap className={styles.graphPathSummaryRow}>
              <Typography.Text type="secondary">
                {t("knowledge.graphQuery.pathSummaryLabel", {
                  hops: pathHopCount,
                })}
              </Typography.Text>
              <Space size={4} wrap>
                {pathNodeIds.map((nodeId, index) => (
                  <Space key={nodeId} size={4}>
                    <Button
                      size="small"
                      type="link"
                      className={styles.graphPathNodeLink}
                      onClick={() => {
                        handleSelectNode(nodeId);
                      }}
                    >
                      {nodeMap.get(nodeId)?.label || nodeId}
                    </Button>
                    {index < pathNodeIds.length - 1 ? (
                      <Typography.Text type="secondary">{">"}</Typography.Text>
                    ) : null}
                  </Space>
                ))}
              </Space>
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={() => {
                  void handleCopyPathSummary();
                }}
              >
                {t("knowledge.graphQuery.pathCopy")}
              </Button>
              <Button
                size="small"
                onClick={() => {
                  handleUsePathContext(false);
                }}
              >
                {t("knowledge.graphQuery.pathUseContext")}
              </Button>
              <Button
                size="small"
                type="primary"
                onClick={() => {
                  handleUsePathContext(true);
                }}
              >
                {t("knowledge.graphQuery.pathUseContextAndRun")}
              </Button>
            </Space>
          ) : null}
          {hotNodes.length > 0 ? (
            <Space wrap className={styles.graphHotNodesRow}>
              <Typography.Text type="secondary">{t("knowledge.graphQuery.hotNodes")}</Typography.Text>
              {hotNodes.map((item) => (
                <Tag
                  key={item.value}
                  className={styles.graphHotNodeTag}
                  color={focusedNodeId === item.value ? "processing" : "default"}
                  onClick={() => handleSelectNode(item.value)}
                >
                  {item.label}
                </Tag>
              ))}
            </Space>
          ) : null}
        </Space>
      </Modal>
    </Card>
  );
}
