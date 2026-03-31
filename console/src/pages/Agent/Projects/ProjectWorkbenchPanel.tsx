import { Card, Tabs, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type {
  AgentProjectFileInfo,
  ProjectPipelineArtifactRecord,
  ProjectPipelineRunDetail,
} from "../../../api/types/agents";
import ProjectArtifactsPanel from "./ProjectArtifactsPanel";
import ProjectEvidencePanel from "./ProjectEvidencePanel";
import ProjectMetricsPanel from "./ProjectMetricsPanel";
import styles from "./index.module.less";

const { Text } = Typography;

interface ArtifactGroup {
  key: string;
  title: string;
  items: ProjectPipelineArtifactRecord[];
}

interface RunProgressSummary {
  total: number;
  completed: number;
  running: number;
  pending: number;
}

interface ProjectWorkbenchPanelProps {
  projectLabel: string;
  filesLoading: boolean;
  contentLoading: boolean;
  hideBuiltInFiles: boolean;
  artifactRecords: ProjectPipelineArtifactRecord[];
  groupedArtifactRecords: ArtifactGroup[];
  selectedArtifactRecord: ProjectPipelineArtifactRecord | undefined;
  selectedFilePath: string;
  selectedStepId: string;
  relatedArtifactPathsForSelectedStep: Set<string>;
  projectFiles: AgentProjectFileInfo[];
  fileContent: string;
  selectedAttachPaths: string[];
  autoAnalyzeOnAttach: boolean;
  sendingSelectedFiles: boolean;
  runDetail: ProjectPipelineRunDetail | null;
  runProgress: RunProgressSummary;
  onToggleHideBuiltInFiles: (value: boolean) => void;
  onClearArtifactFocus: () => void;
  onSelectArtifactFile: (path: string) => void;
  onAttachArtifactToChat: (path: string) => void;
  onSelectStep: (stepId: string) => void;
  onToggleAutoAnalyze: (value: boolean) => void;
  onSendSelectedFilesToChat: () => void;
  statusTagColor: (status: string) => string;
  formatBytes: (size: number) => string;
}

export default function ProjectWorkbenchPanel({
  projectLabel,
  filesLoading,
  contentLoading,
  hideBuiltInFiles,
  artifactRecords,
  groupedArtifactRecords,
  selectedArtifactRecord,
  selectedFilePath,
  selectedStepId,
  relatedArtifactPathsForSelectedStep,
  projectFiles,
  fileContent,
  selectedAttachPaths,
  autoAnalyzeOnAttach,
  sendingSelectedFiles,
  runDetail,
  runProgress,
  onToggleHideBuiltInFiles,
  onClearArtifactFocus,
  onSelectArtifactFile,
  onAttachArtifactToChat,
  onSelectStep,
  onToggleAutoAnalyze,
  onSendSelectedFilesToChat,
  statusTagColor,
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
      <Tabs
        className={styles.rightTabs}
        items={[
          {
            key: "artifacts",
            label: t("projects.artifacts", "Artifacts"),
            children: (
              <ProjectArtifactsPanel
                filesLoading={filesLoading}
                contentLoading={contentLoading}
                hideBuiltInFiles={hideBuiltInFiles}
                artifactRecords={artifactRecords}
                groupedArtifactRecords={groupedArtifactRecords}
                selectedArtifactRecord={selectedArtifactRecord}
                selectedFilePath={selectedFilePath}
                selectedStepId={selectedStepId}
                relatedArtifactPathsForSelectedStep={relatedArtifactPathsForSelectedStep}
                projectFiles={projectFiles}
                fileContent={fileContent}
                selectedAttachPaths={selectedAttachPaths}
                autoAnalyzeOnAttach={autoAnalyzeOnAttach}
                sendingSelectedFiles={sendingSelectedFiles}
                onToggleHideBuiltInFiles={onToggleHideBuiltInFiles}
                onClearArtifactFocus={onClearArtifactFocus}
                onSelectArtifactFile={onSelectArtifactFile}
                onAttachArtifactToChat={onAttachArtifactToChat}
                onSelectStep={onSelectStep}
                onToggleAutoAnalyze={onToggleAutoAnalyze}
                onSendSelectedFilesToChat={onSendSelectedFilesToChat}
                formatBytes={formatBytes}
              />
            ),
          },
          {
            key: "metrics",
            label: t("projects.metrics", "Metrics"),
            children: (
              <ProjectMetricsPanel
                runDetail={runDetail}
                runProgress={runProgress}
                statusTagColor={statusTagColor}
              />
            ),
          },
          {
            key: "evidence",
            label: t("projects.evidence", "Evidence"),
            children: (
              <ProjectEvidencePanel runDetail={runDetail} />
            ),
          },
        ]}
      />
    </Card>
  );
}