import { Table, Tooltip, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { AgentProjectFileInfo } from "../../../../api/types/agents";
import { isBuiltInProjectFile } from "../utils/builtInFiles";
import styles from "../index.module.less";
import { formatFileSize } from "../utils/metrics";
import type { ProjectKnowledgeState } from "../hooks/useProjectKnowledgeState";

type ProjectKnowledgeSourceRow = {
  key: string;
  path: string;
  title: string;
  stage: string;
  contentType: string;
  size: number;
  modifiedTime: string;
};

function normalizePath(value?: string | null): string {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function formatFileLabel(value?: string | null): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "-";
  }
  return normalized
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isBuiltInKnowledgeSource(file: AgentProjectFileInfo): boolean {
  if (typeof file.builtin === "boolean") {
    return file.builtin;
  }
  return isBuiltInProjectFile(file.path || file.filename || "");
}

function buildSourceRows(files: AgentProjectFileInfo[]): ProjectKnowledgeSourceRow[] {
  return files
    .filter((file) => !file.ignored && !isBuiltInKnowledgeSource(file))
    .map((file, index) => ({
      key: `${file.path || file.filename || index}`,
      path: normalizePath(file.path || file.filename),
      title: file.filename || file.path || `${index}`,
      stage: formatFileLabel(file.stage || "other"),
      contentType: formatFileLabel(file.content_type || "other"),
      size: Math.max(0, Number(file.size || 0)),
      modifiedTime: String(file.modified_time || "").trim(),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

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
}

export default function ProjectKnowledgeSourcesPanel(props: ProjectKnowledgeSourcesPanelProps) {
  const { t } = useTranslation();
  const { knowledgeState, projectFiles } = props;
  const sourceRows = buildSourceRows(projectFiles || []);

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
