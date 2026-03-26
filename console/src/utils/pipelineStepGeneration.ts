/**
 * Pipeline step generation utilities
 * Handle incremental step generation from AI responses
 */

import type { ProjectPipelineTemplateStep } from "../api/types/agents";

export interface StepGenerationContext {
  totalStepsExpected: number;  // 期望生成的总步骤数
  stepsGenerated: number;      // 已生成的步骤数
  currentStep: number;         // 当前正在生成的步骤序号（1-based）
  isComplete: boolean;         // 是否完成
}

const VALID_STEP_KINDS = [
  "input",
  "analysis",
  "transform",
  "review",
  "validation",
  "publish",
  "task",
  "output",
];

export interface ParsedStepResponse {
  success: boolean;
  step?: ProjectPipelineTemplateStep;
  complete?: boolean;
  message?: string;
  error?: string;
}

export interface ParsedStepOperationResponse {
  success: boolean;
  operation?: "add" | "update" | "delete";
  step?: ProjectPipelineTemplateStep;
  stepId?: string;
  complete?: boolean;
  needsUserInput?: boolean;
  message?: string;
  error?: string;
}

export interface PipelinePromptBudgetOptions {
  maxPromptSteps?: number;
  maxUserRequirementChars?: number;
}

const MAX_PROMPT_STEPS = 12;
const MAX_USER_REQUIREMENTS_CHARS = 1600;

