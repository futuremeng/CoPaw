import { Empty, Tag } from "antd";
import { useTranslation } from "react-i18next";
import type { ProjectPipelineRunDetail } from "../../../api/types/agents";
import styles from "./index.module.less";

function eventDisplayName(t: (key: string) => string, event: string): string {
  const key = (event || "").toLowerCase();
  if (key === "run.restarted") {
    return t("projects.pipeline.event.runRestarted");
  }
  if (key === "step.carried_forward") {
    return t("projects.pipeline.event.stepCarriedForward");
  }
  if (key === "step.started") {
    return t("projects.pipeline.event.stepStarted");
  }
  if (key === "step.completed") {
    return t("projects.pipeline.event.stepCompleted");
  }
  if (key === "step.failed") {
    return t("projects.pipeline.event.stepFailed");
  }
  return event || t("projects.pipeline.event.unknown");
}

function eventEvidencePreview(evidence: string[]): string | null {
  if (!evidence || evidence.length === 0) {
    return null;
  }
  const preview = evidence.slice(0, 3).join(", ");
  return evidence.length > 3 ? `${preview} +${evidence.length - 3}` : preview;
}

function eventTagColor(event: string): string {
  const key = (event || "").toLowerCase();
  if (key.includes("failed") || key.includes("blocked")) {
    return "red";
  }
  if (key.includes("restarted") || key.includes("carried_forward")) {
    return "blue";
  }
  if (key.includes("completed")) {
    return "green";
  }
  if (key.includes("started")) {
    return "gold";
  }
  return "default";
}

function eventStatusLabel(t: (key: string) => string, status: string): string {
  const key = (status || "info").toLowerCase();
  const statusMap: Record<string, string> = {
    info: "projects.pipeline.status.info",
    succeeded: "projects.pipeline.status.succeeded",
    running: "projects.pipeline.status.running",
    failed: "projects.pipeline.status.failed",
    blocked: "projects.pipeline.status.blocked",
    cancelled: "projects.pipeline.status.cancelled",
    pending: "projects.pipeline.status.pending",
  };
  return t(statusMap[key] || statusMap.info);
}

function localizeInputScope(t: (key: string) => string, scope: string): string {
  const key = (scope || "").toLowerCase();
  const map: Record<string, string> = {
    all_original: "projects.pipeline.inputScopeValue.allOriginal",
  };
  return map[key] ? t(map[key]) : scope || t("projects.pipeline.inputScopeValue.unknown");
}

function localizeInputScopePolicy(t: (key: string) => string, policy: string): string {
  const key = (policy || "").toLowerCase();
  const map: Record<string, string> = {
    default_if_no_batch_upload: "projects.pipeline.inputScopePolicyValue.defaultIfNoBatchUpload",
  };
  return map[key] ? t(map[key]) : policy || t("projects.pipeline.inputScopePolicyValue.unknown");
}

interface ProjectEvidencePanelProps {
  runDetail: ProjectPipelineRunDetail | null;
  showTimeline?: boolean;
  showEvidence?: boolean;
}

export default function ProjectEvidencePanel({
  runDetail,
  showTimeline = true,
  showEvidence = true,
}: ProjectEvidencePanelProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.previewBody}>
      {!runDetail ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("projects.pipeline.noRun")}
        />
      ) : (
        <div className={styles.metricPanel}>
          {(runDetail.parameters?.input_scope || runDetail.parameters?.input_scope_policy) ? (
            <>
              <div className={styles.subSectionTitle}>{t("projects.pipeline.inputScopeSummary")}</div>
              <div className={styles.metricBlock}>
                {runDetail.parameters?.input_scope ? (
                  <div className={styles.itemMeta}>
                    {t("projects.pipeline.inputScope")}: {localizeInputScope(t, String(runDetail.parameters.input_scope))}
                  </div>
                ) : null}
                {runDetail.parameters?.input_scope_policy ? (
                  <div className={styles.itemMeta}>
                    {t("projects.pipeline.inputScopePolicy")}: {localizeInputScopePolicy(
                      t,
                      String(runDetail.parameters.input_scope_policy),
                    )}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {showTimeline ? (
            <>
              <div className={styles.subSectionTitle}>
                {t("projects.pipeline.timeline")}
              </div>
              {runDetail.collaboration_events && runDetail.collaboration_events.length > 0 ? (
                [...runDetail.collaboration_events].reverse().map((event, index) => (
                  <div key={`${event.ts}-${event.event}-${index}`} className={styles.timelineBlock}>
                    <div className={styles.itemTitleRow}>
                      <span className={styles.itemTitle}>{eventDisplayName(t, event.event)}</span>
                      <Tag color={eventTagColor(event.event)}>{eventStatusLabel(t, event.status || "info")}</Tag>
                    </div>
                    <div className={styles.timelineMetaRow}>
                      <span className={styles.itemMeta}>{event.ts}</span>
                      {event.step_id ? (
                        <span className={styles.itemMeta}>
                          {t("projects.pipeline.step")}: {event.step_id}
                        </span>
                      ) : null}
                      {event.role ? (
                        <span className={styles.itemMeta}>
                          {t("projects.pipeline.role")}: {event.role}
                        </span>
                      ) : null}
                    </div>
                    {event.message ? <div className={styles.itemMeta}>{event.message}</div> : null}
                    {eventEvidencePreview(event.evidence) ? (
                      <div className={styles.itemMeta}>
                        {t("projects.pipeline.evidenceBrief")}: {eventEvidencePreview(event.evidence)}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className={styles.itemMeta}>
                  {t("projects.pipeline.noTimeline")}
                </div>
              )}
            </>
          ) : null}

          {showEvidence ? (
            <>
              <div className={styles.subSectionTitle}>
                {t("projects.evidence")}
              </div>
              {runDetail.steps.map((step) => (
                <div key={step.id} className={styles.metricBlock}>
                  <div className={styles.itemTitle}>{step.name}</div>
                  {step.evidence.length === 0 ? (
                    <div className={styles.itemMeta}>{t("projects.pipeline.noEvidence")}</div>
                  ) : (
                    step.evidence.map((item) => (
                      <div key={`${step.id}-${item}`} className={styles.itemMeta}>
                        {item}
                      </div>
                    ))
                  )}
                </div>
              ))}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}