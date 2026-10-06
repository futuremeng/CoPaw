import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import i18n from "../../../../i18n";
import {
  getProcessingStatusLabel,
  getProjectKnowledgePipelineAlertDescription,
  getProjectKnowledgePipelineStageLabel,
  getProjectKnowledgeQuantizationStage,
  getProjectKnowledgeSemanticDescription,
  getProjectKnowledgeSemanticReasonLabel,
  getProjectKnowledgeSemanticSummary,
  getTriggerModeLabel,
} from "../utils/projectKnowledgePipelineUi";
import { t as translateEn } from "./enLocaleTranslate";

// Asserts against the English bundle the app renders, not an inline default.
const t = translateEn as unknown as TFunction;

const REASON_CODES = [
  "SOURCE_NOT_READY",
  "HANLP_SIDECAR_UNCONFIGURED",
  "HANLP_SIDECAR_PYTHON_MISSING",
  "HANLP_SIDECAR_PYTHON_INCOMPATIBLE",
  "HANLP_SIDECAR_EXEC_FAILED",
  "HANLP_IMPORT_UNAVAILABLE",
  "HANLP_ENTRYPOINT_MISSING",
  "HANLP_TOKENIZE_FAILED",
  "SEMANTIC_STATE_INVALID",
  "SEMANTIC_STATE_UNKNOWN",
] as const;

const SECONDARY_LANGUAGES = ["zh", "ja", "ru", "pt-BR", "id"] as const;

// Rendered through the product's own i18n instance, so the six-language deliverable
// is proven by the registration order production uses.
function translateIn(lng: string): TFunction {
  const translate = (key: string, optionsOrDefault?: unknown) =>
    typeof optionsOrDefault === "string"
      ? i18n.t(key, { lng, defaultValue: optionsOrDefault })
      : i18n.t(key, { lng, ...(optionsOrDefault as Record<string, unknown>) });
  return translate as unknown as TFunction;
}

function semanticEngineFixture(reasonCode: string) {
  return {
    engine: "hanlp",
    status: "unavailable" as const,
    reason_code: reasonCode,
    reason: "Backend supplied reason.",
    summary: "Backend supplied summary.",
    updated_at: "2026-10-06T00:00:00Z",
  };
}

// Verbatim from src/qwenpaw/knowledge/project_pipeline_projection.py:923-925.
const PIPELINE_STAGES = [
  { mode: "fast", label_key: "copaw.projects.knowledge.pipelineStage.fast", label: "L1 · Fast" },
  { mode: "nlp", label_key: "copaw.projects.knowledge.pipelineStage.nlp", label: "L2 · NLP" },
  {
    mode: "agentic",
    label_key: "copaw.projects.knowledge.pipelineStage.agentic",
    label: "L3 · Agentic",
  },
] as const;

