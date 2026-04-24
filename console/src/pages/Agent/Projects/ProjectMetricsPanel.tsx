import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Empty, Select, Spin, Tag } from "antd";
import { useTranslation } from "react-i18next";
import { agentsApi } from "../../../api/modules/agents";
import type { ProjectPipelineRunSummary } from "../../../api/types/agents";
import type { ProjectPipelineRunDetail } from "../../../api/types/agents";
import styles from "./index.module.less";

interface RunProgressSummary {
  total: number;
  completed: number;
  running: number;
  pending: number;
}

interface ProjectMetricsPanelProps {
  currentAgentId?: string;
  selectedProjectRequestId?: string;
  runDetail: ProjectPipelineRunDetail | null;
  selectedRunId: string;
  pipelineRuns: ProjectPipelineRunSummary[];
  runProgress: RunProgressSummary;
  statusTagColor: (status: string) => string;
  formatRunTimeLabel: (raw: string) => string;
  onSelectArtifactPath?: (path: string) => void;
}

function resolveArtifactCompareKey(item: ProjectPipelineRunDetail["artifact_records"][number]): string {
  return item.published_path || item.logical_key || item.path;
}

type ArtifactCompareEntry = {
  compareKey: string;
  currentPath: string;
  baselinePath: string;
};

function toTimestamp(raw?: string | null): number {
  if (!raw) {
    return 0;
  }
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

function toNumericMetric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function formatDelta(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (value > 0) {
    return `+${value}`;
  }
  return `${value}`;
}

export default function ProjectMetricsPanel({
  currentAgentId,
  selectedProjectRequestId,
  runDetail,
  selectedRunId,
  pipelineRuns,
  runProgress,
  statusTagColor,
  formatRunTimeLabel,
  onSelectArtifactPath,
}: ProjectMetricsPanelProps) {
  const { t } = useTranslation();
  const [compareRunId, setCompareRunId] = useState("");
  const [compareRunDetail, setCompareRunDetail] = useState<ProjectPipelineRunDetail | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState("");

  const compareCandidates = useMemo(
    () =>
      [...pipelineRuns]
        .filter((run) => run.id !== selectedRunId)
        .sort(
          (a, b) =>
            toTimestamp(b.updated_at || b.created_at) -
            toTimestamp(a.updated_at || a.created_at),
        ),
    [pipelineRuns, selectedRunId],
  );

  useEffect(() => {
    if (!selectedRunId || compareCandidates.length === 0) {
      setCompareRunId("");
      return;
    }
    setCompareRunId((prev) => {
      if (prev && compareCandidates.some((item) => item.id === prev)) {
        return prev;
      }
      return compareCandidates[0]?.id || "";
    });
  }, [compareCandidates, selectedRunId]);

  useEffect(() => {
    if (!currentAgentId || !selectedProjectRequestId || !compareRunId) {
      setCompareRunDetail(null);
      setCompareError("");
      return;
    }

    let cancelled = false;
    setCompareLoading(true);
    setCompareError("");
    void agentsApi
      .getProjectPipelineRun(currentAgentId, selectedProjectRequestId, compareRunId)
      .then((detail) => {
        if (!cancelled) {
          setCompareRunDetail(detail);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCompareRunDetail(null);
          setCompareError(t("projects.pipeline.compareLoadFailed", "Failed to load compare run"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCompareLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [compareRunId, currentAgentId, selectedProjectRequestId, t]);

  const compareStepMetricsById = useMemo(() => {
    const mapping = new Map<string, Record<string, unknown>>();
    for (const step of compareRunDetail?.steps || []) {
      mapping.set(step.id, step.metrics || {});
    }
    return mapping;
  }, [compareRunDetail?.steps]);

  const artifactCompareSummary = useMemo(() => {
    const currentByKey = new Map<string, string>();
    for (const item of runDetail?.artifact_records || []) {
      const compareKey = resolveArtifactCompareKey(item);
      if (!currentByKey.has(compareKey)) {
        currentByKey.set(compareKey, item.path);
      }
    }

    const baselineByKey = new Map<string, string>();
    for (const item of compareRunDetail?.artifact_records || []) {
      const compareKey = resolveArtifactCompareKey(item);
      if (!baselineByKey.has(compareKey)) {
        baselineByKey.set(compareKey, item.path);
      }
    }

    const shared: ArtifactCompareEntry[] = [];
    const currentOnly: ArtifactCompareEntry[] = [];
    const baselineOnly: ArtifactCompareEntry[] = [];

    for (const [compareKey, currentPath] of currentByKey) {
      const baselinePath = baselineByKey.get(compareKey) || "";
      if (baselinePath) {
        shared.push({ compareKey, currentPath, baselinePath });
      } else {
        currentOnly.push({ compareKey, currentPath, baselinePath: "" });
      }
    }

    for (const [compareKey, baselinePath] of baselineByKey) {
      if (!currentByKey.has(compareKey)) {
        baselineOnly.push({ compareKey, currentPath: "", baselinePath });
      }
    }

    const compareEntries = (left: ArtifactCompareEntry, right: ArtifactCompareEntry) =>
      left.compareKey.localeCompare(right.compareKey);

    shared.sort(compareEntries);
    currentOnly.sort(compareEntries);
    baselineOnly.sort(compareEntries);

    return {
      shared,
      currentOnly,
      baselineOnly,
    };
  }, [compareRunDetail?.artifact_records, runDetail?.artifact_records]);

  const renderPathLinks = useCallback(
    (entries: ArtifactCompareEntry[], mode: "current" | "baseline" | "shared") => {
      if (entries.length === 0) {
        return null;
      }
      return (
        <div style={{ marginTop: 4, display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          {entries.slice(0, 6).map((entry) => {
            const targetPath = mode === "baseline"
              ? entry.baselinePath
              : entry.currentPath || entry.baselinePath;
            const label = mode === "shared"
              ? `${entry.compareKey} -> ${entry.currentPath || entry.baselinePath}`
              : entry.compareKey;

            return (
            <Button
              key={`${mode}:${entry.compareKey}`}
              type="link"
              size="small"
              style={{ paddingInline: 0, height: "auto" }}
              onClick={() => onSelectArtifactPath?.(targetPath)}
            >
              {label}
            </Button>
            );
          })}
          {entries.length > 6 ? (
            <span className={styles.itemMeta}>+{entries.length - 6}</span>
          ) : null}
        </div>
      );
    },
    [onSelectArtifactPath],
  );

  return (
    <div className={styles.previewBody}>
      {!runDetail ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("projects.pipeline.noRun", "No run")}
        />
      ) : (
        <div className={styles.metricPanel}>
          <div className={styles.metricBlock}>
            <div className={styles.itemTitleRow}>
              <span className={styles.itemTitle}>{t("projects.pipeline.compare", "Run Compare")}</span>
            </div>
            {compareCandidates.length === 0 ? (
              <div className={styles.itemMeta}>
                {t("projects.pipeline.noCompareRun", "No historical run available for comparison")}
              </div>
            ) : (
              <>
                <Select
                  size="small"
                  value={compareRunId || undefined}
                  onChange={setCompareRunId}
                  style={{ width: "100%", maxWidth: 420 }}
                  options={compareCandidates.map((item) => ({
                    value: item.id,
                    label: `${item.id} · ${item.status || "unknown"} · ${formatRunTimeLabel(
                      item.updated_at || item.created_at || "",
                    )}`,
                  }))}
                  placeholder={t("projects.pipeline.comparePlaceholder", "Select baseline run")}
                />
                {compareLoading ? (
                  <div className={styles.itemMeta} style={{ marginTop: 8 }}>
                    <Spin size="small" /> {t("projects.pipeline.compareLoading", "Loading compare run")}
                  </div>
                ) : null}
                {compareError ? (
                  <Alert
                    type="warning"
                    showIcon
                    message={compareError}
                    style={{ marginTop: 8 }}
                  />
                ) : null}

                {compareRunDetail && !compareLoading && !compareError ? (
                  <div style={{ marginTop: 8 }}>
                    <div className={styles.itemMeta}>
                      {t("projects.pipeline.compareArtifactsShared", "Shared artifacts")}: {artifactCompareSummary.shared.length}
                    </div>
                    <div className={styles.itemMeta}>
                      {t("projects.pipeline.compareArtifactsCurrentOnly", "Current-only artifacts")}: {artifactCompareSummary.currentOnly.length}
                    </div>
                    <div className={styles.itemMeta}>
                      {t("projects.pipeline.compareArtifactsBaselineOnly", "Baseline-only artifacts")}: {artifactCompareSummary.baselineOnly.length}
                    </div>
                    {artifactCompareSummary.currentOnly.length > 0 ? (
                      <div className={styles.itemMeta}>
                        {t("projects.pipeline.compareArtifactsCurrentOnlyPreview", "Current only")}:
                        {renderPathLinks(artifactCompareSummary.currentOnly, "current")}
                      </div>
                    ) : null}
                    {artifactCompareSummary.shared.length > 0 ? (
                      <div className={styles.itemMeta}>
                        {t("projects.pipeline.compareArtifactsSharedPreview", "Shared paths")}:
                        {renderPathLinks(artifactCompareSummary.shared, "shared")}
                      </div>
                    ) : null}
                    {artifactCompareSummary.baselineOnly.length > 0 ? (
                      <div className={styles.itemMeta}>
                        {t("projects.pipeline.compareArtifactsBaselineOnlyPreview", "Baseline only")}:
                        {renderPathLinks(artifactCompareSummary.baselineOnly, "baseline")}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className={styles.metricSummaryGrid}>
            <div className={styles.metricSummaryCard}>
              <div className={styles.itemMeta}>Total Steps</div>
              <div className={styles.metricSummaryValue}>{runProgress.total}</div>
            </div>
            <div className={styles.metricSummaryCard}>
              <div className={styles.itemMeta}>Completed</div>
              <div className={styles.metricSummaryValue}>{runProgress.completed}</div>
            </div>
            <div className={styles.metricSummaryCard}>
              <div className={styles.itemMeta}>Running</div>
              <div className={styles.metricSummaryValue}>{runProgress.running}</div>
            </div>
            <div className={styles.metricSummaryCard}>
              <div className={styles.itemMeta}>Pending</div>
              <div className={styles.metricSummaryValue}>{runProgress.pending}</div>
            </div>
          </div>
          {runDetail.steps.map((step) => {
            const entries = Object.entries(step.metrics || {});
            const compareMetrics = compareStepMetricsById.get(step.id) || {};
            return (
              <div key={step.id} className={styles.metricBlock}>
                <div className={styles.itemTitleRow}>
                  <span className={styles.itemTitle}>{step.name}</span>
                  <Tag color={statusTagColor(step.status)}>{step.status}</Tag>
                </div>
                {entries.length === 0 ? (
                  <div className={styles.itemMeta}>No metrics</div>
                ) : (
                  entries.map(([key, value]) => {
                    const currentNumeric = toNumericMetric(value);
                    const compareNumeric = toNumericMetric(compareMetrics[key]);
                    const hasCompare = currentNumeric !== null && compareNumeric !== null;
                    const delta = hasCompare ? currentNumeric - compareNumeric : null;

                    return (
                      <div key={key} className={styles.itemMeta}>
                        {key}: {String(value)}
                        {hasCompare ? ` (${formatDelta(delta as number)} vs baseline)` : ""}
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}