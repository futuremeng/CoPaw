import { Button, Card, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type {
  AgentProjectFileInfo,
  ProjectPipelineArtifactRecord,
} from "../../../api/types/agents";
import ProjectArtifactsPanel from "./ProjectArtifactsPanel";
import styles from "./index.module.less";

const { Text } = Typography;

function getArtifactDisplayPath(
  artifact: ProjectPipelineArtifactRecord | undefined,
  fallbackPath: string,
): string {
  return artifact?.published_path || fallbackPath;
}

function getArtifactKindColor(kind: ProjectPipelineArtifactRecord["kind"]): string {
  if (kind === "source") {
    return "default";
  }
  if (kind === "final") {
    return "success";
  }
  return "processing";
}

interface ProjectWorkbenchPanelProps {
  syncNotice: {
    changedPaths: string[];
    updatedAt: number;
  } | null;
  filesLoading: boolean;
  contentLoading: boolean;
  artifactRecords: ProjectPipelineArtifactRecord[];
  selectedArtifactRecord: ProjectPipelineArtifactRecord | undefined;
  selectedFilePath: string;
  knownProjectFilesByPath: Record<string, AgentProjectFileInfo>;
  projectFiles: AgentProjectFileInfo[];
  fileContent: string;
  selectedAttachPaths: string[];
  autoAnalyzeOnAttach: boolean;
  sendingSelectedFiles: boolean;
  onToggleAutoAnalyze: (value: boolean) => void;
  onSendSelectedFilesToChat: () => void;
  onDismissSyncNotice: () => void;
  formatBytes: (size: number) => string;
}

export default function ProjectWorkbenchPanel({
  syncNotice,
  filesLoading,
  contentLoading,
  artifactRecords,
  selectedArtifactRecord,
  selectedFilePath,
  knownProjectFilesByPath,
  projectFiles,
  fileContent,
  selectedAttachPaths,
  autoAnalyzeOnAttach,
  sendingSelectedFiles,
  onToggleAutoAnalyze,
  onSendSelectedFilesToChat,
  onDismissSyncNotice,
  formatBytes,
}: ProjectWorkbenchPanelProps) {
  const { t } = useTranslation();
  const primaryChangedPath = syncNotice?.changedPaths[0] || "";
  const changedCount = syncNotice?.changedPaths.length || 0;
  const selectedFileInfo = knownProjectFilesByPath[selectedFilePath]
    || projectFiles.find((item) => item.path === selectedFilePath);
  const selectedDisplayPath = selectedFilePath
    ? getArtifactDisplayPath(selectedArtifactRecord, selectedFilePath)
    : "";
  const selectedSnapshotPath = selectedArtifactRecord?.published_path
    ? selectedFilePath
    : "";
  const selectedArtifactTitle = selectedArtifactRecord?.name || selectedFilePath.split("/").pop() || "";
  const workbenchTitle = selectedFilePath
    ? (
      <div className={styles.workbenchHeaderTitleWrap}>
        <div className={styles.itemTitleRow}>
          <div className={styles.itemTitle}>{selectedArtifactTitle}</div>
          {selectedArtifactRecord ? (
            <Tag color={getArtifactKindColor(selectedArtifactRecord.kind)}>
              {selectedArtifactRecord.kind}
            </Tag>
          ) : null}
        </div>
        <div className={styles.workbenchHeaderMetaList}>
          <div className={styles.itemMeta}>{selectedDisplayPath}</div>
          {selectedSnapshotPath ? (
            <div className={styles.itemMeta}>
              {t("projects.artifacts.snapshotPath", "Run snapshot")}: {selectedSnapshotPath}
            </div>
          ) : null}
          {selectedFileInfo ? (
            <div className={styles.itemMeta}>
              {formatBytes(selectedFileInfo.size)} · {selectedFileInfo.modified_time}
            </div>
          ) : null}
          {selectedArtifactRecord?.producer_step_name ? (
            <div className={styles.itemMeta}>
              {t("projects.artifacts.producedBy", "Produced by: {{step}}", {
                step: selectedArtifactRecord.producer_step_name,
              })}
            </div>
          ) : null}
        </div>
      </div>
    )
    : <span className={styles.sectionTitle}>{t("projects.selectFile", "Select a file to preview")}</span>;

  return (
    <Card
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
      title={workbenchTitle}
      styles={{
        body: {
          padding: 0,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        },
      }}
    >
      {syncNotice ? (
        <div style={{ padding: "12px 12px 0" }}>
          <Card
            size="small"
            style={{ background: "#faf7ef", borderColor: "#eadfcb" }}
            styles={{
              body: { padding: "10px 12px" },
            }}
          >
            <Text strong>
              {t(
                "projects.workbench.syncNoticeTitle",
                "Background sync updated project files.",
              )}
            </Text>
            <div style={{ marginTop: 4, display: "flex", justifyContent: "space-between", gap: 12 }}>
              <Text type="secondary">
                {changedCount > 1
                  ? t(
                    "projects.workbench.syncNoticeMulti",
                    "{{count}} files changed in the background. Workbench stays on your current selection.",
                    { count: changedCount },
                  )
                  : t(
                    "projects.workbench.syncNoticeSingle",
                    "{{path}} changed in the background. Workbench stays on your current selection.",
                    { path: primaryChangedPath || t("projects.workbench.syncNoticeFallback", "A file") },
                  )}
              </Text>
              <Button
                type="link"
                size="small"
                onClick={onDismissSyncNotice}
                style={{ paddingInline: 0, whiteSpace: "nowrap" }}
              >
                {t("projects.workbench.syncNoticeDismiss", "Dismiss")}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
      <ProjectArtifactsPanel
        filesLoading={filesLoading}
        contentLoading={contentLoading}
        artifactRecords={artifactRecords}
        selectedFilePath={selectedFilePath}
        knownProjectFilesByPath={knownProjectFilesByPath}
        projectFiles={projectFiles}
        fileContent={fileContent}
        selectedAttachPaths={selectedAttachPaths}
        autoAnalyzeOnAttach={autoAnalyzeOnAttach}
        sendingSelectedFiles={sendingSelectedFiles}
        onToggleAutoAnalyze={onToggleAutoAnalyze}
        onSendSelectedFilesToChat={onSendSelectedFilesToChat}
      />
    </Card>
  );
}