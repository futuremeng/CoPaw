import {
  MinusOutlined,
  PlusOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { Button, Checkbox, Empty, Spin, Switch, Tag } from "antd";
import { useTranslation } from "react-i18next";
import type {
  AgentProjectFileInfo,
  ProjectPipelineArtifactRecord,
} from "../../../api/types/agents";
import styles from "./index.module.less";

interface ArtifactGroup {
  key: string;
  title: string;
  items: ProjectPipelineArtifactRecord[];
}

interface ProjectArtifactsPanelProps {
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
  onToggleHideBuiltInFiles: (value: boolean) => void;
  onClearArtifactFocus: () => void;
  onSelectArtifactFile: (path: string) => void;
  onAttachArtifactToChat: (path: string) => void;
  onSelectStep: (stepId: string) => void;
  onToggleAutoAnalyze: (value: boolean) => void;
  onSendSelectedFilesToChat: () => void;
  formatBytes: (size: number) => string;
}

export default function ProjectArtifactsPanel({
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
  onToggleHideBuiltInFiles,
  onClearArtifactFocus,
  onSelectArtifactFile,
  onAttachArtifactToChat,
  onSelectStep,
  onToggleAutoAnalyze,
  onSendSelectedFilesToChat,
  formatBytes,
}: ProjectArtifactsPanelProps) {
  const { t } = useTranslation();

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
          <div className={styles.artifactList}>
            <div className={styles.artifactToolbar}>
              <div className={styles.itemMeta}>
                {t("projects.artifacts.hideBuiltins", "Hide built-in files")}
              </div>
              <Switch size="small" checked={hideBuiltInFiles} onChange={onToggleHideBuiltInFiles} />
            </div>
            {(selectedStepId || selectedArtifactRecord) && (
              <div className={styles.focusBar}>
                <div className={styles.itemMeta}>
                  {selectedStepId
                    ? t("projects.artifacts.filteredByStep", "Filtered by step: {{stepId}}", {
                        stepId: selectedStepId,
                      })
                    : selectedArtifactRecord
                      ? t("projects.artifacts.focusedArtifact", "Focused artifact relation")
                      : ""}
                </div>
                <Button size="small" onClick={onClearArtifactFocus}>
                  {t("common.clear", "Clear")}
                </Button>
              </div>
            )}
            {groupedArtifactRecords.map((group) => (
              <div key={group.key} className={styles.artifactGroup}>
                <div className={styles.artifactGroupTitle}>{group.title}</div>
                {group.items.map((item) => {
                  const selected = item.path === selectedFilePath;
                  const artifactRelated =
                    Boolean(selectedStepId) && relatedArtifactPathsForSelectedStep.has(item.path);
                  const fileInfo = projectFiles.find((file) => file.path === item.path);
                  return (
                    <div
                      key={item.artifact_id}
                      role="button"
                      tabIndex={0}
                      className={`${styles.listItem} ${selected ? styles.selected : ""} ${artifactRelated && !selected ? styles.related : ""}`}
                      onClick={() => {
                        onSelectArtifactFile(item.path);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectArtifactFile(item.path);
                        }
                      }}
                    >
                      <div className={styles.itemTitleRow}>
                        <div className={styles.itemTitleMain}>
                          <div className={styles.itemTitle}>{item.name}</div>
                        </div>
                        <div className={styles.itemActions}>
                          <Tag
                            color={
                              item.kind === "source"
                                ? "default"
                                : item.kind === "final"
                                  ? "success"
                                  : "processing"
                            }
                          >
                            {item.kind}
                          </Tag>
                        </div>
                      </div>
                      <div className={styles.itemMeta}>{item.path}</div>
                      <div className={styles.itemMeta}>
                        {item.producer_step_name
                          ? t("projects.artifacts.producedBy", "Produced by: {{step}}", {
                              step: item.producer_step_name,
                            })
                          : t("projects.artifacts.originalFile", "Original project file")}
                      </div>
                      {fileInfo && (
                        <div className={styles.itemMeta}>
                          {formatBytes(fileInfo.size)} · {fileInfo.modified_time}
                        </div>
                      )}
                      <div className={styles.listItemFooter}>
                        <Button
                          size="small"
                          type="text"
                          icon={selectedAttachPaths.includes(item.path) ? <MinusOutlined /> : <PlusOutlined />}
                          className={styles.attachActionButton}
                          onClick={(event) => {
                            event.stopPropagation();
                            onAttachArtifactToChat(item.path);
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className={styles.previewPane}>
            {contentLoading ? (
              <div className={styles.centerState}>
                <Spin />
              </div>
            ) : selectedFilePath ? (
              <>
                {selectedArtifactRecord && (
                  <div className={styles.artifactDetailCard}>
                    <div className={styles.itemTitleRow}>
                      <div className={styles.itemTitle}>{selectedArtifactRecord.name}</div>
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
                    </div>
                    <div className={styles.itemMeta}>{selectedArtifactRecord.path}</div>
                    <div className={styles.itemMeta}>
                      {selectedArtifactRecord.producer_step_name
                        ? t("projects.artifacts.producedBy", "Produced by: {{step}}", {
                            step: selectedArtifactRecord.producer_step_name,
                          })
                        : t("projects.artifacts.originalFile", "Original project file")}
                    </div>
                    <div className={styles.itemMeta}>
                      {t("projects.artifacts.consumedBy", "Consumed by")}: {selectedArtifactRecord.consumer_step_names.join(", ") || "-"}
                    </div>
                    <div className={styles.lineageRow}>
                      <span className={styles.lineageLabel}>
                        {t("projects.artifacts.lineage", "Lineage")}
                      </span>
                      <div className={styles.lineageFlow}>
                        {selectedArtifactRecord.producer_step_name ? (
                          <button
                            type="button"
                            className={styles.lineageNode}
                            onClick={() => onSelectStep(selectedArtifactRecord.producer_step_id || "")}
                          >
                            {selectedArtifactRecord.producer_step_name}
                          </button>
                        ) : (
                          <span className={styles.lineageTerminal}>
                            {t("projects.artifacts.sourceTerminal", "Project Source")}
                          </span>
                        )}
                        <span className={styles.lineageArrow}>-&gt;</span>
                        <span className={styles.lineageArtifact}>{selectedArtifactRecord.name}</span>
                        <span className={styles.lineageArrow}>-&gt;</span>
                        {selectedArtifactRecord.consumer_step_names.length > 0 ? (
                          <div className={styles.lineageConsumerList}>
                            {selectedArtifactRecord.consumer_step_names.map((consumerName, index) => (
                              <button
                                key={`${selectedArtifactRecord.artifact_id}-${consumerName}`}
                                type="button"
                                className={styles.lineageNode}
                                onClick={() => onSelectStep(selectedArtifactRecord.consumer_step_ids[index] || "")}
                              >
                                {consumerName}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className={styles.lineageTerminal}>
                            {t("projects.artifacts.finalTerminal", "Terminal Output")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
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