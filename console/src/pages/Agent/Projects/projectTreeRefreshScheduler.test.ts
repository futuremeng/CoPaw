import { describe, expect, it, vi } from "vitest";
import {
  createProjectTreeRefreshSchedulerState,
  resetProjectTreeRefreshSchedulerState,
  scheduleProjectTreeRefresh,
} from "./projectTreeRefreshScheduler";

describe("projectTreeRefreshScheduler", () => {
  it("coalesces close refresh requests into one execution", async () => {
    const state = createProjectTreeRefreshSchedulerState();
    const callbacks: Array<() => void> = [];
    const scheduleTimer = vi.fn((callback: () => void) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const clearTimer = vi.fn();
    const runRefresh = vi.fn().mockResolvedValue(undefined);

    const first = scheduleProjectTreeRefresh({
      state,
      delay: 100,
      scheduleTimer,
      clearTimer,
      runRefresh,
    });
    const second = scheduleProjectTreeRefresh({
      state,
      delay: 100,
      scheduleTimer,
      clearTimer,
      runRefresh,
    });

    expect(first).toBe(second);
    expect(scheduleTimer).toHaveBeenCalledTimes(2);
    expect(clearTimer).toHaveBeenCalledTimes(1);

    callbacks[1]();
    await first;

    expect(runRefresh).toHaveBeenCalledTimes(1);
  });

  it("runs clear-stale callback once when any coalesced request asks for it", async () => {
    const state = createProjectTreeRefreshSchedulerState();
    const callbacks: Array<() => void> = [];
    const scheduleTimer = vi.fn((callback: () => void) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const clearTimer = vi.fn();
    const runRefresh = vi.fn().mockResolvedValue(undefined);
    const onClearStale = vi.fn();

    const first = scheduleProjectTreeRefresh({
      state,
      delay: 100,
      scheduleTimer,
      clearTimer,
      runRefresh,
      clearStale: false,
      onClearStale,
    });
    scheduleProjectTreeRefresh({
      state,
      delay: 100,
      scheduleTimer,
      clearTimer,
      runRefresh,
      clearStale: true,
      onClearStale,
    });

    callbacks[1]();
    await first;

    expect(onClearStale).toHaveBeenCalledTimes(1);
  });

  it("propagates refresh failures to callers", async () => {
    const state = createProjectTreeRefreshSchedulerState();
    const callbacks: Array<() => void> = [];
    const scheduleTimer = vi.fn((callback: () => void) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const clearTimer = vi.fn();
    const runRefresh = vi.fn().mockRejectedValue(new Error("boom"));

    const task = scheduleProjectTreeRefresh({
      state,
      delay: 100,
      scheduleTimer,
      clearTimer,
      runRefresh,
    });

    callbacks[0]();

    await expect(task).rejects.toThrow("boom");
  });

  it("resets pending scheduler state", () => {
    const state = createProjectTreeRefreshSchedulerState();
    const clearTimer = vi.fn();

    state.timerId = 42;
    state.task = Promise.resolve();
    state.resolve = vi.fn();
    state.reject = vi.fn();
    state.pendingClearStale = true;

    resetProjectTreeRefreshSchedulerState({ state, clearTimer });

    expect(clearTimer).toHaveBeenCalledWith(42);
    expect(state.timerId).toBeNull();
    expect(state.task).toBeNull();
    expect(state.resolve).toBeNull();
    expect(state.reject).toBeNull();
    expect(state.pendingClearStale).toBe(false);
  });
});
