import type {
  ProjectKnowledgeQuantizationStage,
  ProjectKnowledgeSemanticEngineState,
  ProjectKnowledgeSyncState,
} from "../../../api/types";
import type { TFunction } from "i18next";

export type ProjectKnowledgeProcessingMode = "fast" | "nlp" | "agentic";

export interface ProjectKnowledgeArtifactLike {
  kind?: string | null;
  label?: string | null;
  path?: string | null;
}

type Translate = TFunction;

function getProjectKnowledgeArtifactPriority(artifact: ProjectKnowledgeArtifactLike): number {
  const kind = String(artifact.kind || "").trim();
  const path = String(artifact.path || "").trim().toLowerCase();

  if (kind === "graph") {
    return 0;
  }
  if (kind === "enriched_graph") {
    return 1;
  }
  if (kind === "pipeline_artifact" && path.endsWith("graph.enriched.json")) {
    return 2;
  }
  if (kind === "quality_report" || path.includes("quality-report")) {
    return 3;
  }
  if (kind === "document_graph_manifest") {
    return 4;
  }
  if (kind === "document_graph_dir") {
    return 5;
  }
  if (kind === "pipeline_artifact") {
    return 6;
  }
  if (kind === "preview") {
    return 7;
  }
  if (kind === "index") {
    return 8;
  }
  return 99;
}

export function prioritizeProjectKnowledgeArtifacts<T extends ProjectKnowledgeArtifactLike>(
  artifacts: T[] | null | undefined,
): T[] {
  if (!Array.isArray(artifacts) || artifacts.length <= 1) {
    return Array.isArray(artifacts) ? [...artifacts] : [];
  }

  return artifacts
    .map((artifact, index) => ({ artifact, index }))
    .sort((left, right) => {
      const priorityDelta =
        getProjectKnowledgeArtifactPriority(left.artifact)
        - getProjectKnowledgeArtifactPriority(right.artifact);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return left.index - right.index;
    })
    .map(({ artifact }) => artifact);
}

export function getProjectKnowledgeModeLevel(
  mode: ProjectKnowledgeProcessingMode,
): "L1" | "L2" | "L3" {
  if (mode === "fast") {
    return "L1";
  }
  if (mode === "nlp") {
    return "L2";
  }
  return "L3";
}

export function getProjectKnowledgeQuantizationStage(
  mode: ProjectKnowledgeProcessingMode,
): ProjectKnowledgeQuantizationStage {
  if (mode === "fast") {
    return "l1";
  }
  if (mode === "nlp") {
    return "l2";
  }
  return "l3";
}

export function getProjectKnowledgeModeLabel(
  mode: ProjectKnowledgeProcessingMode,
  t: Translate,
): string {
  if (mode === "fast") {
    return t("copaw.projects.knowledge.processing.fast");
  }
  if (mode === "nlp") {
    return t("copaw.projects.knowledge.processing.nlp");
  }
  return t("copaw.projects.knowledge.processing.agentic");
}

export function getProjectKnowledgeModeTitle(
  mode: ProjectKnowledgeProcessingMode,
  t: Translate,
): string {
  return `${getProjectKnowledgeModeLevel(mode)} · ${getProjectKnowledgeModeLabel(mode, t)}`;
}

export function getProjectKnowledgeModeRouteHint(
  mode: ProjectKnowledgeProcessingMode,
  t: Translate,
): string {
  if (mode === "fast") {
    return t("copaw.projects.knowledge.processing.fastHint");
  }
  if (mode === "nlp") {
    return t("copaw.projects.knowledge.processing.nlpHint");
  }
  return t("copaw.projects.knowledge.processing.agenticHint");
}

export function getProjectKnowledgePipelineStageLabel(
  stage: { key?: string | null; label?: string | null; label_key?: string | null },
  t: Translate,
): string {
  const explicitKey = String(stage.label_key || "").trim();
  if (explicitKey) {
    const fallback = String(stage.label || stage.key || "").trim() || explicitKey;
    return t(explicitKey, fallback);
  }
  const modeKey = String(stage.key || "").trim();
  if (modeKey === "fast" || modeKey === "nlp" || modeKey === "agentic") {
    return t(
      `copaw.projects.knowledge.pipelineStage.${modeKey}`,
      String(stage.label || modeKey).trim() || modeKey,
    );
  }
  return String(stage.label || modeKey).trim();
}

