import { useEffect, useMemo, useRef, useState } from "react";
import {
  Card,
  Empty,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Button,
  Typography,
} from "antd";
import { ExportOutlined, ReloadOutlined } from "@ant-design/icons";
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
  loading?: boolean;
  onRefresh?: () => void;
}

interface GraphVisualizationProps {
  data: GraphVisualizationData;
  loading?: boolean;
  onNodeClick?: (node: GraphNode) => void;
  onNodeHover?: (nodeId: string | null) => void;
}

interface G6Graph {
  setData: (data: unknown) => void;
  render: () => Promise<void>;
  destroy: () => void;
  setSize: (width: number, height: number) => void;
  on: (event: string, handler: (evt: unknown) => void) => void;
  setElementState: (state: Record<string, string[]>, animation?: boolean) => Promise<void>;
  focusElement: (id: string, animation?: unknown) => Promise<void>;
  getNeighborNodesData: (id: string) => Array<{ id?: string | number }>;
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
        title={t("knowledge.graphQuery.results")}
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
            {t("knowledge.graphQuery.resultsSummary", { count: viewModels.recordCount })}
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

function resolveEventElementId(evt: unknown): string | null {
  if (!evt || typeof evt !== "object") {
    return null;
  }
  const raw = evt as { target?: { id?: string } };
  return raw.target?.id || null;
}

function buildStateMap(
  data: GraphVisualizationData,
  focusedNodeId: string | null,
  neighborIds: Set<string>,
): Record<string, string[]> {
  const stateMap: Record<string, string[]> = {};

  data.nodes.forEach((node) => {
    if (!focusedNodeId) {
      stateMap[node.id] = [];
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
      stateMap[edge.id] = [];
      return;
    }
    const isConnected = edge.source === focusedNodeId || edge.target === focusedNodeId;
    stateMap[edge.id] = isConnected ? ["active"] : ["dim"];
  });

  return stateMap;
}

export function GraphVisualization(props: GraphVisualizationProps) {
  const { t } = useTranslation();
  const { data, loading, onNodeClick, onNodeHover } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<G6Graph | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const nodeMap = useMemo(() => {
    const map = new Map<string, GraphNode>();
    data.nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [data.nodes]);

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

  useEffect(() => {
    let unmounted = false;

    const renderGraph = async () => {
      if (!containerRef.current || !data.nodes.length) {
        return;
      }

      const width = containerRef.current.clientWidth || 800;
      const height = 440;
      const g6Data = {
        nodes: data.nodes.map((node) => ({
          id: node.id,
          data: {
            label: node.label,
            score: Number(node.score || 0),
            type: node.type,
            source_id: node.source_id,
            document_path: node.document_path,
          },
        })),
        edges: data.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          data: {
            label: edge.label,
            confidence: edge.confidence || "",
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
            style: (datum: { data?: { label?: string; score?: number; type?: string } }) => {
              const score = Number(datum?.data?.score || 0);
              const size = 22 + Math.min(30, Math.max(0, score * 20));
              return {
                size,
                lineWidth: 1,
                fill: "#e6f4ff",
                stroke: "#1677ff",
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
              hover: {
                lineWidth: 3,
                stroke: "#fa8c16",
              },
            },
          },
          edge: {
            type: "line",
            style: (datum: { data?: { label?: string } }) => ({
              stroke: "#d9d9d9",
              lineWidth: 1,
              endArrow: true,
              labelText: datum?.data?.label || "",
              labelBackground: true,
              labelFontSize: 10,
              labelFill: "#8c8c8c",
            }),
            state: {
              dim: {
                opacity: 0.12,
              },
              active: {
                stroke: "#1677ff",
                opacity: 1,
                lineWidth: 1.4,
              },
            },
          },
        }) as unknown as G6Graph;

        graph.on("node:mouseenter", async (evt: unknown) => {
          const nodeId = resolveEventElementId(evt);
          onNodeHover?.(nodeId);
          if (!nodeId || !graphRef.current) {
            return;
          }
          const neighbors = new Set(
            graphRef.current
              .getNeighborNodesData(nodeId)
              .map((item) => String(item.id || ""))
              .filter(Boolean),
          );
          const stateMap = buildStateMap(data, nodeId, neighbors);
          await graphRef.current.setElementState(stateMap, false);
        });

        graph.on("node:mouseleave", async () => {
          onNodeHover?.(null);
          if (!graphRef.current) {
            return;
          }
          const resetState = buildStateMap(data, null, new Set<string>());
          await graphRef.current.setElementState(resetState, false);
        });

        graph.on("node:click", async (evt: unknown) => {
          const nodeId = resolveEventElementId(evt);
          if (!nodeId || !graphRef.current) {
            return;
          }
          await graphRef.current.focusElement(nodeId, {
            duration: 300,
          });
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
  }, [data, nodeMap, onNodeClick, onNodeHover]);

  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      graphRef.current?.destroy();
      graphRef.current = null;
    };
  }, []);

  if (!data.nodes.length) {
    return (
      <Card title={t("knowledge.graphQuery.visualization")} loading={loading}>
        <Empty description={t("knowledge.graphQuery.noVisualization")} />
      </Card>
    );
  }

  return (
    <Card
      title={t("knowledge.graphQuery.visualization")}
      extra={
        <Space>
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
      <Typography.Text type="secondary" className={styles.graphSummaryText}>
        {t("knowledge.graphQuery.nodes")}: {data.nodes.length} | {t("knowledge.graphQuery.edges")}: {data.edges.length}
      </Typography.Text>
    </Card>
  );
}
