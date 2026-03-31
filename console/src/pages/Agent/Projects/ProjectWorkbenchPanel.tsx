import { Card, Typography } from "antd";
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
  filesLoading: boolean;
  contentLoading: boolean;
  artifactRecords: ProjectPipelineArtifactRecord[];
  selectedArtifactRecord: ProjectPipelineArtifactRecord | undefined;
  selectedFilePath: string;
  projectFiles: AgentProjectFileInfo[];
  fileContent: string;
  selectedAttachPaths: string[];
  autoAnalyzeOnAttach: boolean;
  sendingSelectedFiles: boolean;
  onToggleAutoAnalyze: (value: boolean) => void;
  onSendSelectedFilesToChat: () => void;
  formatBytes: (size: number) => string;
}

export default function ProjectWorkbenchPanel({
  projectLabel,
  filesLoading,
  contentLoading,
  artifactRecords,
  selectedArtifactRecord,
  selectedFilePath,
  projectFiles,
  fileContent,
  selectedAttachPaths,
  autoAnalyzeOnAttach,
  sendingSelectedFiles,
  onToggleAutoAnalyze,
  onSendSelectedFilesToChat,
  formatBytes,
}: ProjectWorkbenchPanelProps) {
  const { t } = useTranslation();

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
      <ProjectArtifactsPanel
        filesLoading={filesLoading}
        contentLoading={contentLoading}
        artifactRecords={artifactRecords}
        selectedArtifactRecord={selectedArtifactRecord}
        selectedFilePath={selectedFilePath}
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