function formatSyncTime(raw: string | null | undefined): string {
  if (!raw) {
    return "";
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }
  const hh = String(parsed.getHours()).padStart(2, "0");
  const mm = String(parsed.getMinutes()).padStart(2, "0");
  const ss = String(parsed.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function getGraphStats(syncState: ProjectKnowledgeSyncState): {
  relationCount: number;
  nodeCount: number;
} | null {
  const memify = syncState.last_result?.memify;
  if (!memify || typeof memify !== "object") {
    return null;
  }
  const relationCount = Number((memify as { relation_count?: unknown }).relation_count);
  const nodeCount = Number((memify as { node_count?: unknown }).node_count);
  if (!Number.isFinite(relationCount) || relationCount <= 0) {
    return null;
  }
  return {
    relationCount,
    nodeCount: Number.isFinite(nodeCount) ? nodeCount : 0,
  };
}

export function getProjectKnowledgeSyncStageLabel(
  syncState: ProjectKnowledgeSyncState,
  t: Translate,
): string {
  const stage = String(syncState.current_stage || syncState.status || "idle").trim() || "idle";
  return t(`copaw.projects.knowledge.syncStage.${stage}`);
}

export function getProjectKnowledgeSemanticSummary(
  semanticEngine: ProjectKnowledgeSemanticEngineState | null | undefined,
  t: Translate,
): string {
  if (!semanticEngine) {
    return "";
  }
  const reasonCode = String(semanticEngine.reason_code || "").trim();
  const fallback = reasonCode === "SOURCE_NOT_READY"
    ? "Semantic engine waiting for project files to be scanned."
    : reasonCode === "HANLP_SIDECAR_UNCONFIGURED"
      ? "Semantic engine unavailable: HanLP sidecar is not configured."
      : reasonCode === "HANLP_SIDECAR_PYTHON_MISSING"
        ? "Semantic engine unavailable: HanLP sidecar Python executable was not found."
        : reasonCode === "HANLP_SIDECAR_PYTHON_INCOMPATIBLE"
          ? "Semantic engine unavailable: HanLP sidecar must use Python 3.6-3.9."
          : reasonCode === "HANLP_SIDECAR_EXEC_FAILED"
            ? "Semantic engine unavailable: HanLP sidecar health check failed."
    : reasonCode === "HANLP_IMPORT_UNAVAILABLE"
      ? "Semantic engine unavailable: HanLP2 module is not installed."
      : reasonCode === "HANLP_ENTRYPOINT_MISSING"
        ? "Semantic engine unavailable: HanLP2 tokenizer entry point is missing."
        : reasonCode === "HANLP_TOKENIZE_FAILED"
          ? "Semantic engine error: HanLP2 tokenization failed."
          : reasonCode === "SEMANTIC_STATE_INVALID"
            ? "Semantic engine error: invalid runtime state payload."
            : reasonCode === "SEMANTIC_STATE_UNKNOWN"
              ? "Semantic engine status is unknown."
              : String(semanticEngine.summary || semanticEngine.reason || "").trim();
  return t(`copaw.projects.knowledge.semanticReasonSummary.${reasonCode}`, fallback);
}

export function getProjectKnowledgeSemanticReasonLabel(
  semanticEngine: ProjectKnowledgeSemanticEngineState | null | undefined,
  t: Translate,
): string {
  if (!semanticEngine) {
    return "";
  }
  const reasonCode = String(semanticEngine.reason_code || "").trim();
  const fallback = reasonCode === "HANLP_IMPORT_UNAVAILABLE"
    ? "Module Unavailable"
    : reasonCode === "HANLP_SIDECAR_UNCONFIGURED"
      ? "Sidecar Unconfigured"
      : reasonCode === "HANLP_SIDECAR_PYTHON_MISSING"
        ? "Sidecar Python Missing"
        : reasonCode === "HANLP_SIDECAR_PYTHON_INCOMPATIBLE"
          ? "Sidecar Python Incompatible"
          : reasonCode === "HANLP_SIDECAR_EXEC_FAILED"
            ? "Sidecar Check Failed"
    : reasonCode === "HANLP_ENTRYPOINT_MISSING"
      ? "Tokenizer Entry Missing"
      : reasonCode === "HANLP_TOKENIZE_FAILED"
        ? "Tokenization Failed"
        : reasonCode === "SOURCE_NOT_READY"
          ? "Source Not Ready"
          : reasonCode === "SEMANTIC_STATE_INVALID"
            ? "Invalid Semantic State"
            : reasonCode === "SEMANTIC_STATE_UNKNOWN"
              ? "Unknown Semantic State"
              : "Ready";
  return t(`copaw.projects.knowledge.semanticReasonCode.${reasonCode}`, fallback);
}

export function getProjectKnowledgeSemanticDescription(
  semanticEngine: ProjectKnowledgeSemanticEngineState | null | undefined,
  t: Translate,
): string {
  if (!semanticEngine) {
    return "";
  }
  const reasonCode = String(semanticEngine.reason_code || "").trim();
  const summary = getProjectKnowledgeSemanticSummary(semanticEngine, t);
  const fallbackReason = String(semanticEngine.reason || "").trim();
  const suffix = summary || fallbackReason;
  return suffix
    ? `${t("copaw.projects.knowledge.semanticEngineCode")}: ${reasonCode}. ${suffix}`
    : `${t("copaw.projects.knowledge.semanticEngineCode")}: ${reasonCode}`;
}

export function getProjectKnowledgeSyncAlertDescription(
  syncState: ProjectKnowledgeSyncState,
  t: Translate,
): string {
  const graphStats = getGraphStats(syncState);
  const segments = [
    getProjectKnowledgeSyncStageLabel(syncState, t),
    `${syncState.percent ?? syncState.progress ?? 0}%`,
    syncState.stage_message || "",
    typeof syncState.current === "number" && typeof syncState.total === "number" && syncState.total > 0
      ? `${syncState.current}/${syncState.total}`
      : "",
    typeof syncState.eta_seconds === "number" && syncState.eta_seconds > 0
      ? `ETA ${syncState.eta_seconds}s`
      : "",
    graphStats
      ? t("copaw.projects.knowledge.syncGraphStats", {
          nodes: graphStats.nodeCount,
          relations: graphStats.relationCount,
        })
      : "",
    syncState.changed_count > 0
      ? t("copaw.projects.knowledge.syncChangedCount", { count: syncState.changed_count })
      : "",
    syncState.status === "queued" && syncState.scheduled_for
      ? t("copaw.projects.knowledge.syncScheduledFor", {
          time: formatSyncTime(syncState.scheduled_for),
        })
      : "",
    syncState.last_trigger
      ? t("copaw.projects.knowledge.syncTrigger", {
          trigger: syncState.last_trigger,
        })
      : "",
    syncState.last_error || "",
  ].filter(Boolean);

  return segments.join(" · ");
}

export function getProjectKnowledgeSyncAlertType(
  syncState: ProjectKnowledgeSyncState | null,
): "info" | "success" | "error" {
  if (!syncState) {
    return "info";
  }
  if (syncState.status === "failed") {
    return "error";
  }
  if (syncState.status === "succeeded") {
    return "success";
  }
  return "info";
}

export function getTriggerModeLabel(t: Translate, triggerMode?: string): string {
  if (!triggerMode) {
    return "未知";
  }
  if (triggerMode === "automatic") {
    return t("copaw.projects.knowledge.triggerModeAutomatic", "自动");
  }
  if (triggerMode === "manual") {
    return t("copaw.projects.knowledge.triggerModeManual", "手动");
  }
  return String(triggerMode);
}

export function getProcessingStatusLabel(t: Translate, status?: string): string {
  if (!status) {
    return "未知";
  }

  const statusMap: Record<string, string> = {
    idle: t("copaw.projects.knowledge.processingStatusNotProcessed", "未加工"),
    queued: t("copaw.projects.knowledge.processingStatusProcessing", "正在加工"),
    pending: t("copaw.projects.knowledge.processingStatusProcessing", "正在加工"),
    indexing: t("copaw.projects.knowledge.processingStatusProcessing", "正在加工"),
    graphifying: t("copaw.projects.knowledge.processingStatusProcessing", "正在加工"),
    succeeded: t("copaw.projects.knowledge.processingStatusCompleted", "已完成"),
    failed: t("copaw.projects.knowledge.processingStatusCompleted", "已完成"),
  };

  return statusMap[status] || String(status);
}