function trimForPrompt(text: string, maxChars = MAX_USER_REQUIREMENTS_CHARS): string {
  const normalized = text.trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}...`;
}

function formatStepsForPrompt(
  existingSteps: ProjectPipelineTemplateStep[],
  options?: { includeDescription?: boolean; maxSteps?: number },
): string {
  const includeDescription = options?.includeDescription ?? false;
  const maxSteps = options?.maxSteps ?? MAX_PROMPT_STEPS;
  if (existingSteps.length === 0) return "None yet";

  const visibleSteps = existingSteps.slice(-maxSteps);
  const omittedCount = Math.max(0, existingSteps.length - visibleSteps.length);
  const lines: string[] = [];
  if (omittedCount > 0) {
    lines.push(`... ${omittedCount} earlier steps omitted to save context`);
  }

  lines.push(
    ...visibleSteps.map((step, index) => {
      const prefix = `${omittedCount + index + 1}. [${step.id}] ${step.name} (${step.kind})`;
      if (!includeDescription) return prefix;
      return `${prefix} - ${step.description || ""}`;
    }),
  );

  return lines.join("\n");
}

function extractJsonPayload(aiResponse: string): string {
  const jsonMatch = aiResponse.match(/```json\n([\s\S]*?)\n```/);
  return jsonMatch ? jsonMatch[1] : aiResponse.trim();
}

function parseValidatedStep(payload: Record<string, unknown>): ParsedStepResponse {
  if (!payload.id || !payload.name || !payload.kind) {
    return {
      success: false,
      error: `Missing required fields. Got: ${Object.keys(payload).join(", ")}`,
    };
  }

  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(String(payload.id).toLowerCase())) {
    return {
      success: false,
      error: `Invalid step id format: "${payload.id}". Must match ^[a-z][a-z0-9_-]{0,63}$`,
    };
  }

  const normalizedKind = String(payload.kind || "").toLowerCase();
  if (!VALID_STEP_KINDS.includes(normalizedKind)) {
    return {
      success: false,
      error: `Invalid step kind: "${payload.kind}". Must be one of: ${VALID_STEP_KINDS.join(", ")}`,
    };
  }

  const step: ProjectPipelineTemplateStep = {
    id: String(payload.id).toLowerCase(),
    name: String(payload.name).trim(),
    kind: normalizedKind,
    description: String(payload.description || "").trim(),
  };

  return {
    success: true,
    step,
  };
}

/**
 * Build the system prompt for incremental step generation
 * 为逐步生成步骤构建系统提示词
 */
export function buildIncrementalStepGenerationPrompt(
  pipelineId: string,
  pipelineName: string,
  context: StepGenerationContext,
  existingSteps: ProjectPipelineTemplateStep[],
  userRequirements: string,  // 用户的原始需求
  budget?: PipelinePromptBudgetOptions,
): string {
  const stepNumber = context.currentStep;
  const totalSteps = context.totalStepsExpected;
  const trimmedRequirements = trimForPrompt(
    userRequirements,
    budget?.maxUserRequirementChars ?? MAX_USER_REQUIREMENTS_CHARS,
  );

  return [
    "Design one pipeline step.",
    `Pipeline: ${pipelineName} (${pipelineId})`,
    `Progress: ${context.stepsGenerated}/${totalSteps}`,
    `Task: generate step ${stepNumber} of ${totalSteps}`,
    "",
    "User requirements:",
    trimmedRequirements || "None",
    "",
    "Existing steps:",
    formatStepsForPrompt(existingSteps, {
      includeDescription: false,
      maxSteps: budget?.maxPromptSteps ?? MAX_PROMPT_STEPS,
    }),
    "",
    "Return raw JSON only. No markdown. No explanation.",
    `Allowed kinds: ${VALID_STEP_KINDS.join(", ")}`,
    "JSON schema:",
    '{"id":"step-id","name":"Step Name","kind":"analysis","description":"What this step does"}',
    "If all steps are complete, return:",
    '{"complete":true,"message":"All steps generated successfully"}',
  ].join("\n");
}

export function buildIncrementalStepEditPrompt(
  pipelineId: string,
  pipelineName: string,
  existingSteps: ProjectPipelineTemplateStep[],
  userRequest: string,
  operationsApplied = 0,
  budget?: PipelinePromptBudgetOptions,
): string {
  const trimmedRequest = trimForPrompt(
    userRequest,
    budget?.maxUserRequirementChars ?? MAX_USER_REQUIREMENTS_CHARS,
  );
  return [
    "Edit one pipeline step.",
    `Pipeline: ${pipelineName} (${pipelineId})`,
    `Operations already applied: ${operationsApplied}`,
    "User request:",
    trimmedRequest || "None",
    "",
    "Current steps:",
    formatStepsForPrompt(existingSteps, {
      includeDescription: true,
      maxSteps: budget?.maxPromptSteps ?? MAX_PROMPT_STEPS,
    }),
    "",
    "Apply only the next smallest useful change.",
    "Return raw JSON only. No markdown. No explanation.",
    "Add/update format:",
    '{"operation":"add"|"update","step":{"id":"step-id","name":"Step Name","kind":"input|analysis|transform|review|validation|publish|task|output","description":"What this step does"}}',
    "Delete format:",
    '{"operation":"delete","step_id":"existing-step-id"}',
    "Done format:",
    '{"complete":true,"message":"All requested edits are applied"}',
    "Need input format:",
    '{"needs_user_input":true,"message":"What is missing"}',
  ].join("\n");
}

export function buildJsonRepairPrompt(
  mode: "create" | "modify",
  invalidResponse: string,
  parseError?: string,
): string {
  const trimmedResponse = trimForPrompt(invalidResponse, 600);
  return [
    mode === "create" ? "Your last reply was not valid JSON for one step." : "Your last reply was not valid JSON for one pipeline edit.",
    parseError ? `Parse error: ${parseError}` : "Parse error: invalid JSON payload",
    "Rewrite your last answer as one raw JSON object only.",
    "No markdown fences. No explanation. No extra text.",
    mode === "create"
      ? 'Allowed output: {"id":"step-id","name":"Step Name","kind":"analysis","description":"What this step does"} or {"complete":true,"message":"All steps generated successfully"}'
      : 'Allowed output: {"operation":"add"|"update","step":{...}} or {"operation":"delete","step_id":"existing-step-id"} or {"complete":true,"message":"All requested edits are applied"} or {"needs_user_input":true,"message":"What is missing"}',
    "Invalid reply to repair:",
    trimmedResponse || "<empty>",
  ].join("\n");
}

/**
 * Parse AI response to extract step JSON
 * 从 AI 响应中解析步骤 JSON
 */
export function parseStepFromAIResponse(aiResponse: string): ParsedStepResponse {
  const jsonStr = extractJsonPayload(aiResponse);

  try {
    const parsed = JSON.parse(jsonStr);

    if (parsed.complete === true) {
      return {
        success: true,
        complete: true,
        message: parsed.message || "Generation complete",
      };
    }

    return parseValidatedStep(parsed as Record<string, unknown>);
  } catch (e) {
    return {
      success: false,
      error: `Failed to parse JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export function parseStepOperationFromAIResponse(aiResponse: string): ParsedStepOperationResponse {
  const jsonStr = extractJsonPayload(aiResponse);

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    if (parsed.complete === true) {
      return {
        success: true,
        complete: true,
        message: String(parsed.message || "All requested edits are applied"),
      };
    }

    if (parsed.needs_user_input === true) {
      return {
        success: true,
        needsUserInput: true,
        message: String(parsed.message || "Need more user input"),
      };
    }

    const operation = parsed.operation;
    if (operation === "delete") {
      const stepId = String(parsed.step_id || "").trim().toLowerCase();
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(stepId)) {
        return {
          success: false,
          error: `Invalid delete step_id: "${String(parsed.step_id || "")}". Must match ^[a-z][a-z0-9_-]{0,63}$`,
        };
      }

      return {
        success: true,
        operation,
        stepId,
      };
    }

    if (operation !== "add" && operation !== "update") {
      return {
        success: false,
        error: `Invalid operation: "${String(operation || "")}". Must be add, update, or delete`,
      };
    }

    if (!parsed.step || typeof parsed.step !== "object") {
      return {
        success: false,
        error: "Missing step payload for add/update operation",
      };
    }

    const stepResult = parseValidatedStep(parsed.step as Record<string, unknown>);
    if (!stepResult.success || !stepResult.step) {
      return {
        success: false,
        error: stepResult.error || "Invalid step payload",
      };
    }

    return {
      success: true,
      operation,
      step: stepResult.step,
    };
  } catch (e) {
    return {
      success: false,
      error: `Failed to parse JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Generate the next AI prompt for the current step
 * 为当前步骤生成下一个 AI 提示
 */
export function generateNextStepPrompt(
  context: StepGenerationContext,
): string {
  if (context.isComplete) {
    return "流程生成已完成！"; // Pipeline generation complete!
  }

  return `现在请生成第 ${context.currentStep} 个步骤。请只返回该步骤的 JSON 定义，不要包含其他文字。`;
}
