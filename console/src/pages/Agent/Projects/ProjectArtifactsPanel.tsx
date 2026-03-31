import { SendOutlined } from "@ant-design/icons";
import { Button, Checkbox, Empty, Spin, Tag } from "antd";
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

export default function ProjectArtifactsPanel({
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
}: ProjectArtifactsPanelProps) {
  const { t } = useTranslation();
  const selectedFileInfo = projectFiles.find((item) => item.path === selectedFilePath);

  return (
    <div className={`${styles.previewBody} ${styles.previewBodyArtifacts}`}>
      {filesLoading ? (
        <div className={styles.centerState}>
          <Spin />
        </div>
      ) : artifactRecords.length === 0 ? (
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
                <div className={styles.artifactDetailCard}>
                  <div className={styles.itemTitleRow}>
                    <div className={styles.itemTitle}>{selectedArtifactRecord?.name || selectedFilePath.split("/").pop()}</div>
                    {selectedArtifactRecord ? (
                      <Tag
                        color={
                          selectedArtifactRecord.kind === "source"
                            ? "default"
                            : selectedArtifactRecord.kind === "final"
                              ? "success"
                              : "processing"
                        }
                      >
                        {selectedArtifactRecord.kind}
                      </Tag>
                    ) : null}
                  </div>
                  <div className={styles.itemMeta}>{selectedFilePath}</div>
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
                <pre className={styles.previewContent}>{fileContent}</pre>
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