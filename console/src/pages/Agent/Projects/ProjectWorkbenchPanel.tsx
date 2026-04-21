import { Button, Card, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type {
  AgentProjectFileInfo,
  ProjectPipelineArtifactRecord,
} from "../../../api/types/agents";
import ProjectArtifactsPanel from "./ProjectArtifactsPanel";
import styles from "./index.module.less";

const { Text } = Typography;

interface ProjectWorkbenchPanelProps {
  projectLabel: string;
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
  projectLabel,
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

  return (
    <Card
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
      title={<span className={styles.sectionTitle}>{t("projects.preview", "Workbench")}</span>}
      styles={{
        body: {
          padding: 0,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        },
      }}
      extra={
        <Text type="secondary" className={styles.panelExtraText}>
          {projectLabel}
        </Text>
      }
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
        selectedArtifactRecord={selectedArtifactRecord}
        selectedFilePath={selectedFilePath}
        knownProjectFilesByPath={knownProjectFilesByPath}
        projectFiles={projectFiles}
        fileContent={fileContent}
        selectedAttachPaths={selectedAttachPaths}
        autoAnalyzeOnAttach={autoAnalyzeOnAttach}
        sendingSelectedFiles={sendingSelectedFiles}
        onToggleAutoAnalyze={onToggleAutoAnalyze}
        onSendSelectedFilesToChat={onSendSelectedFilesToChat}
        formatBytes={formatBytes}
      />
    </Card>
  );
}