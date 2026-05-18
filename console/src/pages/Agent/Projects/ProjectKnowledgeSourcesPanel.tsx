import { InfoCircleOutlined } from "@ant-design/icons";
import { Table, Tooltip, Typography } from "antd";
import { useTranslation } from "react-i18next";
import styles from "./index.module.less";
import { getTriggerModeLabel, getProcessingStatusLabel } from "./projectKnowledgeSyncUi";
import type { ProjectKnowledgeState } from "./useProjectKnowledgeState";

type ProjectKnowledgeSource = ProjectKnowledgeState["projectSources"][number];

type ProjectKnowledgeSourceRow = {
  key: string;
  path: string;
  title: string;
  document_count: number;
  snapshot_count: number;
  chunk_count: number;
  sentence_count: number;
  token_count: number;
  char_count: number;
  trigger_mode?: "automatic" | "manual";
  processing_status?: "idle" | "queued" | "pending" | "indexing" | "graphifying" | "succeeded" | "failed";
  detected_at?: string;
};

function normalizePath(value?: string | null): string {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function inferSourceOrigin(source: ProjectKnowledgeSource): "automatic" | "manual" {
  const tags = source.tags || [];
  const isAuto = tags.includes("auto") || tags.includes("origin:auto") || source.id.startsWith("auto-");
  return isAuto ? "automatic" : "manual";
}

function findMatchingChangedFile(
  source: ProjectKnowledgeSource,
  changedFiles: Array<{
    path: string;
    trigger_mode?: "automatic" | "manual";
    processing_status?: "idle" | "queued" | "pending" | "indexing" | "graphifying" | "succeeded" | "failed";
    detected_at?: string;
  }>,
) {
  const sourceCandidates = [source.id, source.location, source.name]
    .map(normalizePath)
    .filter(Boolean);
  return changedFiles.find((file) => {
    const filePath = normalizePath(file.path);
    if (!filePath) {
      return false;
    }
    return sourceCandidates.some((candidate) => {
      return candidate === filePath
        || candidate.endsWith(`/${filePath}`)
        || filePath.endsWith(`/${candidate}`);
    });
  });
}

function toNumber(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function buildSourceRows(
  sources: ProjectKnowledgeSource[],
  changedFiles: Array<{
    path: string;
    trigger_mode?: "automatic" | "manual";
    processing_status?: "idle" | "queued" | "pending" | "indexing" | "graphifying" | "succeeded" | "failed";
    detected_at?: string;
  }>,
): ProjectKnowledgeSourceRow[] {
  return sources
    .map((source, index) => {
      const matchedChangedFile = findMatchingChangedFile(source, changedFiles);
      const status = source.status || {};
      const indexedAt = String(status.indexed_at || "").trim();
      return {
        key: source.id || source.location || `${index}`,
        path: normalizePath(source.location || source.id || source.name),
        title: source.name || source.location || source.id || `${index}`,
        document_count: toNumber(status.document_count),
        snapshot_count: toNumber(status.snapshot_count),
        chunk_count: toNumber(status.chunk_count),
        sentence_count: toNumber(status.sentence_count),
        token_count: toNumber(status.token_count),
        char_count: toNumber(status.char_count),
        trigger_mode: matchedChangedFile?.trigger_mode || inferSourceOrigin(source),
        processing_status: matchedChangedFile?.processing_status
          || (status.error ? "failed" : status.indexed ? "succeeded" : status.needs_reindex ? "pending" : "idle"),
        detected_at: matchedChangedFile?.detected_at || indexedAt || undefined,
      };
    })
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
}

export default function ProjectKnowledgeSourcesPanel(props: ProjectKnowledgeSourcesPanelProps) {
  const { t } = useTranslation();
  const { knowledgeState } = props;
  const sourceRows = buildSourceRows(knowledgeState.projectSources || [], knowledgeState.changedFilesNormalized || []);

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
      title: t("copaw.projects.knowledge.signalDocuments"),
      dataIndex: "document_count",
      key: "document_count",
      width: 96,
    },
    {
      title: t("copaw.projects.knowledge.signalSnapshots"),
      dataIndex: "snapshot_count",
      key: "snapshot_count",
      width: 96,
    },
    {
      title: t("copaw.projects.knowledge.signalChunks"),
      dataIndex: "chunk_count",
      key: "chunk_count",
      width: 96,
    },
    {
      title: t("copaw.projects.knowledge.signalSentences"),
      dataIndex: "sentence_count",
      key: "sentence_count",
      width: 112,
    },
    {
      title: t("copaw.projects.knowledge.signalTokens"),
      dataIndex: "token_count",
      key: "token_count",
      width: 112,
    },
    {
      title: t("copaw.projects.knowledge.signalCharacters"),
      dataIndex: "char_count",
      key: "char_count",
      width: 112,
    },
    {
      title: t("copaw.projects.knowledge.columnTriggerMode", "Launch Mode"),
      dataIndex: "trigger_mode",
      key: "trigger_mode",
      width: "10%",
      render: (mode?: string) => getTriggerModeLabel(t, mode),
    },
    {
      title: t("copaw.projects.knowledge.columnProcessingStatus", "Processing Status"),
      dataIndex: "processing_status",
      key: "processing_status",
      width: "10%",
      render: (status?: string) => getProcessingStatusLabel(t, status),
    },
    {
      title: t("copaw.projects.knowledge.columnDetectedAt", "Detected"),
      dataIndex: "detected_at",
      key: "detected_at",
      width: "18%",
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
      <div>
        <div className={styles.projectKnowledgeSectionTitleRow}>
            <Typography.Title level={5} className={styles.projectKnowledgeSectionTitle}>
              {t("projects.knowledgeDock.tabSources", "Sources")}
            </Typography.Title>
            <Tooltip title={t("copaw.projects.knowledge.sourcesRoleHint")}>
              <InfoCircleOutlined className={styles.projectKnowledgeHintIcon} />
            </Tooltip>
          </div>
        </div>

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
            locale={{ emptyText: t("copaw.projects.knowledge.sourcesFileListEmpty", "No knowledge files found") }}
          />
        </div>
      )}
    </div>
  );
}
