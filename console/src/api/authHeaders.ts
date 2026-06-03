import { getApiToken } from "./config";

/** Authorization + X-Agent-Id for API requests. Caller sets Content-Type when needed. */
export function buildAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getApiToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  try {
    // Read from sessionStorage first (per-tab agent), fall back to localStorage
    const agentStorage =
      sessionStorage.getItem("qwenpaw-agent-storage") ||
      localStorage.getItem("qwenpaw-agent-storage");
    if (agentStorage) {
      const parsed = JSON.parse(agentStorage);
      const selectedAgent = parsed?.state?.selectedAgent;
      if (selectedAgent) {
        headers["X-Agent-Id"] = selectedAgent;
      }
    }
  } catch (error) {
    console.warn("Failed to get selected agent from storage:", error);
  }

  // Include X-Project-Id when a project context is active
  try {
    const projectStorage = sessionStorage.getItem("qwenpaw-project-storage");
    if (projectStorage) {
      const parsed = JSON.parse(projectStorage);
      const projectId = parsed?.state?.projectId;
      if (projectId) {
        headers["X-Project-Id"] = projectId;
      }
    }
  } catch (error) {
    console.warn("Failed to get project id from storage:", error);
  }

  return headers;
}

/** Set the current project ID for subsequent API requests. */
export function setProjectIdHeader(projectId: string): void {
  try {
    const storage = JSON.parse(
      sessionStorage.getItem("qwenpaw-project-storage") || "{}",
    );
    storage.state = storage.state || {};
    storage.state.projectId = projectId;
    sessionStorage.setItem("qwenpaw-project-storage", JSON.stringify(storage));
  } catch (error) {
    console.warn("Failed to set project id header:", error);
  }
}

/** Clear the current project ID header. */
export function clearProjectIdHeader(): void {
  try {
    sessionStorage.removeItem("qwenpaw-project-storage");
  } catch (error) {
    console.warn("Failed to clear project id header:", error);
  }
}
