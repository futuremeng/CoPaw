import { Alert, Button, Empty, Input, Select, Tag, Typography } from "antd";
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { isPreviewablePath } from "../utils/projectFileSelectionUtils";
import { formatGraphRelationTypeLabel } from "../utils/projectKnowledgeFilterLabels";
import { buildProjectKnowledgeLatestSummaryModelFromState } from "../utils/projectKnowledgeLatestSummaryModel";
import styles from "../index.module.less";
import type {
  ProjectKnowledgeProcessingMode,
  ProjectKnowledgeModeState,
  ProjectKnowledgeState,
} from "../hooks/useProjectKnowledgeState";
import {
  getProjectKnowledgeModeLabel,
  getProjectKnowledgeModeTitle,
  prioritizeProjectKnowledgeArtifacts,
} from "../utils/projectKnowledgeSyncUi";

interface ProjectKnowledgeOutputsPanelProps {
  knowledgeState: ProjectKnowledgeState;
  onRunSuggestedQuery?: (query: string) => void;
  onSelectArtifactPath?: (path: string) => void;
}

const INITIAL_VISIBLE_ARTIFACTS = 40;
const INITIAL_VISIBLE_RELATIONS = 120;
const LOAD_MORE_ARTIFACTS_STEP = 40;
const LOAD_MORE_RELATIONS_STEP = 120;

function modeUnavailableReason(
  mode: ProjectKnowledgeModeState | undefined,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (!mode) {
    return t("copaw.projects.knowledge.outputs.fallbackUnknown");
  }
  if (mode.status === "failed") {
    return t("copaw.projects.knowledge.outputs.fallbackFailed");
  }
  if (mode.status === "queued") {
    return t("copaw.projects.knowledge.outputs.fallbackQueued");
  }
  if (mode.status === "running") {
    return t("copaw.projects.knowledge.outputs.fallbackRunning");
  }
  if (!mode.available) {
    return t("copaw.projects.knowledge.outputs.fallbackUnavailable");
  }
  return t("copaw.projects.knowledge.outputs.fallbackNotSelected");
}

function isPreviewableKnowledgeArtifactPath(path: string): boolean {
  if (!path) {
    return false;
  }
  return isPreviewablePath(path);
}

