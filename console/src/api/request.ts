import { getApiUrl, clearAuthToken } from "./config";
import { buildAuthHeaders } from "./authHeaders";
import { getLoginHref, isLoginPath } from "../utils/navigationMode";

const NAVIGATION_CHANGE_EVENT = "qwenpaw:navigation-change";
let navigationPatchInstalled = false;

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

export interface RequestOptions extends RequestInit {
  /** Request timeout in milliseconds. Defaults to 30000 (30 seconds). */
  timeout?: number;
  /** Deprecated alias of `timeout`, kept for fork callers. */
  timeoutMs?: number;
  /** Number of retry attempts on timeout. Defaults to 0 (no retry). */
  retries?: number;
  /** Delay between retries in milliseconds. Defaults to 1000 (1 second). */
  retryDelay?: number;
  /** Abort the in-flight request when the app navigates. Defaults to true. */
  abortOnNavigation?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_RETRIES = 0;
const DEFAULT_RETRY_DELAY_MS = 1000;

function isRetryableNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

function waitForRetry(
  delay: number,
  signal?: AbortSignal | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("The operation was aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export async function request<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = getApiUrl(path);
  const method = options.method || "GET";
  const headers = buildHeaders(method, options.headers);
  const {
    timeout,
    timeoutMs,
    retries = DEFAULT_RETRIES,
    retryDelay = DEFAULT_RETRY_DELAY_MS,
    abortOnNavigation = true,
    signal: callerSignal,
    ...fetchOptions
  } = options;
  const timeoutMillis = timeoutMs ?? timeout ?? DEFAULT_TIMEOUT_MS;

  // Early exit: caller's signal already aborted before we even start
  if (callerSignal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }

  let lastError: Error | null = null;

  // Fork-owned: route changes abort in-flight requests.
  if (abortOnNavigation) {
    installNavigationEventBridge();
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (callerSignal?.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    // Create AbortController for timeout handling
    const controller = new AbortController();
    let timedOut = false;
    let abortedByNavigation = false;
    const onNavigationChange = () => {
      abortedByNavigation = true;
      controller.abort();
    };
    if (abortOnNavigation) {
      window.addEventListener(NAVIGATION_CHANGE_EVENT, onNavigationChange);
    }
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMillis);

    // Wire caller's signal to our controller so external abort also works
    let onCallerAbort: (() => void) | undefined;
    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        onCallerAbort = () => controller.abort();
        callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      }
    }

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          clearAuthToken();
          if (!isLoginPath(window.location.pathname)) {
            window.location.href = getLoginHref(window.location);
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
    } catch (error) {
      if (abortedByNavigation) {
        throw new Error("Request aborted");
      }
      if (callerSignal?.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      if (
        error instanceof DOMException &&
        error.name === "AbortError" &&
        !timedOut
      ) {
        // External abort (caller cancelled): do not retry, rethrow as-is
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        // Timeout-triggered abort
        lastError = new Error(
          `Request timeout after ${timeoutMillis}ms: ${method} ${path}`,
        );

        // Retry if we have attempts remaining
        if (attempt < retries) {
          await waitForRetry(retryDelay, callerSignal);
          continue;
        }
      } else if (isRetryableNetworkError(error) && attempt < retries) {
        await waitForRetry(retryDelay, callerSignal);
        continue;
      } else {
        throw error;
      }
    } finally {
      clearTimeout(timeoutId);
      if (abortOnNavigation) {
        window.removeEventListener(NAVIGATION_CHANGE_EVENT, onNavigationChange);
      }
      if (onCallerAbort && callerSignal) {
        callerSignal.removeEventListener("abort", onCallerAbort);
      }
    }
  }

  // All retries exhausted
  throw lastError;
}
