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
  const sourceRows = buildKnowledgeSourceRows(projectFiles || []);

  const sourceIdByPath = new Map<string, string>();
  for (const source of knowledgeState.projectSources) {
    const sourceId = String(source.id || "").trim();
    if (!sourceId) {
      continue;
    }
    const location = normalizeKnowledgeSourcePath(source.location);
    if (location) {
      sourceIdByPath.set(location, sourceId);
      sourceIdByPath.set(location.split("/").slice(-1)[0] || location, sourceId);
    }
    const name = normalizeKnowledgeSourcePath(source.name);
    if (name) {
      sourceIdByPath.set(name, sourceId);
    }
  }

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
      width: 140,
      render: (_: unknown, record: ProjectKnowledgeSourceRow) => {
        const sourceId = resolveSourceIdFromRow(record);
        return (
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
            {t("copaw.projects.knowledge.processing.openDetail", "View Processing")}
          </Button>
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

      {sourceRows.length > 0 && (
        <div className={styles.projectKnowledgeHistoryStrip}>
          <Table
            columns={sourceColumns}
            dataSource={sourceRows}
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
