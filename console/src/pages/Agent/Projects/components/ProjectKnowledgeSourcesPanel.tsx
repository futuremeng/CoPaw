import { Button, Table, Tabs, Tooltip, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { AgentProjectFileInfo } from "../../../../api/types/agents";
import styles from "../index.module.less";
import { formatFileSize } from "../utils/metrics";
import type { ProjectKnowledgeState } from "../hooks/useProjectKnowledgeState";
import {
  buildKnowledgeSourceRows,
  classifyKnowledgeSourceCategory,
  isExcludedKnowledgeSourcePath,
  type ProjectKnowledgeSourceRow,
  normalizeKnowledgeSourcePath,
} from "../utils/projectKnowledgeSourceRows";

function formatTime(value?: string): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatCandidateLabel(value?: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "-";
  }
  return normalized
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

interface ProjectKnowledgeSourcesPanelProps {
  knowledgeState: ProjectKnowledgeState;
  projectFiles: AgentProjectFileInfo[];
  onOpenProcessingForSource?: (sourceId: string) => void;
}

export default function ProjectKnowledgeSourcesPanel(props: ProjectKnowledgeSourcesPanelProps) {
  const { t } = useTranslation();
  const { knowledgeState, projectFiles, onOpenProcessingForSource } = props;
  const discoveredRows = buildKnowledgeSourceRows((projectFiles || []).filter((item) => !item.builtin && !item.ignored));
  const backendCandidateRows: ProjectKnowledgeSourceRow[] = Array.isArray(knowledgeState.projectSourceCandidates)
    ? knowledgeState.projectSourceCandidates
      .map((item, index) => {
        const path = normalizeKnowledgeSourcePath(String(item?.path || ""));
        if (!path || isExcludedKnowledgeSourcePath(path)) {
          return null;
        }
        const category = ["document", "structured", "image"].includes(String(item?.category || ""))
          ? String(item?.category || "") as "document" | "structured" | "image"
          : classifyKnowledgeSourceCategory(path);
        return {
          key: `candidate-${path}-${index}`,
          path,
          title: path.split("/").slice(-1)[0] || path,
          stage: formatCandidateLabel(String(item?.stage || "other")),
          contentType: formatCandidateLabel(String(item?.content_type || "other")),
          size: Math.max(0, Number(item?.size_bytes || 0)),
          modifiedTime: String(item?.modified_time || "").trim(),
          category,
        };
      })
      .filter((item): item is ProjectKnowledgeSourceRow => Boolean(item))
    : [];

  const candidateBaseRows = backendCandidateRows.length > 0 ? backendCandidateRows : discoveredRows;

  const sourceIdByPath = new Map<string, string>();
  const manualPathSet = new Set<string>();
  for (const source of knowledgeState.projectSources) {
    const sourceId = String(source.id || "").trim();
    if (!sourceId) {
      continue;
    }
    const location = normalizeKnowledgeSourcePath(source.location);
    if (location) {
      sourceIdByPath.set(location, sourceId);
      sourceIdByPath.set(location.split("/").slice(-1)[0] || location, sourceId);
      manualPathSet.add(location);
    }
    const name = normalizeKnowledgeSourcePath(source.name);
    if (name) {
      sourceIdByPath.set(name, sourceId);
    }
  }

  const candidateRows = candidateBaseRows.filter((row) => !manualPathSet.has(normalizeKnowledgeSourcePath(row.path)));

  const candidateByPath = new Map<string, ProjectKnowledgeSourceRow>();
  for (const row of candidateRows) {
    const key = normalizeKnowledgeSourcePath(row.path);
    if (key) {
      candidateByPath.set(key, row);
    }
  }

  const manualMetaByPath = new Map<string, {
    category: "document" | "structured" | "image";
    stage: string;
    contentType: string;
    size: number;
    modifiedTime: string;
  }>();
  for (const item of knowledgeState.projectManualSources || []) {
    const normalizedPath = normalizeKnowledgeSourcePath(String(item.path || ""));
    if (!normalizedPath) {
      continue;
    }
    manualMetaByPath.set(normalizedPath, {
      category: ["document", "structured", "image"].includes(String(item.category || ""))
        ? String(item.category || "") as "document" | "structured" | "image"
        : classifyKnowledgeSourceCategory(normalizedPath),
      stage: formatCandidateLabel(String(item.stage || "other")),
      contentType: formatCandidateLabel(String(item.content_type || "other")),
      size: Math.max(0, Number(item.size_bytes || 0)),
      modifiedTime: String(item.modified_time || "").trim(),
    });
  }

  const manualRows: ProjectKnowledgeSourceRow[] = knowledgeState.projectSources.map((source) => {
    const path = normalizeKnowledgeSourcePath(String(source.location || source.id || ""));
    const manualMeta = path ? manualMetaByPath.get(path) : undefined;
    const fromCandidate = path ? candidateByPath.get(path) : undefined;
    return {
      key: path || String(source.id || source.name || ""),
      path,
      title: String(source.name || path),
      stage: manualMeta?.stage || fromCandidate?.stage || "manual",
      contentType: manualMeta?.contentType || fromCandidate?.contentType || "-",
      size: manualMeta?.size || fromCandidate?.size || 0,
      modifiedTime: manualMeta?.modifiedTime || fromCandidate?.modifiedTime,
      category: manualMeta?.category || fromCandidate?.category || classifyKnowledgeSourceCategory(path),
    };
  }).filter((row) => !isExcludedKnowledgeSourcePath(row.path));

  const allRows = [
    ...manualRows.map((row) => ({ ...row, sourceOrigin: "manual" as const })),
    ...candidateRows.map((row) => ({ ...row, sourceOrigin: "candidate" as const })),
  ];

  const resolveSourceIdFromRow = (record: ProjectKnowledgeSourceRow): string => {
    const path = normalizeKnowledgeSourcePath(record.path);
    const title = normalizeKnowledgeSourcePath(record.title);
    return sourceIdByPath.get(path)
      || sourceIdByPath.get(title)
      || "";
  };

  const sourceColumns = [
    {
      title: t("copaw.projects.knowledge.columnPath", "Path"),
      dataIndex: "title",
      key: "title",
      width: "40%",
      render: (_: string, record: ProjectKnowledgeSourceRow) => (
        <div>
          <Typography.Text ellipsis title={record.path}>
            {record.path}
          </Typography.Text>
          <br />
          <Typography.Text type="secondary" ellipsis title={record.title}>
            {record.title}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: t("projects.fileStage", "Stage"),
      dataIndex: "stage",
      key: "stage",
      width: 140,
    },
    {
      title: t("projects.fileContentType", "Content Type"),
      dataIndex: "contentType",
      key: "contentType",
      width: 160,
    },
    {
      title: t("projects.fileSize", "Size"),
      dataIndex: "size",
      key: "size",
      width: 120,
      render: (size: number) => formatFileSize(size),
    },
    {
      title: t("projects.fileModifiedTime", "Modified"),
      dataIndex: "modifiedTime",
      key: "modifiedTime",
      width: "22%",
      render: (time?: string) => (
        <Tooltip title={time || "-"}>
          <Typography.Text type="secondary">
            {formatTime(time)}
          </Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: t("copaw.projects.knowledge.sourcesPanel.origin", "Origin"),
      key: "origin",
      width: 130,
      render: (_: unknown, record: ProjectKnowledgeSourceRow & { sourceOrigin: "manual" | "candidate" }) => (
        <Typography.Text type={record.sourceOrigin === "manual" ? "success" : "secondary"}>
          {record.sourceOrigin === "manual"
            ? t("copaw.projects.knowledge.sourcesPanel.originManual", "Manual")
            : t("copaw.projects.knowledge.sourcesPanel.originCandidate", "Candidate")}
        </Typography.Text>
      ),
    },
    {
      title: t("copaw.projects.knowledge.processing.layerL2Column", "Processing"),
      key: "processing",
      width: 320,
      render: (_: unknown, record: ProjectKnowledgeSourceRow & { sourceOrigin: "manual" | "candidate" }) => {
        const sourceId = resolveSourceIdFromRow(record);
        const isManual = record.sourceOrigin === "manual";
        const isImage = record.category === "image";
        const runLabel = record.category === "structured"
          ? t("copaw.projects.knowledge.processing.runStructuredFlow", "Run Structured Flow")
          : t("copaw.projects.knowledge.processing.runFullFlow", "Run Document Flow");
        const openLabel = record.category === "structured"
          ? t("copaw.projects.knowledge.processing.openStructuredDetail", "View Structured Processing")
          : record.category === "image"
            ? t("copaw.projects.knowledge.processing.openImageDetail", "View Image Placeholder")
            : t("copaw.projects.knowledge.processing.openDetail", "View Document Processing");
        return (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button
              type="link"
              size="small"
              disabled={!isManual || !sourceId || !onOpenProcessingForSource}
              onClick={() => {
                if (!isManual || !sourceId || !onOpenProcessingForSource) {
                  return;
                }
                onOpenProcessingForSource(sourceId);
              }}
            >
              {openLabel}
            </Button>
            <Button
              type="link"
              size="small"
              disabled={isImage}
              onClick={() => {
                void knowledgeState.runSourceFullPipeline(record.path, {
                  force: true,
                  overwrite: true,
                });
              }}
            >
              {runLabel}
            </Button>
            <Button
              type="link"
              size="small"
              danger={isManual}
              onClick={() => {
                if (isManual) {
                  void knowledgeState.removeManualSourcePath(record.path);
                  return;
                }
                void knowledgeState.addManualSourcePath(record.path);
              }}
            >
              {isManual
                ? t("copaw.projects.knowledge.sources.remove", "Remove")
                : record.category === "structured"
                  ? t("copaw.projects.knowledge.sourcesPanel.addStructured", "Add to Structured Sources")
                  : record.category === "image"
                    ? t("copaw.projects.knowledge.sourcesPanel.addImage", "Add to Image Sources")
                    : t("copaw.projects.knowledge.sources.add", "Add to Document Sources")}
            </Button>
          </div>
        );
      },
    },
  ];

  const buildRowsForCategory = (category: ProjectKnowledgeSourceRow["category"]) => allRows
    .filter((row) => row.category === category)
    .sort((left, right) => {
      if (left.sourceOrigin !== right.sourceOrigin) {
        return left.sourceOrigin === "manual" ? -1 : 1;
      }
      return left.path.localeCompare(right.path);
    });

  const documentRows = buildRowsForCategory("document");
  const structuredRows = buildRowsForCategory("structured");
  const imageRows = buildRowsForCategory("image");

  return (
    <div className={styles.projectKnowledgeWorkbench}>
      <div className={styles.projectKnowledgeSignalGrid}>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("copaw.projects.knowledge.signalDocuments")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.documentCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("copaw.projects.knowledge.signalSnapshots")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.snapshotCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("copaw.projects.knowledge.signalChunks")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.chunkCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">
            {t("copaw.projects.knowledge.signalSentences")}
            <span title="基于 interlinear 工件逐句统计">🛈</span>
          </Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.sentenceCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">
            {t("copaw.projects.knowledge.signalTokens")}
            <span title="基于轻量化工件分词统计">🛈</span>
          </Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.tokenCount || 0}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">
            {t("copaw.projects.knowledge.signalCharacters")}
            <span title="基于 interlinear 工件逐句统计">🛈</span>
          </Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.charCount || 0}</Typography.Text>
        </div>
      </div>

      <div className={styles.projectKnowledgeHistoryStrip}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <Typography.Text strong>
            {t("copaw.projects.knowledge.sourcesPanel.title", "Sources")}
          </Typography.Text>
          <Button size="small" onClick={() => void knowledgeState.loadProjectSourceStatus()}>
            {t("copaw.projects.knowledge.actions.refresh", "Refresh")}
          </Button>
        </div>
        <Tabs
          items={[
            {
              key: "document",
              label: t("copaw.projects.knowledge.sourcesPanel.tabDocument", "Document"),
              children: (
                <Table
                  columns={sourceColumns}
                  dataSource={documentRows}
                  pagination={{ pageSize: 10, simple: true }}
                  size="small"
                  bordered={false}
                  scroll={{ x: 1400 }}
                  locale={{ emptyText: t("copaw.projects.knowledge.sourcesPanel.emptyDocument", "No document sources found") }}
                />
              ),
            },
            {
              key: "structured",
              label: t("copaw.projects.knowledge.sourcesPanel.tabStructured", "Structured"),
              children: (
                <Table
                  columns={sourceColumns}
                  dataSource={structuredRows}
                  pagination={{ pageSize: 10, simple: true }}
                  size="small"
                  bordered={false}
                  scroll={{ x: 1400 }}
                  locale={{ emptyText: t("copaw.projects.knowledge.sourcesPanel.emptyStructured", "No structured sources found") }}
                />
              ),
            },
            {
              key: "image",
              label: t("copaw.projects.knowledge.sourcesPanel.tabImage", "Image"),
              children: (
                <Table
                  columns={sourceColumns}
                  dataSource={imageRows}
                  pagination={{ pageSize: 10, simple: true }}
                  size="small"
                  bordered={false}
                  scroll={{ x: 1400 }}
                  locale={{ emptyText: t("copaw.projects.knowledge.sourcesPanel.emptyImage", "No image sources found") }}
                />
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
