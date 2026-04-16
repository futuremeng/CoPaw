import { Alert, Button, Empty, Input, Select, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./index.module.less";
import type {
  ProjectKnowledgeProcessingMode,
  ProjectKnowledgeState,
} from "./useProjectKnowledgeState";

interface ProjectKnowledgeOutputsPanelProps {
  knowledgeState: ProjectKnowledgeState;
  onRunSuggestedQuery?: (query: string) => void;
}

function modeLabel(
  mode: ProjectKnowledgeProcessingMode,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (mode === "fast") {
    return t("projects.knowledge.processing.fast", "极速模式");
  }
  if (mode === "nlp") {
    return t("projects.knowledge.processing.nlp", "NLP 模式");
  }
  return t("projects.knowledge.processing.agentic", "多智能体模式");
}

export default function ProjectKnowledgeOutputsPanel(
  props: ProjectKnowledgeOutputsPanelProps,
) {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState("");
  const [predicateFilter, setPredicateFilter] = useState("");
  const [selectedMode, setSelectedMode] = useState<ProjectKnowledgeProcessingMode>(
    props.knowledgeState.activeOutputResolution.activeMode,
  );

  useEffect(() => {
    setSelectedMode(props.knowledgeState.activeOutputResolution.activeMode);
  }, [props.knowledgeState.activeOutputResolution.activeMode]);

  useEffect(() => {
    if (selectedMode !== "nlp" && selectedMode !== "agentic") {
      return;
    }
    if (!props.knowledgeState.graphQueryText.trim()) {
      return;
    }
    props.knowledgeState.markGraphNeedsRefresh();
  }, [
    props.knowledgeState.graphQueryMode,
    props.knowledgeState.graphQueryText,
    props.knowledgeState.graphQueryTopK,
    props.knowledgeState.markGraphNeedsRefresh,
    selectedMode,
  ]);

  const predicateOptions = useMemo(
    () => Array.from(new Set(props.knowledgeState.relationRecords.map((item) => item.predicate))).sort(),
    [props.knowledgeState.relationRecords],
  );

  const selectedModeState = useMemo(
    () => props.knowledgeState.processingModes.find((item) => item.mode === selectedMode)
      || props.knowledgeState.processingModes[0],
    [props.knowledgeState.processingModes, selectedMode],
  );

  const selectedModeOutput = useMemo(
    () => props.knowledgeState.modeOutputs[selectedMode],
    [props.knowledgeState.modeOutputs, selectedMode],
  );

  const canShowGraphRecords = selectedMode === "nlp" || selectedMode === "agentic";
  const modeRefreshPending = canShowGraphRecords
    && selectedMode !== props.knowledgeState.activeOutputResolution.activeMode;

  const filteredRecords = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return props.knowledgeState.relationRecords.filter((item) => {
      if (predicateFilter && item.predicate !== predicateFilter) {
        return false;
      }
      if (!normalizedKeyword) {
        return true;
      }
      return [
        item.subject,
        item.predicate,
        item.object,
        item.document_title,
        item.document_path,
      ].some((part) => part.toLowerCase().includes(normalizedKeyword));
    });
  }, [keyword, predicateFilter, props.knowledgeState.relationRecords]);

  return (
    <div className={styles.projectKnowledgeWorkbench}>
      <div className={styles.projectKnowledgeTabHeader}>
        <div>
          <Typography.Title level={5} className={styles.projectKnowledgeSectionTitle}>
            {t("projects.knowledgeDock.tabOutputs", "Outputs")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t(
              "projects.knowledge.outputsHint",
              "按处理模式查看知识产物。当前图谱交互会优先读取最佳可用产物，并在高阶产物缺失时自动降级。",
            )}
          </Typography.Text>
        </div>
        <div className={styles.projectKnowledgeTabActions}>
          <Select
            size="small"
            value={selectedMode}
            classNames={{ popup: { root: styles.projectKnowledgeSelectDropdown } }}
            style={{ width: 180 }}
            options={props.knowledgeState.processingModes.map((item) => ({
              label: modeLabel(item.mode, t),
              value: item.mode,
            }))}
            onChange={(value) => setSelectedMode(value as ProjectKnowledgeProcessingMode)}
          />
          <Button
            size="small"
            type={props.knowledgeState.graphNeedsRefresh || modeRefreshPending ? "primary" : "default"}
            onClick={() => {
              void props.knowledgeState.runGraphQuery(
                props.knowledgeState.graphQueryText || props.knowledgeState.suggestedQuery,
                props.knowledgeState.graphQueryMode,
                props.knowledgeState.graphQueryTopK,
                selectedMode,
              );
            }}
            loading={props.knowledgeState.graphLoading}
          >
            {t("projects.knowledge.actionRefreshSignals", "Refresh")}
          </Button>
        </div>
      </div>

      {(props.knowledgeState.graphNeedsRefresh || modeRefreshPending) ? (
        <Alert
          type="warning"
          showIcon
          message={t("projects.knowledge.refreshPending", "参数已变更，等待手动刷新")}
          description={t("projects.knowledge.refreshPendingHint", "点击右上角 Refresh 以应用最新图谱查询条件。")}
        />
      ) : null}

      <Alert
        type="info"
        showIcon
        message={t("projects.knowledge.outputs.currentMode", "当前读取策略")}
        description={`${modeLabel(props.knowledgeState.activeOutputResolution.activeMode, t)} · ${props.knowledgeState.activeOutputResolution.reason}`}
      />

      <div className={styles.projectKnowledgeOutputsCompareGrid}>
        {props.knowledgeState.processingModes.map((mode) => (
          <div
            key={mode.mode}
            className={`${styles.projectKnowledgeOutputCard} ${mode.mode === props.knowledgeState.activeOutputResolution.activeMode ? styles.projectKnowledgeOutputCardActive : ""}`}
          >
            <div className={styles.projectKnowledgeCardHeader}>
              <Typography.Text strong>{modeLabel(mode.mode, t)}</Typography.Text>
              <Tag color={mode.available ? "success" : "default"}>
                {mode.available ? t("projects.knowledge.processing.available", "可用") : t("projects.knowledge.processing.unavailable", "未就绪")}
              </Tag>
            </div>
            <div className={styles.projectKnowledgeHeaderStats}>
              <div className={styles.projectKnowledgeHeaderStat}>
                <Typography.Text type="secondary">{t("projects.knowledge.signalDocuments", "Documents")}</Typography.Text>
                <Typography.Text strong>{mode.documentCount}</Typography.Text>
              </div>
              <div className={styles.projectKnowledgeHeaderStat}>
                <Typography.Text type="secondary">{t("projects.knowledge.signalChunks", "Chunks")}</Typography.Text>
                <Typography.Text strong>{mode.chunkCount}</Typography.Text>
              </div>
              <div className={styles.projectKnowledgeHeaderStat}>
                <Typography.Text type="secondary">{t("projects.knowledge.entities", "Entities")}</Typography.Text>
                <Typography.Text strong>{mode.entityCount}</Typography.Text>
              </div>
              <div className={styles.projectKnowledgeHeaderStat}>
                <Typography.Text type="secondary">{t("projects.knowledge.signalRelations", "Relations")}</Typography.Text>
                <Typography.Text strong>{mode.relationCount}</Typography.Text>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.projectKnowledgeSignalGrid}>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.outputs.selectedMode", "Selected Mode")}</Typography.Text>
          <Typography.Text strong>{modeLabel(selectedModeState.mode, t)}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalDocuments", "Documents")}</Typography.Text>
          <Typography.Text strong>{selectedModeState.documentCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.entities", "Entities")}</Typography.Text>
          <Typography.Text strong>{selectedModeState.entityCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalRelations", "Relations")}</Typography.Text>
          <Typography.Text strong>{selectedModeState.relationCount}</Typography.Text>
        </div>
      </div>

      <Alert
        type="info"
        showIcon
        message={t("projects.knowledge.outputs.selectedSource", "当前模式产物来源")}
        description={[
          selectedModeOutput?.source || t("projects.knowledge.outputs.noSource", "unknown"),
          ...(selectedModeOutput?.summaryLines || []),
        ].filter(Boolean).join(" · ")}
      />

      <div className={styles.projectKnowledgeRelationList}>
        {(selectedModeOutput?.artifacts || []).map((artifact) => (
          <div key={`${artifact.kind}:${artifact.path}`} className={styles.projectKnowledgeRelationCard}>
            <div className={styles.projectKnowledgeCardHeader}>
              <Typography.Text strong>{artifact.label || artifact.kind}</Typography.Text>
              <Tag>{artifact.kind}</Tag>
            </div>
            <div className={styles.projectKnowledgeMetaLine}>
              <span>{artifact.path}</span>
            </div>
          </div>
        ))}
      </div>

      {canShowGraphRecords ? (
        <Alert
          type="warning"
          showIcon
          message={t("projects.knowledge.outputs.compatTitle", "当前图谱记录仍在兼容层")}
          description={t(
            "projects.knowledge.outputs.compatDescription",
            "下方关系列表暂时仍复用当前最佳可用图谱查询结果；artifact 视图已经按模式切分。",
          )}
        />
      ) : (
        <Alert
          type="info"
          showIcon
          message={t("projects.knowledge.outputs.fastArtifactTitle", "极速模式以预览产物为主")}
          description={t(
            "projects.knowledge.outputs.fastArtifactDescription",
            "极速模式主要提供索引与预览产物，不直接承载完整图谱关系结果。",
          )}
        />
      )}

      {canShowGraphRecords ? (
      <div className={styles.projectKnowledgeControls}>
        <Input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={t("projects.knowledge.relationSearchPlaceholder", "Search entities, relations, or document paths")}
          allowClear
        />
        <Select
          value={predicateFilter || undefined}
          allowClear
          size="small"
          classNames={{ popup: { root: styles.projectKnowledgeSelectDropdown } }}
          placeholder={t("projects.knowledge.relationTypeFilter", "Filter by relation type")}
          options={predicateOptions.map((item) => ({ label: item, value: item }))}
          onChange={(value) => setPredicateFilter(String(value || ""))}
          style={{ width: 220 }}
        />
      </div>
      ) : null}

      <div className={styles.projectKnowledgePanelBody}>
        {!canShowGraphRecords ? (
          <div className={styles.projectKnowledgeEmpty}>
            <Empty description={t("projects.knowledge.outputs.fastOnlyEmpty", "This mode currently exposes artifact previews instead of graph relations.")} />
          </div>
        ) : props.knowledgeState.graphLoading && !props.knowledgeState.graphResult ? (
          <div className={styles.projectKnowledgeEmpty}><Empty description={t("common.loading", "Loading")} /></div>
        ) : filteredRecords.length ? (
          <div className={styles.projectKnowledgeRelationList}>
            {filteredRecords.map((record, index) => (
              <div key={`${record.subject}-${record.predicate}-${record.object}-${index}`} className={styles.projectKnowledgeRelationCard}>
                <div className={styles.projectKnowledgeRelationMain}>
                  <Typography.Text strong>{record.subject}</Typography.Text>
                  <Typography.Text type="secondary">{record.predicate}</Typography.Text>
                  <Typography.Text>{record.object}</Typography.Text>
                </div>
                <div className={styles.projectKnowledgeMetaLine}>
                  <span>{record.document_title || record.document_path || record.source_id}</span>
                  <span>{record.source_type}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.projectKnowledgeEmpty}>
            <Empty description={t("projects.knowledge.emptyResult", "No result")}>
              <Button type="primary" onClick={() => props.onRunSuggestedQuery?.(props.knowledgeState.suggestedQuery)}>
                {t("projects.knowledge.actionRunSuggestedQuery", "Run suggested query")}
              </Button>
            </Empty>
          </div>
        )}
      </div>
    </div>
  );
}