type ScopeFilterType = "combined" | "agent" | "project";

export type ScopeFilterProvenanceState = {
  applied: boolean;
  scopeType: ScopeFilterType;
  scopeId: string | null;
};

export function parseScopeFilterProvenance(
  provenance: Record<string, unknown>,
): ScopeFilterProvenanceState {
  const applied = Boolean(provenance.scope_filter_applied);
  const rawScopeType = String(provenance.scope_type || "").trim().toLowerCase();
  const scopeType: ScopeFilterType =
    rawScopeType === "agent" || rawScopeType === "project"
      ? rawScopeType
      : "combined";
  const scopeId = String(provenance.scope_id || "").trim() || null;
  return {
    applied,
    scopeType,
    scopeId,
  };
}