describe("projectKnowledgePipelineUi semantic helpers", () => {
  it("maps processing modes to quantization stages", () => {
    expect(getProjectKnowledgeQuantizationStage("fast")).toBe("l1");
    expect(getProjectKnowledgeQuantizationStage("nlp")).toBe("l2");
    expect(getProjectKnowledgeQuantizationStage("agentic")).toBe("l3");
  });

  it("maps sidecar unconfigured to localized summary", () => {
    expect(getProjectKnowledgeSemanticSummary({
      engine: "hanlp",
      status: "unavailable",
      reason_code: "HANLP_SIDECAR_UNCONFIGURED",
      reason: "HanLP sidecar is not configured.",
    }, t)).toBe("Semantic engine unavailable: HanLP sidecar is not configured.");
  });

  it("maps import unavailable to localized summary", () => {
    expect(getProjectKnowledgeSemanticSummary({
      engine: "hanlp",
      status: "unavailable",
      reason_code: "HANLP_IMPORT_UNAVAILABLE",
      reason: "HanLP module is not installed or failed to import.",
    }, t)).toBe("Semantic engine unavailable: HanLP module is not installed.");
  });

  it("maps tokenize failure to localized reason label", () => {
    expect(getProjectKnowledgeSemanticReasonLabel({
      engine: "hanlp",
      status: "error",
      reason_code: "HANLP_TOKENIZE_FAILED",
      reason: "HanLP semantic tokenization failed via tok: RuntimeError.",
    }, t)).toBe("Tokenization Failed");
  });

  it("maps sidecar python missing to localized reason label", () => {
    expect(getProjectKnowledgeSemanticReasonLabel({
      engine: "hanlp",
      status: "unavailable",
      reason_code: "HANLP_SIDECAR_PYTHON_MISSING",
      reason: "HanLP sidecar Python executable was not found.",
    }, t)).toBe("Sidecar Python Missing");
  });

  it("builds semantic description from code and localized summary", () => {
    expect(getProjectKnowledgeSemanticDescription({
      engine: "hanlp",
      status: "idle",
      reason_code: "SOURCE_NOT_READY",
      reason: "Project source has not been prepared for semantic extraction yet.",
    }, t)).toBe(
      "Code: SOURCE_NOT_READY. Semantic engine waiting for project files to be scanned.",
    );
  });

  it("falls back to backend summary when reason code has no dedicated mapping", () => {
    expect(getProjectKnowledgeSemanticSummary({
      engine: "hanlp",
      status: "error",
      reason_code: "CUSTOM_REASON",
      reason: "Backend fallback reason.",
      summary: "Backend fallback summary.",
    }, t)).toBe("Backend fallback summary.");
  });

  it("renders workflow-step recovery hint in alert description", () => {
    const text = getProjectKnowledgePipelineAlertDescription({
      project_id: "p1",
      status: "failed",
      current_stage: "failed",
      progress: 0,
      auto_enabled: true,
      dirty: false,
      dirty_after_run: false,
      last_trigger: "manual",
      changed_paths: [],
      pending_changed_paths: [],
      changed_count: 0,
      last_error: "",
      latest_job_id: "",
      latest_source_id: "project-p1-workspace",
      last_result: {},
      recent_error_code: "TOKENIZE_ENGINE_FAILED",
      recent_error_source: "workflow_step",
    }, t);
    expect(text).toContain("Step-level failure");
  });

  it("renders execution-loop recovery hint in alert description", () => {
    const text = getProjectKnowledgePipelineAlertDescription({
      project_id: "p1",
      status: "failed",
      current_stage: "failed",
      progress: 0,
      auto_enabled: true,
      dirty: false,
      dirty_after_run: false,
      last_trigger: "manual",
      changed_paths: [],
      pending_changed_paths: [],
      changed_count: 0,
      last_error: "",
      latest_job_id: "",
      latest_source_id: "project-p1-workspace",
      last_result: {},
      recent_error_code: "RUNTIME_ERROR_FAILED",
      recent_error_source: "execution_loop",
    }, t);
    expect(text).toContain("Execution-loop failure");
  });

  it("localizes every semantic reason code the pipeline UI renders", () => {
    for (const reasonCode of REASON_CODES) {
      const englishLabel = getProjectKnowledgeSemanticReasonLabel(
        semanticEngineFixture(reasonCode),
        translateIn("en"),
      );
      const englishSummary = getProjectKnowledgeSemanticSummary(
        semanticEngineFixture(reasonCode),
        translateIn("en"),
      );
      // A missing leaf shows up here as either the key path or the backend payload.
      expect(englishLabel).not.toContain("semanticReasonCode.");
      expect(englishLabel).not.toBe(reasonCode);
      expect(englishSummary).not.toContain("semanticReasonSummary.");
      expect(englishSummary).not.toBe("Backend supplied summary.");
      expect(englishSummary).not.toBe(reasonCode);

      for (const lng of SECONDARY_LANGUAGES) {
        expect(
          getProjectKnowledgeSemanticReasonLabel(semanticEngineFixture(reasonCode), translateIn(lng)),
        ).not.toBe(englishLabel);
        expect(
          getProjectKnowledgeSemanticSummary(semanticEngineFixture(reasonCode), translateIn(lng)),
        ).not.toBe(englishSummary);
      }
    }
  });

  it("labels an unmapped reason code with the ready text in every language", () => {
    const readyLabels = new Map<string, string>();
    for (const lng of ["en", ...SECONDARY_LANGUAGES]) {
      const unmapped = getProjectKnowledgeSemanticReasonLabel(
        semanticEngineFixture("CUSTOM_REASON"),
        translateIn(lng),
      );
      expect(unmapped).not.toContain("semanticReasonCode.");
      // Today's contract: a code with no dedicated copy behaves like the ready state.
      expect(unmapped).toBe(
        getProjectKnowledgeSemanticReasonLabel(semanticEngineFixture(""), translateIn(lng)),
      );
      readyLabels.set(lng, unmapped);
    }
    expect(readyLabels.get("zh")).not.toBe(readyLabels.get("en"));
    expect(readyLabels.get("ja")).not.toBe(readyLabels.get("en"));
  });

  it("localizes the pipeline stage labels the backend sends by key", () => {
    for (const stage of PIPELINE_STAGES) {
      const payload = { key: stage.mode, label_key: stage.label_key, label: stage.label };
      // English must keep rendering exactly the text the backend used to supply.
      expect(getProjectKnowledgePipelineStageLabel(payload, translateIn("en"))).toBe(stage.label);
      for (const lng of SECONDARY_LANGUAGES) {
        const rendered = getProjectKnowledgePipelineStageLabel(payload, translateIn(lng));
        expect(rendered).not.toContain("pipelineStage.");
        expect(rendered).not.toBe(stage.label);
      }
    }
  });

  it("renders the unknown trigger and processing labels from the bundle", () => {
    for (const lng of ["en", ...SECONDARY_LANGUAGES]) {
      expect(getTriggerModeLabel(translateIn(lng))).not.toContain("未知");
      expect(getProcessingStatusLabel(translateIn(lng))).not.toContain("未知");
    }
    expect(getTriggerModeLabel(translateIn("zh"))).not.toBe(getTriggerModeLabel(translateIn("en")));
    expect(getProcessingStatusLabel(translateIn("zh"))).not.toBe(
      getProcessingStatusLabel(translateIn("en")),
    );
  });
});