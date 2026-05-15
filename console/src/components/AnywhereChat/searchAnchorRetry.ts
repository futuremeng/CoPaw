export interface SearchAnchorRetryDecision {
  done: boolean;
  attempts: number;
  maxAttempts: number;
}

export function shouldStopSearchAnchorRetry(decision: SearchAnchorRetryDecision): boolean {
  if (decision.done) {
    return true;
  }
  return decision.attempts >= decision.maxAttempts;
}
