export interface ProjectTreeRefreshSchedulerState {
  timerId: number | null;
  task: Promise<void> | null;
  resolve: (() => void) | null;
  reject: ((error: unknown) => void) | null;
  pendingClearStale: boolean;
}

export function createProjectTreeRefreshSchedulerState(): ProjectTreeRefreshSchedulerState {
  return {
    timerId: null,
    task: null,
    resolve: null,
    reject: null,
    pendingClearStale: false,
  };
}

export function scheduleProjectTreeRefresh(params: {
  state: ProjectTreeRefreshSchedulerState;
  delay: number;
  scheduleTimer: (callback: () => void, delay: number) => number;
  clearTimer: (timerId: number) => void;
  runRefresh: () => Promise<void>;
  clearStale?: boolean;
  onClearStale?: () => void;
}): Promise<void> {
  const {
    state,
    delay,
    scheduleTimer,
    clearTimer,
    runRefresh,
    clearStale = false,
    onClearStale,
  } = params;

  if (!state.task) {
    state.task = new Promise<void>((resolve, reject) => {
      state.resolve = resolve;
      state.reject = reject;
    });
  }

  state.pendingClearStale = state.pendingClearStale || clearStale;

  if (state.timerId !== null) {
    clearTimer(state.timerId);
  }

  state.timerId = scheduleTimer(() => {
    state.timerId = null;
    void runRefresh()
      .then(() => {
        if (state.pendingClearStale) {
          onClearStale?.();
        }
        state.resolve?.();
      })
      .catch((error) => {
        state.reject?.(error);
      })
      .finally(() => {
        state.task = null;
        state.resolve = null;
        state.reject = null;
        state.pendingClearStale = false;
      });
  }, delay);

  return state.task;
}

export function resetProjectTreeRefreshSchedulerState(params: {
  state: ProjectTreeRefreshSchedulerState;
  clearTimer: (timerId: number) => void;
}): void {
  const { state, clearTimer } = params;
  if (state.timerId !== null) {
    clearTimer(state.timerId);
  }
  state.timerId = null;
  state.task = null;
  state.resolve = null;
  state.reject = null;
  state.pendingClearStale = false;
}
