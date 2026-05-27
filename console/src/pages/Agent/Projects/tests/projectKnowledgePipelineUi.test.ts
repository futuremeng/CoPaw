import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import {
  getProjectKnowledgePipelineAlertDescription,
  getProjectKnowledgeQuantizationStage,
  getProjectKnowledgeSemanticDescription,
  getProjectKnowledgeSemanticReasonLabel,
  getProjectKnowledgeSemanticSummary,
} from "../utils/projectKnowledgePipelineUi";

const t = ((key: string, fallback?: string) => fallback || key) as TFunction;

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
      "copaw.projects.knowledge.semanticEngineCode: SOURCE_NOT_READY. Semantic engine waiting for project files to be scanned.",
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
});