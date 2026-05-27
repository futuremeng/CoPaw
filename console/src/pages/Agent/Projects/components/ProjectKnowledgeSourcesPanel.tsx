import { Button, Table, Tooltip, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { AgentProjectFileInfo } from "../../../../api/types/agents";
import styles from "../index.module.less";
import { formatFileSize } from "../utils/metrics";
import type { ProjectKnowledgeState } from "../hooks/useProjectKnowledgeState";
import {
  buildKnowledgeSourceRows,
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

interface ProjectKnowledgeSourcesPanelProps {
  knowledgeState: ProjectKnowledgeState;
  projectFiles: AgentProjectFileInfo[];
  onOpenProcessingForSource?: (sourceId: string) => void;
}

export default function ProjectKnowledgeSourcesPanel(props: ProjectKnowledgeSourcesPanelProps) {
  const { t } = useTranslation();
  const { knowledgeState, projectFiles, onOpenProcessingForSource } = props;
  const discoveredRows = buildKnowledgeSourceRows((projectFiles || []).filter((item) => !item.builtin && !item.ignored));

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

  const candidateRows = discoveredRows.filter((row) => !manualPathSet.has(normalizeKnowledgeSourcePath(row.path)));

  const candidateByPath = new Map<string, ProjectKnowledgeSourceRow>();
  for (const row of candidateRows) {
    const key = normalizeKnowledgeSourcePath(row.path);
    if (key) {
      candidateByPath.set(key, row);
    }
  }

  const manualRows: ProjectKnowledgeSourceRow[] = knowledgeState.projectSources.map((source) => {
    const path = normalizeKnowledgeSourcePath(String(source.location || source.id || ""));
    const fromCandidate = path ? candidateByPath.get(path) : undefined;
    return {
      key: path || String(source.id || source.name || ""),
      path,
      title: String(source.name || path),
      stage: fromCandidate?.stage || "manual",
      contentType: fromCandidate?.contentType || "-",
      size: fromCandidate?.size || 0,
      modifiedTime: fromCandidate?.modifiedTime,
    };
  });

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
      title: t("copaw.projects.knowledge.processing.layerL2Column", "Processing"),
      key: "processing",
      width: 240,
      render: (_: unknown, record: ProjectKnowledgeSourceRow) => {
        const sourceId = resolveSourceIdFromRow(record);
        return (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button
              type="link"
              size="small"
              disabled={!sourceId || !onOpenProcessingForSource}
              onClick={() => {
                if (!sourceId || !onOpenProcessingForSource) {
                  return;
                }
                onOpenProcessingForSource(sourceId);
              }}
            >
              {t("copaw.projects.knowledge.processing.openDetail", "View Document Processing")}
            </Button>
            <Button
              type="link"
              size="small"
              onClick={() => {
                void knowledgeState.runSourceFullPipeline(record.path, {
                  force: true,
                  overwrite: true,
                });
              }}
            >
              {t("copaw.projects.knowledge.processing.runFullFlow", "Run Document Flow")}
            </Button>
            <Button
              type="link"
              size="small"
              danger
              onClick={() => {
                void knowledgeState.removeManualSourcePath(record.path);
              }}
            >
              {t("copaw.projects.knowledge.sources.remove", "Remove")}
            </Button>
          </div>
        );
      },
    },
  ];

  const candidateColumns = [
    ...sourceColumns.slice(0, 5),
    {
      title: t("copaw.projects.knowledge.sources.addAction", "Action"),
      key: "manualSelect",
      width: 260,
      render: (_: unknown, record: ProjectKnowledgeSourceRow) => {
        const normalized = normalizeKnowledgeSourcePath(record.path);
        const added = manualPathSet.has(normalized);
        return (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button
              type="link"
              size="small"
              onClick={() => {
                if (!normalized) {
                  return;
                }
                void knowledgeState.runSourceFullPipeline(normalized, {
                  force: true,
                  overwrite: true,
                });
              }}
            >
              {t("copaw.projects.knowledge.processing.runFullFlow", "Run Document Flow")}
            </Button>
            <Button
              type="link"
              size="small"
              disabled={added}
              onClick={() => {
                if (!normalized || added) {
                  return;
                }
                void knowledgeState.addManualSourcePath(normalized);
              }}
            >
              {added
                ? t("copaw.projects.knowledge.sources.added", "Added")
                : t("copaw.projects.knowledge.sources.add", "Add to Document Sources")}
            </Button>
          </div>
        );
      },
    },
  ];

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
            {t("copaw.projects.knowledge.sources.manualList", "Document Sources")}
          </Typography.Text>
          <Button size="small" onClick={() => void knowledgeState.loadProjectSourceStatus()}>
            {t("copaw.projects.knowledge.actions.refresh", "Refresh")}
          </Button>
        </div>
        <Table
          columns={sourceColumns}
          dataSource={manualRows}
          pagination={{ pageSize: 10, simple: true }}
          size="small"
          bordered={false}
          scroll={{ x: 1200 }}
          locale={{ emptyText: t("copaw.projects.knowledge.sources.manualEmpty", "No document sources yet") }}
        />
      </div>

      {candidateRows.length > 0 && (
        <div className={styles.projectKnowledgeHistoryStrip}>
          <Typography.Text strong>
            {t("copaw.projects.knowledge.sources.candidates", "Structured Candidates")}
          </Typography.Text>
          <Table
            columns={candidateColumns}
            dataSource={candidateRows}
            pagination={{ pageSize: 10, simple: true }}
            size="small"
            bordered={false}
            scroll={{ x: 1200 }}
            locale={{ emptyText: t("copaw.projects.knowledge.sourcesFileListEmpty", "No project files found") }}
          />
        </div>
      )}
    </div>
  );
}
