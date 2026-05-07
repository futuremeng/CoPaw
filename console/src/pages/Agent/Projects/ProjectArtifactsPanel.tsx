import { SendOutlined } from "@ant-design/icons";
import { Button, Checkbox, Empty, Splitter, Spin, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type {
  AgentProjectFileInfo,
  ProjectPipelineArtifactRecord,
} from "../../../api/types/agents";
import ProjectMdxReadonlyPreview from "./ProjectMdxReadonlyPreview";
import styles from "./index.module.less";

const { Text } = Typography;

function isMarkdownFilePath(filePath: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(filePath);
}

interface ProjectArtifactsPanelProps {
  filesLoading: boolean;
  contentLoading: boolean;
  artifactRecords: ProjectPipelineArtifactRecord[];
  selectedFilePath: string;
  knownProjectFilesByPath: Record<string, AgentProjectFileInfo>;
  projectFiles: AgentProjectFileInfo[];
  fileContent: string;
  selectedAttachPaths: string[];
  autoAnalyzeOnAttach: boolean;
  sendingSelectedFiles: boolean;
  onToggleAutoAnalyze: (value: boolean) => void;
  onSendSelectedFilesToChat: () => void;
}

export default function ProjectArtifactsPanel({
  filesLoading,
  contentLoading,
  artifactRecords,
  selectedFilePath,
  knownProjectFilesByPath,
  projectFiles,
  fileContent,
  selectedAttachPaths,
  autoAnalyzeOnAttach,
  sendingSelectedFiles,
  onToggleAutoAnalyze,
  onSendSelectedFilesToChat,
}: ProjectArtifactsPanelProps) {
  const { t } = useTranslation();
  const selectedFileInfo = knownProjectFilesByPath[selectedFilePath]
    || projectFiles.find((item) => item.path === selectedFilePath);
  const hasPreviewTarget = Boolean(selectedFilePath);
  const shouldBlockOnFilesLoading = filesLoading && !hasPreviewTarget;
  const isEmptyFilePreview = Boolean(
    selectedFilePath
    && !contentLoading
    && fileContent === ""
    && selectedFileInfo?.size === 0,
  );
  const shouldRenderMdxPreview = Boolean(
    selectedFilePath
    && !isEmptyFilePreview
    && isMarkdownFilePath(selectedFilePath),
  );

  return (
    <div className={`${styles.previewBody} ${styles.previewBodyArtifacts}`}>
      {shouldBlockOnFilesLoading ? (
        <div className={styles.centerState}>
          <Spin />
        </div>
      ) : !hasPreviewTarget && artifactRecords.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("projects.noFiles", "No files in this project")}
        />
      ) : (
        <div className={styles.artifactPanel}>
          <Splitter className={styles.artifactPreviewSplitter}>
            <Splitter.Panel defaultSize="68%" min="45%">
              <div className={styles.previewPane}>
                {contentLoading ? (
                  <div className={styles.centerState}>
                    <Spin />
                  </div>
                ) : selectedFilePath ? (
                  <>
                    {isEmptyFilePreview ? (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={t("projects.emptyFile", "This file is empty")}
                      />
                    ) : shouldRenderMdxPreview ? (
                      <ProjectMdxReadonlyPreview
                        filePath={selectedFilePath}
                        markdown={fileContent}
                      />
                    ) : (
                      <pre className={styles.previewContent}>{fileContent}</pre>
                    )}
                  </>
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t("projects.selectFile", "Select a file to preview")}
                  />
                )}
              </div>
            </Splitter.Panel>
            <Splitter.Panel min="28%">
              <div className={styles.knowledgePreviewPane}>
                <div className={styles.knowledgePreviewHeader}>
                  <Text strong>
                    {t(
                      "projects.workbench.knowledgePreviewTitle",
                      "Current Document Knowledge Visualization",
                    )}
                  </Text>
                </div>
                <div className={styles.knowledgePreviewBody}>
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t(
                      "projects.workbench.knowledgePreviewPlaceholder",
                      "Knowledge visualization will be available here for the current document.",
                    )}
                  />
                </div>
              </div>
            </Splitter.Panel>
          </Splitter>
          {selectedAttachPaths.length > 0 && (
            <div className={styles.attachFloatingBar}>
              <div className={styles.attachCountText}>
                {t("projects.chat.selectedCount", "Selected files: {{count}}", {
                  count: selectedAttachPaths.length,
                })}
              </div>
              <Checkbox
                className={styles.attachAutoAnalyzeCheck}
                checked={autoAnalyzeOnAttach}
                onChange={(event) => onToggleAutoAnalyze(event.target.checked)}
              >
                {t("projects.chat.autoAnalyze", "Auto Analyze")}
              </Checkbox>
              <Button
                type="primary"
                size="small"
                icon={<SendOutlined />}
                loading={sendingSelectedFiles}
                onClick={onSendSelectedFilesToChat}
              >
                {t("projects.chat.sendSelected", "Attach To Chat")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}