export default function ProjectKnowledgeOutputsPanel(
  props: ProjectKnowledgeOutputsPanelProps,
) {
  const { t } = useTranslation();
  const outputModes = props.knowledgeState.outputModes;
  const initialSelectedMode = outputModes.find(
    (item) => item.mode === props.knowledgeState.outputResolution.activeMode,
  )?.mode || outputModes[0]?.mode || props.knowledgeState.outputResolution.activeMode;
  const [keyword, setKeyword] = useState("");
  const [predicateFilter, setPredicateFilter] = useState("");
  const [visibleArtifactCount, setVisibleArtifactCount] = useState(INITIAL_VISIBLE_ARTIFACTS);
  const [visibleRelationCount, setVisibleRelationCount] = useState(INITIAL_VISIBLE_RELATIONS);
  const [selectedMode, setSelectedMode] = useState<ProjectKnowledgeProcessingMode>(
    initialSelectedMode,
  );
  const deferredKeyword = useDeferredValue(keyword);
  const deferredPredicateFilter = useDeferredValue(predicateFilter);

  useEffect(() => {
    setSelectedMode(initialSelectedMode);
  }, [initialSelectedMode]);

  useEffect(() => {
    setVisibleArtifactCount(INITIAL_VISIBLE_ARTIFACTS);
  }, [selectedMode]);

  useEffect(() => {
    setVisibleRelationCount(INITIAL_VISIBLE_RELATIONS);
  }, [selectedMode, deferredKeyword, deferredPredicateFilter]);

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
    () => outputModes.find((item) => item.mode === selectedMode)
      || outputModes[0],
    [outputModes, selectedMode],
  );

  const selectedModeOutput = useMemo(
    () => props.knowledgeState.modeOutputs[selectedMode],
    [props.knowledgeState.modeOutputs, selectedMode],
  );
  const sortedArtifacts = useMemo(
    () => prioritizeProjectKnowledgeArtifacts(selectedModeOutput?.artifacts || []),
    [selectedModeOutput?.artifacts],
  );
  const artifactCount = sortedArtifacts.length;

  const canShowGraphRecords = selectedMode === "nlp" || selectedMode === "agentic";
  const modeRefreshPending = canShowGraphRecords
    && selectedMode !== props.knowledgeState.outputResolution.activeMode;

  const fallbackTrail = useMemo(
    () => props.knowledgeState.outputResolution.fallbackChain
      .map((mode) => getProjectKnowledgeModeLabel(mode, t))
      .join(" -> "),
    [props.knowledgeState.outputResolution.fallbackChain, t],
  );

  const fallbackSkippedSummary = useMemo(() => {
    const skippedModes = props.knowledgeState.outputResolution.skippedModes || [];
    if (skippedModes.length > 0) {
      return skippedModes
        .map((item) => `${getProjectKnowledgeModeLabel(item.mode, t)}: ${item.reason || modeUnavailableReason(undefined, t)}`)
        .join("；");
    }

    const chain = props.knowledgeState.outputResolution.fallbackChain;
    const activeIndex = chain.indexOf(props.knowledgeState.outputResolution.activeMode);
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
    props.knowledgeState.outputResolution.activeMode,
    props.knowledgeState.outputResolution.fallbackChain,
    props.knowledgeState.outputResolution.skippedModes,
    props.knowledgeState.processingModes,
    t,
  ]);

  const filteredRecords = useMemo(() => {
    const normalizedKeyword = deferredKeyword.trim().toLowerCase();
    return props.knowledgeState.relationRecords.filter((item) => {
      if (deferredPredicateFilter && item.predicate !== deferredPredicateFilter) {
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
  }, [deferredKeyword, deferredPredicateFilter, props.knowledgeState.relationRecords]);

  const visibleArtifacts = useMemo(
    () => sortedArtifacts.slice(0, visibleArtifactCount),
    [sortedArtifacts, visibleArtifactCount],
  );
  const documentGraphSummary = useMemo(() => {
    if (selectedMode !== "nlp") {
      return null;
    }
    const manifestArtifact = sortedArtifacts.find((artifact) => artifact.kind === "document_graph_manifest");
    const directoryArtifact = sortedArtifacts.find((artifact) => artifact.kind === "document_graph_dir");
    if (!manifestArtifact && !directoryArtifact) {
      return null;
    }

    const payloadSummary = (selectedModeOutput?.summaryLines || []).find((line) => line.startsWith("Document graphify payloads:")) || "";
    const details = [
      payloadSummary,
      manifestArtifact?.path
        ? manifestArtifact.path
        : "",
      directoryArtifact?.path
        ? directoryArtifact.path
        : "",
    ].filter(Boolean);

    return {
      title: t("copaw.projects.knowledge.outputs.documentGraphReady"),
      payloadSummary,
      manifestPath: manifestArtifact?.path || "",
      directoryPath: directoryArtifact?.path || "",
      details,
    };
  }, [props, selectedMode, selectedModeOutput?.summaryLines, sortedArtifacts, t]);
  const latestSummaryModel = useMemo(
    () => buildProjectKnowledgeLatestSummaryModelFromState(t, props.knowledgeState, selectedMode),
    [
      props.knowledgeState.fileAnalysisStats?.latest,
      props.knowledgeState.projectStepStats.build_interlinear?.latest,
      props.knowledgeState.projectStepStats.tokenize?.latest,
      props.knowledgeState.projectStepStats.pos_tagging?.latest,
      props.knowledgeState.projectStepStats.syntax_parse?.latest,
      props.knowledgeState.projectStepStats.semantic_role_labeling?.latest,
      props.knowledgeState.sourceScanStats?.latest,
      selectedMode,
      t,
    ],
  );

  const visibleRelations = useMemo(
    () => filteredRecords.slice(0, visibleRelationCount),
    [filteredRecords, visibleRelationCount],
  );

  return (
    <>
      <div className={styles.projectKnowledgeWorkbench}>
      <div>
        <Typography.Title level={5} className={styles.projectKnowledgeSectionTitle}>
          {t("projects.knowledgeDock.tabOutputs", "Outputs")}
        </Typography.Title>
        <Typography.Text type="secondary">{t("copaw.projects.knowledge.outputsRoleHint")}</Typography.Text>
      </div>
      <div className={styles.projectKnowledgeTabActions}>
        <Select
          size="small"
          value={selectedMode}
          classNames={{ popup: { root: styles.projectKnowledgeSelectDropdown } }}
          style={{ width: 180 }}
          options={outputModes.map((item) => ({
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
              props.knowledgeState.graphQueryText,
              props.knowledgeState.graphQueryMode,
              props.knowledgeState.graphQueryTopK,
              selectedMode,
            );
          }}
          loading={props.knowledgeState.graphLoading}
        >
          {t("copaw.projects.knowledge.actionRefreshSignals")}
        </Button>
      </div>
      </div>

      {(props.knowledgeState.graphNeedsRefresh || modeRefreshPending) ? (
        <Alert
          type="warning"
          showIcon
          message={t("copaw.projects.knowledge.refreshPending")}
          description={t("copaw.projects.knowledge.refreshPendingHint")}
        />
      ) : null}

      <div className={styles.projectKnowledgeOutputsHero}>
        <div className={styles.projectKnowledgeOutputsHeroMain}>
          <Typography.Text type="secondary">{t("copaw.projects.knowledge.outputs.currentMode")}</Typography.Text>
          <Typography.Title level={5} className={styles.projectKnowledgeSectionTitle}>
            {selectedModeState
              ? getProjectKnowledgeModeTitle(selectedModeState.mode, t)
              : t("copaw.projects.knowledge.processing.none")}
          </Typography.Title>
          <Typography.Text type="secondary">{props.knowledgeState.outputResolution.reason}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeOutputsHeroAside}>
          <div className={styles.projectKnowledgeHeaderStat}>
            <Typography.Text type="secondary">{t("copaw.projects.knowledge.outputs.fallbackChain")}</Typography.Text>
            <Typography.Text strong>{fallbackTrail}</Typography.Text>
          </div>
          <div className={styles.projectKnowledgeHeaderStat}>
            <Typography.Text type="secondary">{t("copaw.projects.knowledge.outputs.artifactCount")}</Typography.Text>
            <Typography.Text strong>{artifactCount}</Typography.Text>
          </div>
        </div>
      </div>

      {fallbackSkippedSummary ? (
        <Alert
          type="info"
          showIcon
          message={t("copaw.projects.knowledge.outputs.skippedLayers")}
          description={fallbackSkippedSummary}
        />
      ) : null}

      <div className={styles.projectKnowledgeSignalGrid}>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("copaw.projects.knowledge.outputs.selectedMode")}</Typography.Text>
          <Typography.Text strong>{getProjectKnowledgeModeLabel(selectedModeState.mode, t)}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("copaw.projects.knowledge.outputs.artifactCount")}</Typography.Text>
          <Typography.Text strong>{artifactCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("copaw.projects.knowledge.entities")}</Typography.Text>
          <Typography.Text strong>{selectedModeState.entityCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("copaw.projects.knowledge.signalRelations")}</Typography.Text>
          <Typography.Text strong>{selectedModeState.relationCount}</Typography.Text>
        </div>
      </div>

      <Alert
        type="info"
        showIcon
        message={t("copaw.projects.knowledge.outputs.selectedSource")}
        description={[
          selectedModeOutput?.source || t("copaw.projects.knowledge.outputs.noSource"),
          ...(selectedModeOutput?.summaryLines || []),
        ].filter(Boolean).join(" · ")}
      />

      {latestSummaryModel.outputParts.length ? (
        <Alert
          type="info"
          showIcon
          message={t("copaw.projects.knowledge.outputs.latestOutputSummary")}
          description={latestSummaryModel.outputParts.join(" · ")}
        />
      ) : null}

      {documentGraphSummary ? (
        <div className={styles.artifactSummaryBlock}>
          <div className={styles.artifactSummaryGroups}>
            <div className={styles.artifactSummaryGroup}>
              <div className={styles.artifactSummaryTitle}>
                {documentGraphSummary.title}
              </div>
              <Typography.Text>
                {documentGraphSummary.payloadSummary || t("copaw.projects.knowledge.outputs.documentGraphPayloadFallback")}
              </Typography.Text>
            </div>
            {documentGraphSummary.manifestPath ? (
              <div className={styles.artifactSummaryGroup}>
                <div className={styles.artifactSummaryTitle}>
                  {t("copaw.projects.knowledge.outputs.documentGraphManifestLabel")}
                </div>
                {props.onSelectArtifactPath ? (
                  <Button
                    type="link"
                    size="small"
                    style={{ paddingInline: 0, height: "auto", justifyContent: "flex-start" }}
                    onClick={() => props.onSelectArtifactPath?.(documentGraphSummary.manifestPath)}
                  >
                    {documentGraphSummary.manifestPath}
                  </Button>
                ) : (
                  <Typography.Text>{documentGraphSummary.manifestPath}</Typography.Text>
                )}
              </div>
            ) : null}
            {documentGraphSummary.directoryPath ? (
              <div className={styles.artifactSummaryGroup}>
                <div className={styles.artifactSummaryTitle}>
                  {t("copaw.projects.knowledge.outputs.documentGraphDirectoryLabel")}
                </div>
                {props.onSelectArtifactPath ? (
                  <Button
                    type="link"
                    size="small"
                    style={{ paddingInline: 0, height: "auto", justifyContent: "flex-start" }}
                    onClick={() => props.onSelectArtifactPath?.(documentGraphSummary.directoryPath)}
                  >
                    {documentGraphSummary.directoryPath}
                  </Button>
                ) : (
                  <Typography.Text>{documentGraphSummary.directoryPath}</Typography.Text>
                )}
              </div>
            ) : null}
            {(documentGraphSummary.manifestPath || documentGraphSummary.directoryPath) && props.onSelectArtifactPath ? (
              <div className={styles.artifactSummaryGroup}>
                <div className={styles.artifactSummaryTitle}>
                  {t("copaw.projects.knowledge.outputs.documentGraphActions")}
                </div>
                <div>
                  {documentGraphSummary.manifestPath ? (
                    <Button
                      type="link"
                      size="small"
                      style={{ paddingInline: 0, height: "auto" }}
                      onClick={() => props.onSelectArtifactPath?.(documentGraphSummary.manifestPath)}
                    >
                      {t("copaw.projects.knowledge.outputs.previewManifest")}
                    </Button>
                  ) : null}
                  {documentGraphSummary.directoryPath ? (
                    <Button
                      type="link"
                      size="small"
                      style={{ paddingInline: 0, height: "auto", marginLeft: 12 }}
                      onClick={() => props.onSelectArtifactPath?.(documentGraphSummary.directoryPath)}
                    >
                      {t("copaw.projects.knowledge.outputs.openPayloadDirectory")}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={styles.projectKnowledgeRelationList}>
        {visibleArtifacts.map((artifact) => (
          <div key={`${artifact.kind}:${artifact.path}`} className={styles.projectKnowledgeRelationCard}>
            <div className={styles.projectKnowledgeCardHeader}>
              <Typography.Text strong>{artifact.label || artifact.kind}</Typography.Text>
              <Tag>{artifact.kind}</Tag>
            </div>
            <div className={styles.projectKnowledgeMetaLine}>
                {isPreviewableKnowledgeArtifactPath(artifact.path) && props.onSelectArtifactPath ? (
                  <Button
                    type="link"
                    size="small"
                    style={{ paddingInline: 0, height: "auto" }}
                    onClick={() => props.onSelectArtifactPath?.(artifact.path)}
                  >
                    {artifact.path}
                  </Button>
                ) : (
                  <span>{artifact.path}</span>
                )}
            </div>
          </div>
        ))}
      </div>
      {artifactCount > visibleArtifacts.length ? (
        <div className={styles.projectKnowledgeListFooter}>
          <Typography.Text type="secondary">
            {t("copaw.projects.knowledge.outputs.renderedArtifacts", {
              shown: visibleArtifacts.length,
              total: artifactCount,
            })}
          </Typography.Text>
          <Button
            size="small"
            onClick={() => setVisibleArtifactCount((prev) => prev + LOAD_MORE_ARTIFACTS_STEP)}
          >
            {t("copaw.projects.knowledge.outputs.loadMoreArtifacts")}
          </Button>
        </div>
      ) : null}

      {canShowGraphRecords ? (
        <Alert
          type="warning"
          showIcon
          message={t("copaw.projects.knowledge.outputs.compatTitle")}
          description={t("copaw.projects.knowledge.outputs.compatDescription")}
        />
      ) : null}

      {canShowGraphRecords ? (
      <div className={styles.projectKnowledgeControls}>
        <Input
          value={keyword}
          onChange={(event) => {
            const nextValue = event.target.value;
            startTransition(() => {
              setKeyword(nextValue);
            });
          }}
          placeholder={t("copaw.projects.knowledge.relationSearchPlaceholder")}
          allowClear
        />
        <Select
          value={predicateFilter || undefined}
          allowClear
          size="small"
          classNames={{ popup: { root: styles.projectKnowledgeSelectDropdown } }}
          placeholder={t("copaw.projects.knowledge.relationTypeFilter")}
          options={predicateOptions.map((item) => ({
            label: formatGraphRelationTypeLabel(item, (key, defaultValue) => t(key, defaultValue)),
            value: item,
          }))}
          onChange={(value) => {
            startTransition(() => {
              setPredicateFilter(String(value || ""));
            });
          }}
          style={{ width: 220 }}
        />
      </div>
      ) : null}

      <div className={styles.projectKnowledgePanelBody}>
        {!canShowGraphRecords ? (
          <div className={styles.projectKnowledgeEmpty}>
            <Empty description={t("copaw.projects.knowledge.outputs.highOrderEmpty")} />
          </div>
        ) : props.knowledgeState.graphLoading && !props.knowledgeState.graphResult ? (
          <div className={styles.projectKnowledgeEmpty}><Empty description={t("common.loading", "Loading")} /></div>
        ) : filteredRecords.length ? (
          <>
            <div className={styles.projectKnowledgeListFooter}>
              <Typography.Text type="secondary">
                {t("copaw.projects.knowledge.outputs.renderedRelations", {
                  shown: visibleRelations.length,
                  total: filteredRecords.length,
                })}
              </Typography.Text>
            </div>
          <div className={styles.projectKnowledgeRelationList}>
            {visibleRelations.map((record, index) => (
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
          {filteredRecords.length > visibleRelations.length ? (
            <div className={styles.projectKnowledgeListFooter}>
              <Button
                size="small"
                onClick={() => setVisibleRelationCount((prev) => prev + LOAD_MORE_RELATIONS_STEP)}
              >
                {t("copaw.projects.knowledge.outputs.loadMoreRelations")}
              </Button>
            </div>
          ) : null}
          </>
        ) : (
          <div className={styles.projectKnowledgeEmpty}>
            <Empty description={t("copaw.projects.knowledge.emptyResult")}>
              <Button type="primary" onClick={() => props.onRunSuggestedQuery?.(props.knowledgeState.suggestedQuery)}>
                {t("copaw.projects.knowledge.actionRunSuggestedQuery")}
              </Button>
            </Empty>
          </div>
        )}
      </div>
    </>
  );
}