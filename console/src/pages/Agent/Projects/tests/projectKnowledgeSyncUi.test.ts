import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import {
  getProjectKnowledgeQuantizationStage,
  getProjectKnowledgeSemanticDescription,
  getProjectKnowledgeSemanticReasonLabel,
  getProjectKnowledgeSemanticSummary,
} from "../utils/projectKnowledgeSyncUi";

const t = ((key: string, fallback?: string) => fallback || key) as TFunction;

describe("projectKnowledgeSyncUi semantic helpers", () => {
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
});