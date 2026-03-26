import { describe, expect, it } from "vitest";
import {
  buildIncrementalStepGenerationPrompt,
  buildIncrementalStepEditPrompt,
  buildJsonRepairPrompt,
  parseStepFromAIResponse,
  parseStepOperationFromAIResponse,
} from "./pipelineStepGeneration";

describe("pipelineStepGeneration", () => {
  it("includes output in valid kind prompt options", () => {
    const prompt = buildIncrementalStepGenerationPrompt(
      "essay-pipeline",
      "Essay Pipeline",
      {
        totalStepsExpected: 4,
        stepsGenerated: 2,
        currentStep: 3,
        isComplete: false,
      },
      [
        { id: "essay-input", name: "接收作文输入", kind: "input", description: "..." },
      ],
      "创建一个包含 4 个步骤的作文批改流程",
    );

    expect(prompt).toContain("output");
    expect(prompt).toContain("Task: generate step 3 of 4");
    expect(prompt).toContain("essay-input");
  });

  it("parses valid json step response", () => {
    const parsed = parseStepFromAIResponse([
      "```json",
      "{",
      '  "id": "essay-review",',
      '  "name": "批改意见生成",',
      '  "kind": "review",',
      '  "description": "生成结构化反馈"',
      "}",
      "```",
    ].join("\n"));

    expect(parsed.success).toBe(true);
    expect(parsed.step).toEqual({
      id: "essay-review",
      name: "批改意见生成",
      kind: "review",
      description: "生成结构化反馈",
    });
  });

  it("accepts output as a valid step kind", () => {
    const parsed = parseStepFromAIResponse(
      JSON.stringify({
        id: "essay-scoring",
        name: "评分与评语",
        kind: "output",
        description: "输出最终评分",
      }),
    );

    expect(parsed.success).toBe(true);
    expect(parsed.step?.kind).toBe("output");
  });

  it("rejects invalid kind with explicit message", () => {
    const parsed = parseStepFromAIResponse(
      JSON.stringify({
        id: "essay-step",
        name: "Bad Kind",
        kind: "ingest",
        description: "invalid",
      }),
    );

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Invalid step kind");
  });

  it("handles completion payload", () => {
    const parsed = parseStepFromAIResponse(
      JSON.stringify({
        complete: true,
        message: "All steps generated successfully",
      }),
    );

    expect(parsed.success).toBe(true);
    expect(parsed.complete).toBe(true);
    expect(parsed.message).toBe("All steps generated successfully");
  });

  it("builds edit prompt with current steps and request", () => {
    const prompt = buildIncrementalStepEditPrompt(
      "essay-pipeline",
      "Essay Pipeline",
      [{ id: "essay-input", name: "接收作文输入", kind: "input", description: "输入作文" }],
      "把评分步骤补进去，并优化批改意见描述",
      1,
    );

    expect(prompt).toContain("Edit one pipeline step");
    expect(prompt).toContain("essay-input");
    expect(prompt).toContain("Operations already applied: 1");
    expect(prompt).toContain("needs_user_input");
  });

  it("compacts edit prompt when many steps exist", () => {
    const prompt = buildIncrementalStepEditPrompt(
      "essay-pipeline",
      "Essay Pipeline",
      Array.from({ length: 16 }, (_, index) => ({
        id: `step-${index + 1}`,
        name: `步骤 ${index + 1}`,
        kind: "analysis",
        description: `描述 ${index + 1}`,
      })),
      "把最后一步拆成两个更清晰的节点，并压缩说明文字。".repeat(100),
      2,
    );

    expect(prompt).toContain("earlier steps omitted");
    expect(prompt).toContain("step-16");
    expect(prompt).not.toContain("step-1] 步骤 1");
  });

  it("builds compact json repair prompt", () => {
    const prompt = buildJsonRepairPrompt("modify", "Here is your answer: ```json {} ```", "Failed to parse JSON");

    expect(prompt).toContain("not valid JSON");
    expect(prompt).toContain("Rewrite your last answer as one raw JSON object only");
    expect(prompt).toContain("Allowed output");
  });

  it("parses step edit add operation", () => {
    const parsed = parseStepOperationFromAIResponse(
      JSON.stringify({
        operation: "add",
        step: {
          id: "essay-scoring",
          name: "评分与评语",
          kind: "output",
          description: "输出最终评分",
        },
      }),
    );

    expect(parsed.success).toBe(true);
    expect(parsed.operation).toBe("add");
    expect(parsed.step?.id).toBe("essay-scoring");
  });

  it("parses step edit completion and input-needed states", () => {
    const done = parseStepOperationFromAIResponse(
      JSON.stringify({ complete: true, message: "done" }),
    );
    const needInput = parseStepOperationFromAIResponse(
      JSON.stringify({ needs_user_input: true, message: "missing scoring rule" }),
    );

    expect(done.success).toBe(true);
    expect(done.complete).toBe(true);
    expect(needInput.success).toBe(true);
    expect(needInput.needsUserInput).toBe(true);
    expect(needInput.message).toContain("missing scoring rule");
  });

  it("parses delete operation with step_id", () => {
    const parsed = parseStepOperationFromAIResponse(
      JSON.stringify({
        operation: "delete",
        step_id: "essay-review",
      }),
    );

    expect(parsed.success).toBe(true);
    expect(parsed.operation).toBe("delete");
    expect(parsed.stepId).toBe("essay-review");
  });
});