export const AgentScopeRuntimeRunStatus = {
  Created: "created",
  Running: "running",
  Completed: "completed",
  Failed: "failed",
  Canceled: "canceled",
} as const;

export type AgentScopeRuntimeRunStatus =
  (typeof AgentScopeRuntimeRunStatus)[keyof typeof AgentScopeRuntimeRunStatus];
