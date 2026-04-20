import { Alert, Button, Empty, Input, Select, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./index.module.less";
import type {
  ProjectKnowledgeProcessingMode,
  ProjectKnowledgeModeState,
  ProjectKnowledgeState,
} from "./useProjectKnowledgeState";
import {
  getProjectKnowledgeModeLabel,
  getProjectKnowledgeModeTitle,
} from "./projectKnowledgeSyncUi";

interface ProjectKnowledgeOutputsPanelProps {
  knowledgeState: ProjectKnowledgeState;
  onRunSuggestedQuery?: (query: string) => void;
}

function modeUnavailableReason(
  mode: ProjectKnowledgeModeState | undefined,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (!mode) {
    return t("projects.knowledge.outputs.fallbackUnknown", "状态未知");
  }
  if (mode.status === "failed") {
    return t("projects.knowledge.outputs.fallbackFailed", "运行失败");
  }
  if (mode.status === "queued") {
    return t("projects.knowledge.outputs.fallbackQueued", "仍在排队");
  }
  if (mode.status === "running") {
    return t("projects.knowledge.outputs.fallbackRunning", "仍在运行");
  }
  if (!mode.available) {
    return t("projects.knowledge.outputs.fallbackUnavailable", "产物未就绪");
  }
  return t("projects.knowledge.outputs.fallbackNotSelected", "未被选为当前消费层");
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
  const artifactCount = (selectedModeOutput?.artifacts || []).length;

  const canShowGraphRecords = selectedMode === "nlp" || selectedMode === "agentic";
  const modeRefreshPending = canShowGraphRecords
    && selectedMode !== props.knowledgeState.activeOutputResolution.activeMode;

  const fallbackTrail = useMemo(
    () => props.knowledgeState.activeOutputResolution.fallbackChain
      .map((mode) => getProjectKnowledgeModeLabel(mode, t))
      .join(" -> "),
    [props.knowledgeState.activeOutputResolution.fallbackChain, t],
  );

  const fallbackSkippedSummary = useMemo(() => {
    const skippedModes = props.knowledgeState.activeOutputResolution.skippedModes || [];
    if (skippedModes.length > 0) {
      return skippedModes
        .map((item) => `${getProjectKnowledgeModeLabel(item.mode, t)}: ${item.reason || modeUnavailableReason(undefined, t)}`)
        .join("；");
    }

    const chain = props.knowledgeState.activeOutputResolution.fallbackChain;
    const activeIndex = chain.indexOf(props.knowledgeState.activeOutputResolution.activeMode);
    if (activeIndex <= 0) {
      return "";
    }
    return chain
      .slice(0, activeIndex)
      .map((mode) => {
        const modeState = props.knowledgeState.processingModes.find((item) => item.mode === mode);
        return `${getProjectKnowledgeModeLabel(mode, t)}: ${modeUnavailableReason(modeState, t)}`;
      })
      .join("；");
  }, [
    props.knowledgeState.activeOutputResolution.activeMode,
    props.knowledgeState.activeOutputResolution.fallbackChain,
    props.knowledgeState.activeOutputResolution.skippedModes,
    props.knowledgeState.processingModes,
    t,
  ]);

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
              "projects.knowledge.outputsRoleHint",
              "这里聚焦最终消费层与产物清单，不重复展示加工调度细节。",
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
              label: getProjectKnowledgeModeTitle(item.mode, t),
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

      <div className={styles.projectKnowledgeOutputsHero}>
        <div className={styles.projectKnowledgeOutputsHeroMain}>
          <Typography.Text type="secondary">{t("projects.knowledge.outputs.currentMode", "当前读取策略")}</Typography.Text>
          <Typography.Title level={5} className={styles.projectKnowledgeSectionTitle}>
            {getProjectKnowledgeModeTitle(props.knowledgeState.activeOutputResolution.activeMode, t)}
          </Typography.Title>
          <Typography.Text type="secondary">{props.knowledgeState.activeOutputResolution.reason}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeOutputsHeroAside}>
          <div className={styles.projectKnowledgeHeaderStat}>
            <Typography.Text type="secondary">{t("projects.knowledge.outputs.fallbackChain", "自动降级链")}</Typography.Text>
            <Typography.Text strong>{fallbackTrail}</Typography.Text>
          </div>
          <div className={styles.projectKnowledgeHeaderStat}>
            <Typography.Text type="secondary">{t("projects.knowledge.outputs.artifactCount", "Artifacts")}</Typography.Text>
            <Typography.Text strong>{artifactCount}</Typography.Text>
          </div>
        </div>
      </div>

      {fallbackSkippedSummary ? (
        <Alert
          type="info"
          showIcon
          message={t("projects.knowledge.outputs.skippedLayers", "上层未命中原因")}
          description={fallbackSkippedSummary}
        />
      ) : null}

      <div className={styles.projectKnowledgeSignalGrid}>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.outputs.selectedMode", "Selected Mode")}</Typography.Text>
          <Typography.Text strong>{getProjectKnowledgeModeLabel(selectedModeState.mode, t)}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.outputs.artifactCount", "Artifacts")}</Typography.Text>
          <Typography.Text strong>{artifactCount}</Typography.Text>
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