import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Card,
  Empty,
  Input,
  Modal,
  message,
  Popover,
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
  graphEntityNodeId,
  getScoreColor,
  sortGraphQueryRecords,
  type GraphQueryRecordViewModel,
} from "./graphQuery";
import {
  buildGraphDisplayData,
  parseEdgeStrength,
  summarizeGraphEntities,
} from "./graphVisualizationData";
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
  compact?: boolean;
  frameless?: boolean;
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
  topK?: number;
  minTopK?: number;
  maxTopK?: number;
  onTopKChange?: (value: number) => void;
  onTopKCommit?: (value: number) => void;
  compact?: boolean;
  hideEntityDetail?: boolean;
  frameless?: boolean;
  hideToolbar?: boolean;
  onActionsReady?: (actions: {
    openSettings: () => void;
    refresh: () => void;
    exportData: () => void;
  } | null) => void;
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
  setOptions?: (options: unknown) => void;
  layout?: () => Promise<void>;
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
type GraphLayoutMode = "force-cluster" | "force-prevent-overlap" | "radial";

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
  return graphEntityNodeId(subject);
}

function resolveEventElementId(evt: unknown): string | null {
  if (!evt || typeof evt !== "object") {
    return null;
  }
  const raw = evt as { targetType?: string; target?: { id?: string | number } };
  if (raw.targetType && raw.targetType !== "node") {
    return null;
  }
  const candidate = String(raw.target?.id || "").trim();
  return candidate || null;
}

function resolveKnownNodeId(nodeId: string | null | undefined, nodeMap: Map<string, GraphNode>): string | null {
  if (!nodeId) {
    return null;
  }
  return nodeMap.has(nodeId) ? nodeId : null;
}

function filterRenderedElementState(
  stateMap: Record<string, string[]>,
  renderedNodeIds: Set<string>,
  renderedEdgeIds: Set<string>,
): Record<string, string[]> {
  const filtered: Record<string, string[]> = {};
  Object.entries(stateMap).forEach(([id, states]) => {
    if (renderedNodeIds.has(id) || renderedEdgeIds.has(id)) {
      filtered[id] = states;
    }
  });
  return filtered;
}

