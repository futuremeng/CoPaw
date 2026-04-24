import { SendOutlined } from "@ant-design/icons";
import { Button, Checkbox, Empty, Spin } from "antd";
import { useTranslation } from "react-i18next";
import type {
  AgentProjectFileInfo,
  ProjectPipelineArtifactRecord,
} from "../../../api/types/agents";
import styles from "./index.module.less";

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