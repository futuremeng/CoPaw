export interface ApprovalVisibilityItem {
  requestId: string;
  createdAt: number;
}

export interface ApprovalVisibilityResult<T extends ApprovalVisibilityItem> {
  sorted: T[];
  visible: T[];
  hiddenCount: number;
}

export function resolveApprovalVisibility<T extends ApprovalVisibilityItem>(
  approvals: T[],
  limit: number,
  showAll: boolean,
): ApprovalVisibilityResult<T> {
  const sorted = [...approvals].sort((left, right) => right.createdAt - left.createdAt);
  const safeLimit = Math.max(0, limit);
  const visible = showAll ? sorted : sorted.slice(0, safeLimit);
  const hiddenCount = Math.max(0, sorted.length - visible.length);

  return {
    sorted,
    visible,
    hiddenCount,
  };
}
