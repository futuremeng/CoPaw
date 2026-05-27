import type { FlowDefinition } from "../../../api/types/flows";
import { parseErrorDetail } from "../../../utils/error";

export type FlowErrorSummary = {
  errorCode?: string;
  errorSource?: string;
  commandType?: string;
  flowRunId?: string;
  recoveryHint?: string;
  message: string;
};

const normalizeText = (value: string | null | undefined): string => String(value || "").trim();

export function humanizeFlowKey(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "Unknown";
  }
  return normalized
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function isKnowledgeFlowDefinition(definition: FlowDefinition): boolean {
  const id = normalizeText(definition.id).toLowerCase();
  const tags = (definition.tags || []).map((tag) => normalizeText(tag).toLowerCase());
  return tags.includes("knowledge") || (tags.includes("project") && id.includes("knowledge"));
}

export function getFlowDefinitionCompatibilityIssues(definition: FlowDefinition): string[] {
  const issues: string[] = [];
  const definitionId = normalizeText(definition.id);
  const name = normalizeText(definition.name);
  const steps = Array.isArray(definition.steps) ? definition.steps : [];

  if (!definitionId) {
    issues.push("missing definition id");
  }
  if (!name) {
    issues.push("missing definition name");
  }
  if (steps.length === 0) {
    issues.push("no executable steps");
  }

  const knownStepIds = new Set<string>();
  for (const step of steps) {
    const stepId = normalizeText(step?.id);
    const stepName = normalizeText(step?.name);
    const stepKind = normalizeText(step?.kind);

    if (!stepId) {
      issues.push("step missing id");
      continue;
    }
    if (knownStepIds.has(stepId)) {
      issues.push(`duplicate step id:${stepId}`);
    }
    knownStepIds.add(stepId);

    if (!stepName) {
      issues.push(`step ${stepId} missing name`);
    }
    if (!stepKind) {
      issues.push(`step ${stepId} missing kind`);
    }
  }

  for (const step of steps) {
    const stepId = normalizeText(step?.id);
    for (const dependency of step?.depends_on || []) {
      const depId = normalizeText(dependency);
      if (depId && !knownStepIds.has(depId)) {
        issues.push(`step ${stepId || "unknown"} depends on missing step:${depId}`);
      }
    }
  }

  return issues;
}

export function isCompatibleFlowDefinition(definition: FlowDefinition): boolean {
  return getFlowDefinitionCompatibilityIssues(definition).length === 0;
}

export function filterCompatibleFlowDefinitions(definitions: FlowDefinition[]): FlowDefinition[] {
  return definitions.filter(isCompatibleFlowDefinition);
}

export function sortFlowDefinitions(definitions: FlowDefinition[]): FlowDefinition[] {
  return [...definitions].sort((left, right) => {
    const leftKnowledge = isKnowledgeFlowDefinition(left) ? 1 : 0;
    const rightKnowledge = isKnowledgeFlowDefinition(right) ? 1 : 0;
    if (leftKnowledge !== rightKnowledge) {
      return rightKnowledge - leftKnowledge;
    }
    const leftSystem = left.system_owned ? 1 : 0;
    const rightSystem = right.system_owned ? 1 : 0;
    if (leftSystem !== rightSystem) {
      return rightSystem - leftSystem;
    }
    return normalizeText(left.name).localeCompare(normalizeText(right.name));
  });
}

export function getRunStatusColor(status: string): string {
  switch (normalizeText(status).toLowerCase()) {
    case "running":
      return "processing";
    case "queued":
    case "pending":
      return "gold";
    case "succeeded":
    case "ready":
      return "success";
    case "failed":
    case "cancelled":
      return "error";
    case "paused":
      return "purple";
    default:
      return "default";
  }
}

export function getStructuredErrorSummary(error: unknown): FlowErrorSummary {
  const detail = parseErrorDetail(error);
  if (detail && typeof detail === "object") {
    return {
      errorCode: typeof detail.error_code === "string" ? detail.error_code : undefined,
      errorSource: typeof detail.error_source === "string" ? detail.error_source : undefined,
      commandType: typeof detail.command_type === "string" ? detail.command_type : undefined,
      flowRunId: typeof detail.flow_run_id === "string" ? detail.flow_run_id : undefined,
      recoveryHint: typeof detail.recovery_hint === "string" ? detail.recovery_hint : undefined,
      message:
        typeof detail.message === "string" && detail.message.trim()
          ? detail.message
          : error instanceof Error && error.message.trim()
            ? error.message
            : "Request failed",
    };
  }

  return {
    message:
      error instanceof Error && error.message.trim()
        ? error.message
        : "Request failed",
  };
}