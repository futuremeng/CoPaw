import { getApiUrl, clearAuthToken } from "./config";
import { buildAuthHeaders } from "./authHeaders";

const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const NAVIGATION_CHANGE_EVENT = "qwenpaw:navigation-change";
const routeAbortControllers = new Set<AbortController>();
let navigationPatchInstalled = false;

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  abortOnNavigation?: boolean;
}

function installNavigationEventBridge() {
  if (navigationPatchInstalled || typeof window === "undefined") {
    return;
  }

  const historyRef = window.history as History & {
    __qwenpawPatched?: boolean;
  };
  if (historyRef.__qwenpawPatched) {
    navigationPatchInstalled = true;
    return;
  }

  const emitNavigationChange = () => {
    window.dispatchEvent(new Event(NAVIGATION_CHANGE_EVENT));
  };

  const originalPushState = window.history.pushState.bind(window.history);
  window.history.pushState = ((...args) => {
    originalPushState(...args);
    emitNavigationChange();
  }) as History["pushState"];

  const originalReplaceState = window.history.replaceState.bind(window.history);
  window.history.replaceState = ((...args) => {
    originalReplaceState(...args);
    emitNavigationChange();
  }) as History["replaceState"];

  window.addEventListener("popstate", emitNavigationChange);
  historyRef.__qwenpawPatched = true;
  navigationPatchInstalled = true;
}

function getErrorMessageFromBody(
  text: string,
  contentType: string,
): string | null {
  if (!text) {
    return null;
  }

  if (!contentType.includes("application/json")) {
    return text;
  }

  try {
    const payload = JSON.parse(text) as {
      detail?: unknown;
      message?: unknown;
      error?: unknown;
    };

    if (typeof payload.detail === "string" && payload.detail) {
      return payload.detail;
    }
    if (typeof payload.message === "string" && payload.message) {
      return payload.message;
    }
    if (typeof payload.error === "string" && payload.error) {
      return payload.error;
    }
  } catch {
    return text;
  }

  return text;
}

function buildHeaders(method?: string, extra?: HeadersInit): Headers {
  // Normalize extra to a Headers instance for consistent handling
  const headers = extra instanceof Headers ? extra : new Headers(extra);

  // Only add Content-Type for methods that typically have a body
  if (method && ["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
    // Don't override if caller explicitly set Content-Type
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }

  for (const [key, value] of Object.entries(buildAuthHeaders())) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  return headers;
}

export async function request<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = getApiUrl(path);
  const method = options.method || "GET";
  const headers = buildHeaders(method, options.headers);

  const {
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    abortOnNavigation = true,
    signal,
    ...rest
  } = options;
  const timeoutController = new AbortController();
  const navigationController = abortOnNavigation ? new AbortController() : null;
  const timeoutHandle = window.setTimeout(() => {
    timeoutController.abort();
  }, timeoutMs);

  const onNavigationChange = () => {
    navigationController?.abort();
  };
  if (navigationController) {
    installNavigationEventBridge();
    routeAbortControllers.add(navigationController);
    window.addEventListener(NAVIGATION_CHANGE_EVENT, onNavigationChange);
  }

  let cleanupComposedSignal: (() => void) | undefined;
  const composedSignal = (() => {
    const parts = [timeoutController.signal];
    if (navigationController) {
      parts.push(navigationController.signal);
    }
    if (signal) {
      parts.push(signal);
    }

    if (parts.length === 1) {
      return parts[0];
    }
    if (parts.some((item) => item.aborted)) {
      return parts.find((item) => item.aborted) || parts[0];
    }

    const composedController = new AbortController();
    const abortComposed = () => composedController.abort();

    parts.forEach((item) => item.addEventListener("abort", abortComposed));

    cleanupComposedSignal = () => {
      parts.forEach((item) =>
        item.removeEventListener("abort", abortComposed),
      );
    };

    return composedController.signal;
  })();

  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      headers,
      signal: composedSignal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      const abortedByCaller = Boolean(signal?.aborted);
      const abortedByNavigation = Boolean(navigationController?.signal.aborted);
      if (abortedByCaller || abortedByNavigation) {
        throw new Error("Request aborted");
      }
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (navigationController) {
      routeAbortControllers.delete(navigationController);
      window.removeEventListener(NAVIGATION_CHANGE_EVENT, onNavigationChange);
    }
    cleanupComposedSignal?.();
    window.clearTimeout(timeoutHandle);
  }

  if (!response.ok) {
    if (response.status === 401) {
      clearAuthToken();
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
      throw new Error("Not authenticated");
    }

    const text = await response.text().catch(() => "");
    const contentType = response.headers.get("content-type") || "";
    const errorMessage = getErrorMessageFromBody(text, contentType);

    // Preserve raw body for parseErrorDetail() to extract structured fields
    const finalMessage = errorMessage
      ? `${errorMessage} - ${text}`
      : `Request failed: ${response.status} ${response.statusText}`;

    throw new Error(finalMessage);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return (await response.text()) as unknown as T;
  }

  return (await response.json()) as T;
}
