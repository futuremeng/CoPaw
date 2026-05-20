import { useEffect } from "react";

interface UseLeaveConfirmGuardParams {
  enabled: boolean;
  confirmText: string;
}

export default function useLeaveConfirmGuard({
  enabled,
  confirmText,
}: UseLeaveConfirmGuardParams) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const rawPushState = window.history.pushState.bind(window.history);
    const rawReplaceState = window.history.replaceState.bind(window.history);
    const rawGo = window.history.go.bind(window.history);
    const rawBack = window.history.back.bind(window.history);
    const rawForward = window.history.forward.bind(window.history);

    const shouldConfirmLeave = (nextUrl?: string | URL | null): boolean => {
      if (!nextUrl) {
        return false;
      }
      const current = new URL(window.location.href);
      const target = new URL(String(nextUrl), window.location.origin);
      return target.pathname !== current.pathname;
    };

    const confirmLeave = (): boolean => window.confirm(confirmText);

    const patchedPushState: History["pushState"] = function patched(
      data,
      unused,
      url,
    ) {
      if (shouldConfirmLeave(url) && !confirmLeave()) {
        return;
      }
      rawPushState(data, unused, url);
    };

    const patchedReplaceState: History["replaceState"] = function patched(
      data,
      unused,
      url,
    ) {
      if (shouldConfirmLeave(url) && !confirmLeave()) {
        return;
      }
      rawReplaceState(data, unused, url);
    };

    const patchedGo: History["go"] = function patched(delta) {
      if ((delta || 0) !== 0 && !confirmLeave()) {
        return;
      }
      rawGo(delta);
    };

    const patchedBack: History["back"] = function patched() {
      if (!confirmLeave()) {
        return;
      }
      rawBack();
    };

    const patchedForward: History["forward"] = function patched() {
      if (!confirmLeave()) {
        return;
      }
      rawForward();
    };

    window.history.pushState = patchedPushState;
    window.history.replaceState = patchedReplaceState;
    window.history.go = patchedGo;
    window.history.back = patchedBack;
    window.history.forward = patchedForward;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = confirmText;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.history.pushState = rawPushState;
      window.history.replaceState = rawReplaceState;
      window.history.go = rawGo;
      window.history.back = rawBack;
      window.history.forward = rawForward;
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [confirmText, enabled]);
}