function buildStateMap(
  data: GraphTopologyData,
  focusedNodeId: string | null,
  neighborIds: Set<string>,
  filteredNodeIds: Set<string>,
  filteredEdgeIds: Set<string>,
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
      if (insightNodeIds.has(node.id)) {
        stateMap[node.id] = ["insight"];
        return;
      }
      stateMap[node.id] = filteredNodeIds.has(node.id) ? ["filtered"] : ["inactive"];
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
      if (insightEdgeIds.has(edge.id)) {
        stateMap[edge.id] = ["insight"];
        return;
      }
      stateMap[edge.id] = filteredEdgeIds.has(edge.id) ? ["filtered"] : ["inactive"];
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

function buildHoverStateMap(
  data: GraphTopologyData,
  hoveredNodeId: string,
  neighborIds: Set<string>,
  filteredNodeIds: Set<string>,
  filteredEdgeIds: Set<string>,
  pathNodeIds: Set<string>,
  pathEdgeIds: Set<string>,
  insightNodeIds: Set<string>,
  insightEdgeIds: Set<string>,
): Record<string, string[]> {
  const stateMap: Record<string, string[]> = {};

  data.nodes.forEach((node) => {
    if (pathNodeIds.has(node.id)) {
      stateMap[node.id] = ["path"];
      return;
    }
    if (node.id === hoveredNodeId) {
      stateMap[node.id] = ["hover"];
      return;
    }
    if (neighborIds.has(node.id)) {
      stateMap[node.id] = ["active"];
      return;
    }
    if (insightNodeIds.has(node.id)) {
      stateMap[node.id] = ["insight"];
      return;
    }
    stateMap[node.id] = filteredNodeIds.has(node.id) ? ["filtered"] : ["inactive"];
  });

  data.edges.forEach((edge) => {
    if (pathEdgeIds.has(edge.id)) {
      stateMap[edge.id] = ["path"];
      return;
    }
    const isConnected = edge.source === hoveredNodeId || edge.target === hoveredNodeId;
    if (isConnected) {
      stateMap[edge.id] = ["active"];
      return;
    }
    if (insightEdgeIds.has(edge.id)) {
      stateMap[edge.id] = ["insight"];
      return;
    }
    stateMap[edge.id] = filteredEdgeIds.has(edge.id) ? ["filtered"] : ["inactive"];
  });

  return stateMap;
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
  const w = Math.max(0, Math.min(1, weight));
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
  const w = Math.max(0, Math.min(1, weight));
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

function basenameLike(input: string): string {
  const text = String(input || "").trim();
  if (!text) {
    return "";
  }
  const slash = text.lastIndexOf("/");
  const backslash = text.lastIndexOf("\\");
  const splitIndex = Math.max(slash, backslash);
  return splitIndex >= 0 ? text.slice(splitIndex + 1) : text;
}

function shortenLabel(input: string, maxLength: number): string {
  const text = String(input || "").trim();
  if (!text) {
    return "";
  }
  const base = basenameLike(text);
  if (base.length <= maxLength) {
    return base;
  }
  return `${base.slice(0, Math.max(1, maxLength - 3))}...`;
}

function nodeVisualSizeFromScore(score: number): number {
  const s = Number.isFinite(score) ? score : 0;
  return 16 + Math.min(20, Math.max(0, s * 14));
}

function buildInitialSpreadPositions(
  count: number,
  width: number,
  height: number,
): Array<{ x: number; y: number }> {
  if (count <= 0) {
    return [];
  }

  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.max(80, Math.min(width, height) * 0.42);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  return Array.from({ length: count }, (_, index) => {
    const ratio = Math.sqrt((index + 1) / count);
    const radius = maxRadius * ratio;
    const theta = index * goldenAngle;
    return {
      x: centerX + Math.cos(theta) * radius,
      y: centerY + Math.sin(theta) * radius,
    };
  });
}

function resolveTopKSegmentStep(value: number): number {
  const v = Math.max(0, Math.floor(Number(value) || 0));
  if (v <= 120) {
    return 5;
  }
  if (v <= 320) {
    return 10;
  }
  if (v <= 640) {
    return 20;
  }
  if (v <= 1200) {
    return 50;
  }
  return 100;
}

function snapTopKBySegment(value: number): number {
  const safe = Math.max(0, Number(value) || 0);
  const step = resolveTopKSegmentStep(safe);
  return Math.round(safe / step) * step;
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

  const resultsBody = (
    <>
      {props.queryHeader}
      <Space
        direction="vertical"
        size={props.compact ? 8 : 12}
        style={{ width: "100%", marginBottom: props.compact ? 8 : 16 }}
      >
        <Space wrap size={props.compact ? 6 : 8} className={props.compact ? styles.graphQueryToolbarCompact : undefined}>
          <Input
            size={props.compact ? "small" : "middle"}
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            placeholder={t("knowledge.graphQuery.filterPlaceholder")}
            style={{ width: props.compact ? 220 : 260 }}
          />
          <Select
            size={props.compact ? "small" : "middle"}
            value={sortBy}
            onChange={setSortBy}
            options={[
              { label: "Score", value: "score" },
              { label: "Subject", value: "subject" },
              { label: "Document Title", value: "title" },
            ]}
            style={{ width: props.compact ? 130 : 150 }}
          />
          <Select
            size={props.compact ? "small" : "middle"}
            value={sortOrder}
            onChange={(value) => setSortOrder(value as "ascend" | "descend")}
            options={[
              { label: "Descending", value: "descend" },
              { label: "Ascending", value: "ascend" },
            ]}
            style={{ width: props.compact ? 112 : 120 }}
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

      </Space>

      {viewModels.records.length === 0 ? (
        <Empty description={t("knowledge.graphQuery.noResults")} />
      ) : (
        <div className={styles.graphQueryTableWrap}>
          <Table
            className={styles.graphQueryTable}
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
              size: "small",
              pageSize,
              onChange: (_, size) => setPageSize(size),
              showSizeChanger: true,
              showTotal: (total) => t("knowledge.graphQuery.resultsSummary", {
                count: total,
              }),
              pageSizeOptions: ["10", "20", "50", "100"],
            }}
            sticky={props.compact}
            size="small"
            scroll={{
              x: 1200,
              y: props.compact ? "calc(100% - 52px)" : undefined,
            }}
          />
        </div>
      )}
    </>
  );

  return (
    <div className={`${styles.graphQueryResults} ${props.compact ? styles.graphQueryResultsCompact : ""} ${props.frameless ? styles.graphQueryResultsFrameless : ""}`.trim()}>
      {props.frameless ? (
        <div className={styles.graphQueryResultsBody}>
          {resultsBody}
        </div>
      ) : (
        <Card
          className={props.compact ? styles.graphCardCompact : undefined}
          title={props.title || t("knowledge.graphQuery.results")}
          extra={
            <Space size={props.compact ? 4 : 8}>
              <Tooltip title={t("knowledge.graphQuery.refresh")}>
                <Button
                  size={props.compact ? "small" : "middle"}
                  icon={<ReloadOutlined />}
                  loading={props.loading}
                  onClick={props.onRefresh}
                />
              </Tooltip>
            </Space>
          }
          loading={props.loading}
          style={{ marginBottom: props.compact ? 0 : 16 }}
        >
          {resultsBody}
        </Card>
      )}
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
    topK,
    minTopK,
    maxTopK,
    onTopKChange,
    onTopKCommit,
    compact,
    hideEntityDetail,
    frameless,
    hideToolbar,
    onActionsReady,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<G6Graph | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const focusedNodeIdRef = useRef<string | null>(activeNodeId || null);
  const hoveredNodeIdRef = useRef<string | null>(null);
  const nodeMapRef = useRef<Map<string, GraphNode>>(new Map());
  const onNodeClickRef = useRef(onNodeClick);
  const onNodeHoverRef = useRef(onNodeHover);
  const onActiveNodeChangeRef = useRef(onActiveNodeChange);
  const renderedNodeIdsRef = useRef<Set<string>>(new Set());
  const renderedEdgeIdsRef = useRef<Set<string>>(new Set());
  const renderSequenceRef = useRef(0);
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
  const [pendingColorMode, setPendingColorMode] = useState<GraphColorMode>("type");
  const [pendingEdgeStrengthThreshold, setPendingEdgeStrengthThreshold] = useState(0);
  const [pendingTopK, setPendingTopK] = useState<number | null>(
    typeof topK === "number" ? topK : null,
  );
  const [layoutMode, setLayoutMode] = useState<GraphLayoutMode>("force-cluster");
  const [activeInsightKey, setActiveInsightKey] = useState("");
  const colorModeRef = useRef<GraphColorMode>("type");
  const nodeTypeColorMapRef = useRef<Map<string, string>>(new Map());
  const lastFocusStateKeyRef = useRef("");

  const buildLayoutConfig = useCallback((width: number, height: number) => {
    const nodeCount = data.nodes.length;
    const baseIterations = Math.min(240, Math.max(80, Math.round(60 + nodeCount * 1.2)));

    if (layoutMode === "force-prevent-overlap") {
      return {
        type: "d3-force",
        center: { x: width / 2, y: height / 2 },
        link: {
          distance: (edge: { source?: { data?: { visualSize?: number } }; target?: { data?: { visualSize?: number } } }) => {
            const sourceSize = Number(edge?.source?.data?.visualSize || 22);
            const targetSize = Number(edge?.target?.data?.visualSize || 22);
            return sourceSize + targetSize + 36;
          },
        },
        collide: {
          radius: (node: { data?: { visualSize?: number } }) => Number(node?.data?.visualSize || 22) + 16,
        },
        manyBody: {
          strength: (node: { data?: { visualSize?: number } }) => -7.5 * Number(node?.data?.visualSize || 22),
        },
        animation: false,
        iterations: Math.min(320, baseIterations + 80),
      };
    }

    if (layoutMode === "radial") {
      return {
        type: "radial",
        center: [width / 2, height / 2],
        unitRadius: Math.max(26, Math.min(width, height) / Math.max(8, Math.sqrt(nodeCount || 1) * 1.8)),
        linkDistance: 80,
        preventOverlap: true,
        nodeSize: (node: { data?: { visualSize?: number } }) => Number(node?.data?.visualSize || 22) + 6,
      };
    }

    return {
      type: "d3-force",
      center: { x: width / 2, y: height / 2 },
      link: {
        distance: (edge: { source?: { data?: { visualSize?: number } }; target?: { data?: { visualSize?: number } } }) => {
          const sourceSize = Number(edge?.source?.data?.visualSize || 22);
          const targetSize = Number(edge?.target?.data?.visualSize || 22);
          return sourceSize + targetSize + 26;
        },
      },
      collide: {
        radius: (node: { data?: { visualSize?: number } }) => Number(node?.data?.visualSize || 22) + 8,
      },
      manyBody: {
        strength: (node: { data?: { visualSize?: number } }) => -6 * Number(node?.data?.visualSize || 22),
      },
      animation: false,
      iterations: baseIterations,
    };
  }, [data.nodes.length, layoutMode]);

  const normalizeTopK = useCallback(
    (value: number) => {
      const minValue = Math.max(20, minTopK ?? 20);
      const maxValue = Math.max(minValue, maxTopK ?? minValue);
      const snapped = snapTopKBySegment(Number(value));
      return Math.max(minValue, Math.min(maxValue, snapped));
    },
    [maxTopK, minTopK],
  );

  const effectivePendingTopK = useMemo(() => {
    if (typeof topK !== "number") {
      return null;
    }
    const base = typeof pendingTopK === "number" ? pendingTopK : topK;
    return normalizeTopK(base);
  }, [normalizeTopK, pendingTopK, topK]);

  const hasPendingGraphSettings = useMemo(() => {
    const topKDirty = typeof topK === "number"
      && typeof effectivePendingTopK === "number"
      && effectivePendingTopK !== topK;
    return (
      pendingColorMode !== colorMode
      || pendingEdgeStrengthThreshold !== edgeStrengthThreshold
      || topKDirty
    );
  }, [colorMode, edgeStrengthThreshold, effectivePendingTopK, pendingColorMode, pendingEdgeStrengthThreshold, topK]);

  const applyPendingGraphSettings = useCallback((options?: { closeModal?: boolean; refreshQuery?: boolean }) => {
    const closeModal = options?.closeModal ?? false;
    const refreshQuery = options?.refreshQuery ?? true;
    setColorMode(pendingColorMode);
    setEdgeStrengthThreshold(pendingEdgeStrengthThreshold);

    if (typeof topK === "number" && typeof effectivePendingTopK === "number") {
      onTopKChange?.(effectivePendingTopK);
      if (refreshQuery) {
        onTopKCommit?.(effectivePendingTopK);
      }
    }

    if (closeModal) {
      setAdvancedSettingsOpen(false);
    }
  }, [effectivePendingTopK, onTopKChange, onTopKCommit, pendingColorMode, pendingEdgeStrengthThreshold, topK]);

  const resetPendingGraphSettings = useCallback(() => {
    setPendingColorMode(colorMode);
    setPendingEdgeStrengthThreshold(edgeStrengthThreshold);
    if (typeof topK === "number") {
      setPendingTopK(topK);
    }
  }, [colorMode, edgeStrengthThreshold, topK]);

  useEffect(() => {
    if (advancedSettingsOpen) {
      return;
    }
    setPendingColorMode(colorMode);
    setPendingEdgeStrengthThreshold(edgeStrengthThreshold);
    if (typeof topK === "number") {
      setPendingTopK(topK);
    }
  }, [advancedSettingsOpen, colorMode, edgeStrengthThreshold, topK]);

  const nodeTypeColorMap = useMemo(() => {
    const groups = Array.from(new Set(data.nodes.map((node) => getNodeGroupId(node.id, String(node.type || "")))));
    const map = new Map<string, string>();
    groups.forEach((group, index) => {
      map.set(group, colorByIndex(index));
    });
    return map;
  }, [data.nodes]);

  const graphData = useMemo(
    () => buildGraphDisplayData(data, 0),
    [data],
  );

  const filteredGraphData = useMemo(
    () => buildGraphDisplayData(data, edgeStrengthThreshold),
    [data, edgeStrengthThreshold],
  );

  const graphEntitySummary = useMemo(
    () => summarizeGraphEntities(filteredGraphData),
    [filteredGraphData],
  );

  const topKControl = typeof topK === "number" ? (
    <Space size={6} align="center">
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        TopK
      </Typography.Text>
      <Slider
        min={Math.max(20, minTopK ?? 20)}
        max={Math.max(Math.max(20, minTopK ?? 20), maxTopK ?? topK)}
        step={1}
        value={effectivePendingTopK ?? topK}
        onChange={(value) => {
          const next = normalizeTopK(Number(value));
          if (Number.isFinite(next)) {
            setPendingTopK(next);
          }
        }}
        style={{ width: compact ? 120 : 180, margin: 0 }}
        tooltip={{ open: false }}
      />
      <Typography.Text style={{ fontSize: 12, minWidth: 36, textAlign: "right" }}>
        {effectivePendingTopK ?? topK}
      </Typography.Text>
    </Space>
  ) : null;

  const filteredEdgeIds = useMemo(
    () => new Set(filteredGraphData.edges.map((edge) => edge.id)),
    [filteredGraphData.edges],
  );

  const filteredNodeIds = useMemo(() => {
    if (edgeStrengthThreshold <= 0) {
      return new Set(graphData.nodes.map((node) => node.id));
    }
    return new Set(filteredGraphData.connectedNodeIds);
  }, [edgeStrengthThreshold, filteredGraphData.connectedNodeIds, graphData.nodes]);

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

  const topEntities = useMemo(
    () => graphEntitySummary.topEntities,
    [graphEntitySummary.topEntities],
  );

  const provenanceEngine = useMemo(
    () => String((data.provenance as Record<string, unknown>)?.engine || ""),
    [data.provenance],
  );

  const provenanceLayer = useMemo(
    () => String((data.provenance as Record<string, unknown>)?.layer || ""),
    [data.provenance],
  );

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

  useEffect(() => {
    focusedNodeIdRef.current = focusedNodeId;
  }, [focusedNodeId]);

  useEffect(() => {
    nodeMapRef.current = nodeMap;
  }, [nodeMap]);

  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
  }, [onNodeClick]);

  useEffect(() => {
    onNodeHoverRef.current = onNodeHover;
  }, [onNodeHover]);

  useEffect(() => {
    onActiveNodeChangeRef.current = onActiveNodeChange;
  }, [onActiveNodeChange]);

  useEffect(() => {
    colorModeRef.current = colorMode;
  }, [colorMode]);

  useEffect(() => {
    nodeTypeColorMapRef.current = nodeTypeColorMap;
  }, [nodeTypeColorMap]);

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
    setFocusedNodeId((prev) => {
      const next = resolveKnownNodeId(activeNodeId || null, nodeMap);
      return prev === next ? prev : next;
    });
  }, [activeNodeId, nodeMap]);

  const updateFocusState = useCallback(
    async (nodeId: string | null, shouldFocusElement: boolean) => {
      if (!graphRef.current) {
        return;
      }
      const resolvedNodeId = resolveKnownNodeId(nodeId, nodeMap);
      const focusKey = [
        resolvedNodeId || "",
        pathNodeIds.join(","),
        pathEdgeIds.join(","),
        (activeInsight?.nodeIds || []).join(","),
        (activeInsight?.edgeIds || []).join(","),
        String(filteredNodeIds.size),
        String(filteredEdgeIds.size),
      ].join("|");
      if (!shouldFocusElement && focusKey === lastFocusStateKeyRef.current) {
        return;
      }
      const pathNodeSet = new Set(pathNodeIds);
      const pathEdgeSet = new Set(pathEdgeIds);
      const insightNodeSet = new Set(activeInsight?.nodeIds || []);
      const insightEdgeSet = new Set(activeInsight?.edgeIds || []);
      if (!resolvedNodeId) {
        const resetState = buildStateMap(
          graphData,
          null,
          new Set<string>(),
          filteredNodeIds,
          filteredEdgeIds,
          pathNodeSet,
          pathEdgeSet,
          insightNodeSet,
          insightEdgeSet,
        );
          const renderedResetState = filterRenderedElementState(
            resetState,
            renderedNodeIdsRef.current,
            renderedEdgeIdsRef.current,
          );
          if (Object.keys(renderedResetState).length > 0) {
            await graphRef.current.setElementState(renderedResetState, false);
          }
        lastFocusStateKeyRef.current = focusKey;
        return;
      }

      const neighbors = new Set(
        graphRef.current
          .getNeighborNodesData(resolvedNodeId)
          .map((item) => String(item.id || ""))
          .filter(Boolean),
      );
      const stateMap = buildStateMap(
        graphData,
        resolvedNodeId,
        neighbors,
        filteredNodeIds,
        filteredEdgeIds,
        pathNodeSet,
        pathEdgeSet,
        insightNodeSet,
        insightEdgeSet,
      );
      const renderedStateMap = filterRenderedElementState(
        stateMap,
        renderedNodeIdsRef.current,
        renderedEdgeIdsRef.current,
      );
      if (Object.keys(renderedStateMap).length > 0) {
        await graphRef.current.setElementState(renderedStateMap, false);
      }
      lastFocusStateKeyRef.current = focusKey;

      if (shouldFocusElement && renderedNodeIdsRef.current.has(resolvedNodeId)) {
        await graphRef.current.focusElement(resolvedNodeId, { duration: 300 });
      }
    },
    [activeInsight?.edgeIds, activeInsight?.nodeIds, filteredEdgeIds, filteredNodeIds, graphData, nodeMap, pathEdgeIds, pathNodeIds],
  );

  const updateFocusStateRef = useRef(updateFocusState);

  useEffect(() => {
    updateFocusStateRef.current = updateFocusState;
  }, [updateFocusState]);

  const updateHoverState = useCallback(async (nodeId: string | null) => {
    if (!graphRef.current) {
      return;
    }
    const resolvedNodeId = resolveKnownNodeId(nodeId, nodeMap);
    if (!resolvedNodeId) {
      await updateFocusStateRef.current(focusedNodeIdRef.current, false);
      return;
    }

    const pathNodeSet = new Set(pathNodeIds);
    const pathEdgeSet = new Set(pathEdgeIds);
    const insightNodeSet = new Set(activeInsight?.nodeIds || []);
    const insightEdgeSet = new Set(activeInsight?.edgeIds || []);
    const neighbors = new Set(
      graphRef.current
        .getNeighborNodesData(resolvedNodeId)
        .map((item) => String(item.id || ""))
        .filter(Boolean),
    );
    const stateMap = buildHoverStateMap(
      graphData,
      resolvedNodeId,
      neighbors,
      filteredNodeIds,
      filteredEdgeIds,
      pathNodeSet,
      pathEdgeSet,
      insightNodeSet,
      insightEdgeSet,
    );
    const renderedStateMap = filterRenderedElementState(
      stateMap,
      renderedNodeIdsRef.current,
      renderedEdgeIdsRef.current,
    );
    if (Object.keys(renderedStateMap).length > 0) {
      await graphRef.current.setElementState(renderedStateMap, false);
    }
  }, [activeInsight?.edgeIds, activeInsight?.nodeIds, filteredEdgeIds, filteredNodeIds, graphData, nodeMap, pathEdgeIds, pathNodeIds]);

  const updateHoverStateRef = useRef(updateHoverState);

  useEffect(() => {
    updateHoverStateRef.current = updateHoverState;
  }, [updateHoverState]);

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `knowledge-graph-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [data]);

  const handleOpenSettings = useCallback(() => {
    setAdvancedSettingsOpen(true);
  }, []);

  const handleRefreshGraph = useCallback(() => {
    applyPendingGraphSettings({ refreshQuery: true });
  }, [applyPendingGraphSettings]);

  useEffect(() => {
    onActionsReady?.({
      openSettings: handleOpenSettings,
      refresh: handleRefreshGraph,
      exportData: handleExport,
    });
    return () => {
      onActionsReady?.(null);
    };
  }, [handleExport, handleOpenSettings, handleRefreshGraph, onActionsReady]);

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
      if (!nextNodeId) {
        return;
      }
      const found = nodeMap.get(nextNodeId);
      if (found) {
        onNodeClick?.(found);
      }
    },
    [nodeMap, onActiveNodeChange, onNodeClick],
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
  }, [
    graphData.edges,
    edgeLookup,
    onActiveNodeChange,
    pathEndNodeId,
    pathStartNodeId,
    t,
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

  const handleAutoFillPathFromClickRef = useRef(handleAutoFillPathFromClick);

  useEffect(() => {
    handleAutoFillPathFromClickRef.current = handleAutoFillPathFromClick;
  }, [handleAutoFillPathFromClick]);

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
      const renderSequence = renderSequenceRef.current + 1;
      renderSequenceRef.current = renderSequence;

      const width = containerRef.current.clientWidth || 800;
      const height = Math.max(320, containerRef.current.clientHeight || 440);
      const initialPositions = buildInitialSpreadPositions(
        graphData.nodes.length,
        width,
        height,
      );
      const g6Data = {
          nodes: graphData.nodes.map((node, index) => ({
          id: node.id,
          x: initialPositions[index]?.x,
          y: initialPositions[index]?.y,
          data: {
            label: node.label,
            score: Number(node.score || 0),
            visualSize: nodeVisualSizeFromScore(Number(node.score || 0)),
            type: node.type,
            source_id: node.source_id,
            document_path: node.document_path,
              isIsolated: graphData.isolatedNodeIds.includes(node.id),
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
          padding: 24,
          data: g6Data,
          layout: buildLayoutConfig(width, height),
          behaviors: [
            "drag-canvas",
            "zoom-canvas",
            "drag-element",
            {
              type: "hover-activate",
              enable: (e: { targetType?: string }) => e?.targetType === "node",
              degree: 1,
              inactiveState: "inactive",
            },
            {
              type: "fix-element-size",
              keyShape: true,
              label: true,
            },
          ],
          animation: false,
          node: {
            type: "circle",
            style: (datum: {
              data?: { label?: string; score?: number; visualSize?: number; type?: string; isIsolated?: boolean };
            }) => {
              const score = Number(datum?.data?.score || 0);
              const group = getNodeGroupId("", String(datum?.data?.type || ""));
              const isIsolated = Boolean(datum?.data?.isIsolated);
              const currentColorMode = colorModeRef.current;
              const baseFill =
                currentColorMode === "type"
                  ? nodeTypeColorMapRef.current.get(group) || "#1677ff"
                  : buildWeightColor(score);
              const size = Number(datum?.data?.visualSize || nodeVisualSizeFromScore(score));
              const rawLabel = String(datum?.data?.label || "");
              const displayLabel = shortenLabel(rawLabel, 24);
              return {
                size,
                lineWidth: 1,
                fill: `${baseFill}${isIsolated ? "14" : "22"}`,
                stroke: baseFill,
                labelText: displayLabel,
                labelPlacement: "bottom",
                labelFontSize: 11,
                opacity: isIsolated ? 0.55 : 1,
                lineDash: isIsolated ? [4, 3] : undefined,
                cursor: "pointer",
              };
            },
            state: {
              inactive: {
                opacity: 0.6,
              },
              filtered: {
                lineWidth: 2,
                stroke: "#1677ff",
                opacity: 1,
              },
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
              const rawEdgeLabel = String(datum?.data?.label || "");
              const displayEdgeLabel = shortenLabel(rawEdgeLabel, 18);
              return {
              stroke: buildEdgeColor(strength),
              lineWidth: 0.8 + strength * 2,
              endArrow: true,
              labelText: displayEdgeLabel,
              labelBackground: true,
              labelFontSize: 10,
              labelFill: "#8c8c8c",
            };
            },
            state: {
              inactive: {
                opacity: 0.32,
              },
              filtered: {
                stroke: "#1677ff",
                lineWidth: 1.6,
                opacity: 0.95,
              },
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
          if (nodeId && !nodeMapRef.current.has(nodeId)) {
            return;
          }
          onNodeHoverRef.current?.(nodeId);
          if (!nodeId || hoveredNodeIdRef.current === nodeId) {
            return;
          }
          hoveredNodeIdRef.current = nodeId;
          if (!nodeId || focusedNodeIdRef.current) {
            return;
          }
          await updateHoverStateRef.current(nodeId);
        });

        graph.on("node:mouseleave", async () => {
          if (!hoveredNodeIdRef.current) {
            return;
          }
          hoveredNodeIdRef.current = null;
          onNodeHoverRef.current?.(null);
          await updateHoverStateRef.current(null);
        });

        graph.on("node:click", async (evt: unknown) => {
          const nodeId = resolveEventElementId(evt);
          if (!nodeId || !nodeMapRef.current.has(nodeId)) {
            return;
          }
          handleAutoFillPathFromClickRef.current(nodeId);
          setFocusedNodeId(nodeId);
          onActiveNodeChangeRef.current?.(nodeId);
          const found = nodeMapRef.current.get(nodeId);
          if (found) {
            onNodeClickRef.current?.(found);
          }
        });

        graphRef.current = graph;
        await graphRef.current.render();
      } else {
        graphRef.current.setData(g6Data);
        graphRef.current.setOptions?.({ layout: buildLayoutConfig(width, height) });
        await graphRef.current.layout?.();
        await graphRef.current.render();
      }

      if (unmounted || renderSequence !== renderSequenceRef.current) {
        return;
      }

      renderedNodeIdsRef.current = new Set(g6Data.nodes.map((node) => node.id));
      renderedEdgeIdsRef.current = new Set(g6Data.edges.map((edge) => edge.id));
      await updateFocusStateRef.current(focusedNodeIdRef.current, false);

      if (!resizeObserverRef.current && containerRef.current) {
        resizeObserverRef.current = new ResizeObserver((entries) => {
          if (!graphRef.current || !entries.length) {
            return;
          }
          const box = entries[0].contentRect;
          graphRef.current.setSize(
            Math.max(320, box.width),
            Math.max(320, box.height || containerRef.current?.clientHeight || 440),
          );
        });
        resizeObserverRef.current.observe(containerRef.current);
      }
    };

    void renderGraph();

    return () => {
      unmounted = true;
    };
  }, [
    buildLayoutConfig,
    graphData,
    colorMode,
    nodeTypeColorMap,
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
    if (frameless) {
      return (
        <>
          <div className={styles.graphFramelessRoot}>
            <Empty description={edgeStrengthThreshold > 0 ? t("knowledge.graphQuery.noVisualizationAfterFilter", "No graph data after threshold filter") : t("knowledge.graphQuery.noVisualization")} />
          </div>
          <Modal
            title={t("knowledge.graphQuery.advancedSettings", "高级设置")}
            open={advancedSettingsOpen}
            onCancel={() => {
              resetPendingGraphSettings();
              setAdvancedSettingsOpen(false);
            }}
            footer={(
              <Space>
                <Button
                  onClick={() => {
                    resetPendingGraphSettings();
                  }}
                >
                  {t("common.reset", "重置")}
                </Button>
                <Button
                  type="primary"
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    applyPendingGraphSettings({ closeModal: true, refreshQuery: true });
                  }}
                >
                  {t("knowledge.graphQuery.applyAndRefresh", "应用并刷新")}
                </Button>
              </Space>
            )}
            width={960}
          >
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <Space wrap className={styles.graphAdvancedRow}>
                <Typography.Text type="secondary">{t("knowledge.graphQuery.colorMode", "Color Mode")}</Typography.Text>
                <Select
                  size="small"
                  value={pendingColorMode}
                  style={{ width: 180 }}
                  onChange={(value) => setPendingColorMode(value as GraphColorMode)}
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
                  value={pendingEdgeStrengthThreshold}
                  onChange={(value) => setPendingEdgeStrengthThreshold(Number(value) || 0)}
                  style={{ width: 220 }}
                />
                <Typography.Text className={styles.graphThresholdValue}>
                  {Math.round(pendingEdgeStrengthThreshold * 100)}%
                </Typography.Text>
              </Space>
            </Space>
          </Modal>
        </>
      );
    }
    return (
      <Card
        title={hideToolbar ? undefined : t("knowledge.graphQuery.visualization")}
        loading={loading}
        className={`${compact ? styles.graphCardCompact : ""} ${frameless ? styles.graphCardFrameless : ""}`.trim()}
      >
        <Empty description={edgeStrengthThreshold > 0 ? t("knowledge.graphQuery.noVisualizationAfterFilter", "No graph data after threshold filter") : t("knowledge.graphQuery.noVisualization")} />
      </Card>
    );
  }

  const statusPopoverContent = (
    <div className={styles.graphStatusPanel}>
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
        {t("knowledge.graphQuery.nodes")}: {graphEntitySummary.totalNodes} | {t("knowledge.graphQuery.edges")}: {filteredGraphData.edges.length}/{graphData.edges.length}
      </Typography.Text>
      {(provenanceEngine || provenanceLayer) ? (
        <Typography.Text type="secondary" className={styles.graphSummaryText}>
          Engine: {provenanceEngine || "-"}
          {provenanceLayer ? ` | Layer: ${provenanceLayer}` : ""}
        </Typography.Text>
      ) : null}
      <div className={styles.graphEntityStatsRow}>
        <span className={styles.graphEntityStatPill}>
          {t("knowledge.graphQuery.totalEntities", "Total Entities")}: {graphEntitySummary.totalNodes}
        </span>
        <span className={styles.graphEntityStatPill}>
          {t("knowledge.graphQuery.connectedEntities", "Connected")}: {graphEntitySummary.connectedNodes}
        </span>
        <span className={styles.graphEntityStatPill}>
          {t("knowledge.graphQuery.isolatedEntities", "Isolated")}: {graphEntitySummary.isolatedNodes}
        </span>
        {edgeStrengthThreshold > 0 ? (
          <span className={styles.graphEntityStatPill}>
            {t("knowledge.graphQuery.thresholdApplied", "Threshold")}: {Math.round(edgeStrengthThreshold * 100)}%
          </span>
        ) : null}
      </div>
      {topEntities.length > 0 ? (
        <Space wrap className={styles.graphHotNodesRow}>
          <Typography.Text type="secondary">
            {t("knowledge.graphQuery.topEntities", "Top Entities")}
          </Typography.Text>
          {topEntities.map((item) => (
            <Tag
              key={item.id}
              className={styles.graphHotNodeTag}
              color={focusedNodeId === item.id ? "processing" : "default"}
              onClick={() => handleSelectNode(item.id)}
            >
              {item.label} · {item.degree}
            </Tag>
          ))}
        </Space>
      ) : null}
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
    </div>
  );

  const toolbar = (
    <Space size={compact ? 4 : 8}>
      <Tooltip title={t("knowledge.graphQuery.zoomIn")}>
        <Button size={compact ? "small" : "middle"} icon={<PlusOutlined />} onClick={handleZoomIn}>
          {compact ? null : t("knowledge.graphQuery.zoomIn")}
        </Button>
      </Tooltip>
      <Tooltip title={t("knowledge.graphQuery.zoomOut")}>
        <Button size={compact ? "small" : "middle"} icon={<MinusOutlined />} onClick={handleZoomOut}>
          {compact ? null : t("knowledge.graphQuery.zoomOut")}
        </Button>
      </Tooltip>
      <Tooltip title={t("knowledge.graphQuery.fitView")}>
        <Button size={compact ? "small" : "middle"} icon={<AimOutlined />} onClick={handleFitView}>
          {compact ? null : t("knowledge.graphQuery.fitView")}
        </Button>
      </Tooltip>
      {!compact ? topKControl : null}
      <Popover
        trigger="hover"
        placement="bottomRight"
        overlayClassName={styles.graphStatusPopover}
        content={statusPopoverContent}
      >
        <Button size={compact ? "small" : "middle"}>
          {t("knowledge.graphQuery.status", "状态")}
        </Button>
      </Popover>
      <Tooltip title={t("knowledge.graphQuery.advancedSettings", "高级设置")}>
        <Button size={compact ? "small" : "middle"} onClick={handleOpenSettings}>
          {compact ? t("knowledge.graphQuery.advancedSettingsShort", "设置") : t("knowledge.graphQuery.advancedSettings", "高级设置")}
        </Button>
      </Tooltip>
      <Tooltip title={t("knowledge.graphQuery.refresh", "刷新")}>
        <Button
          size={compact ? "small" : "middle"}
          type={hasPendingGraphSettings ? "primary" : "default"}
          icon={<ReloadOutlined />}
          onClick={handleRefreshGraph}
        >
          {compact ? null : t("knowledge.graphQuery.refresh", "刷新")}
        </Button>
      </Tooltip>
      <Tooltip title={t("knowledge.graphQuery.export")}>
        <Button size={compact ? "small" : "middle"} icon={<ExportOutlined />} onClick={handleExport}>
          {compact ? null : t("knowledge.graphQuery.export")}
        </Button>
      </Tooltip>
      <Select
        size={compact ? "small" : "middle"}
        value={layoutMode}
        style={{ width: compact ? 150 : 180 }}
        onChange={(value) => setLayoutMode(value as GraphLayoutMode)}
        options={[
          { label: t("knowledge.graphQuery.layoutForceCluster", "Force聚类"), value: "force-cluster" },
          { label: t("knowledge.graphQuery.layoutForcePreventOverlap", "力导向（防重叠）"), value: "force-prevent-overlap" },
          { label: t("knowledge.graphQuery.layoutRadial", "径向布局"), value: "radial" },
        ]}
        aria-label={t("knowledge.graphQuery.layoutMode", "布局模式")}
      />
    </Space>
  );

  const graphBody = (
    <>
      <div className={styles.graphCanvasStage}>
        <div className={styles.graphCanvasWrap}>
          <div ref={containerRef} className={styles.graphCanvas} />
        </div>
        {hideToolbar ? null : (
          <div className={styles.graphFloatingToolbar}>
            {toolbar}
          </div>
        )}
      </div>
      {focusedNodeId && !hideEntityDetail ? (
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
    </>
  );

  return (
    <>
      {frameless ? (
        <div className={styles.graphFramelessRoot}>
          {graphBody}
        </div>
      ) : (
        <Card
          className={compact ? styles.graphCardCompact : undefined}
          title={compact ? topKControl : t("knowledge.graphQuery.visualization")}
          loading={loading}
        >
          {graphBody}
        </Card>
      )}
      <Modal
        title={t("knowledge.graphQuery.advancedSettings", "高级设置")}
        open={advancedSettingsOpen}
        onCancel={() => {
          resetPendingGraphSettings();
          setAdvancedSettingsOpen(false);
        }}
        footer={(
          <Space>
            <Button
              onClick={() => {
                resetPendingGraphSettings();
              }}
            >
              {t("common.reset", "重置")}
            </Button>
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              onClick={() => {
                applyPendingGraphSettings({ closeModal: true, refreshQuery: true });
              }}
            >
              {t("knowledge.graphQuery.applyAndRefresh", "应用并刷新")}
            </Button>
          </Space>
        )}
        width={960}
      >
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <Space wrap className={styles.graphAdvancedRow}>
            <Typography.Text type="secondary">{t("knowledge.graphQuery.colorMode", "Color Mode")}</Typography.Text>
            <Select
              size="small"
              value={pendingColorMode}
              style={{ width: 180 }}
              onChange={(value) => setPendingColorMode(value as GraphColorMode)}
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
              value={pendingEdgeStrengthThreshold}
              onChange={(value) => setPendingEdgeStrengthThreshold(Number(value) || 0)}
              style={{ width: 220 }}
            />
            <Typography.Text className={styles.graphThresholdValue}>
              {Math.round(pendingEdgeStrengthThreshold * 100)}%
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
          {topEntities.length > 0 ? (
            <Space wrap className={styles.graphHotNodesRow}>
              <Typography.Text type="secondary">{t("knowledge.graphQuery.topEntities", "Top Entities")}</Typography.Text>
              {topEntities.map((item) => (
                <Tag
                  key={item.id}
                  className={styles.graphHotNodeTag}
                  color={focusedNodeId === item.id ? "processing" : "default"}
                  onClick={() => handleSelectNode(item.id)}
                >
                  {item.label} · {item.degree}
                </Tag>
              ))}
            </Space>
          ) : null}
        </Space>
      </Modal>
    </>
  );
}
