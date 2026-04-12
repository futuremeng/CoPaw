import { useEffect, useRef, useState } from "react";
import { getApiToken, getApiUrl } from "../../../api";

interface ProjectRealtimeSectionSnapshot {
  fingerprint: string;
  file_count?: number;
  run_count?: number;
  latest_mtime_ns: number;
}

interface ProjectRealtimeSnapshot {
  project_id: string;
  generated_at: string;
  file_tree: ProjectRealtimeSectionSnapshot;
  pipeline: ProjectRealtimeSectionSnapshot;
}

interface ProjectRealtimeEnvelope {
  type: "snapshot" | "heartbeat" | "error";
  event_id?: number;
  project_id?: string;
  detail?: string;
  reason?: string;
  changed_paths?: string[];
  changed_count?: number;
  generated_at?: string;
  snapshot?: ProjectRealtimeSnapshot;
}

interface ProjectRealtimeInvalidationPayload {
  changedPaths: string[];
  reason: string;
}

export type ProjectRealtimeConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "degraded"
  | "paused";

export interface ProjectRealtimeConnectionState {
  status: ProjectRealtimeConnectionStatus;
  reconnectAttempt: number;
}

interface UseProjectRealtimeControllerParams {
  agentId?: string;
  projectId?: string;
  onFileTreeInvalidated?: (
    payload: ProjectRealtimeInvalidationPayload,
  ) => void | Promise<void>;
  onPipelineInvalidated?: (
    payload: ProjectRealtimeInvalidationPayload,
  ) => void | Promise<void>;
}

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;
const RECONNECT_JITTER_MS = 250;

export default function useProjectRealtimeController({
  agentId,
  projectId,
  onFileTreeInvalidated,
  onPipelineInvalidated,
}: UseProjectRealtimeControllerParams) {
  const [connectionState, setConnectionState] = useState<ProjectRealtimeConnectionState>({
    status: "idle",
    reconnectAttempt: 0,
  });
  const fileFingerprintRef = useRef("");
  const pipelineFingerprintRef = useRef("");
  const initializedRef = useRef(false);
  const hasConnectedRef = useRef(false);
  const shouldResyncRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const fileCallbackRef = useRef(onFileTreeInvalidated);
  const pipelineCallbackRef = useRef(onPipelineInvalidated);

  fileCallbackRef.current = onFileTreeInvalidated;
  pipelineCallbackRef.current = onPipelineInvalidated;

  useEffect(() => {
    if (!agentId || !projectId || typeof WebSocket === "undefined") {
      setConnectionState({ status: "idle", reconnectAttempt: 0 });
      return;
    }

    let disposed = false;
    let socket: WebSocket | null = null;

    fileFingerprintRef.current = "";
    pipelineFingerprintRef.current = "";
    initializedRef.current = false;
    shouldResyncRef.current = hasConnectedRef.current;
    setConnectionState({
      status: document.hidden ? "paused" : "connecting",
      reconnectAttempt: 0,
    });

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const closeSocket = () => {
      if (!socket) {
        return;
      }
      shouldResyncRef.current = hasConnectedRef.current || initializedRef.current;
      const activeSocket = socket;
      socket = null;
      if (activeSocket.readyState === WebSocket.CONNECTING) {
        activeSocket.onopen = () => {
          activeSocket.close();
        };
      } else if (activeSocket.readyState === WebSocket.OPEN) {
        activeSocket.close();
      }
    };

    const scheduleReconnect = () => {
      clearReconnectTimer();
      const attempt = reconnectAttemptRef.current + 1;
      reconnectAttemptRef.current = attempt;
      setConnectionState({
        status: attempt >= 3 ? "degraded" : "reconnecting",
        reconnectAttempt: attempt,
      });
      const baseDelay = Math.min(
        RECONNECT_MAX_DELAY_MS,
        RECONNECT_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1)),
      );
      const jitter = Math.floor(Math.random() * RECONNECT_JITTER_MS);
      reconnectTimerRef.current = window.setTimeout(connect, baseDelay + jitter);
    };

    const connect = () => {
      if (disposed || document.hidden || socket) {
        return;
      }

      setConnectionState({
        status: hasConnectedRef.current ? "reconnecting" : "connecting",
        reconnectAttempt: reconnectAttemptRef.current,
      });

      try {
        const wsUrl = new URL(
          getApiUrl(`/agents/${agentId}/projects/${encodeURIComponent(projectId)}/realtime/ws`),
          window.location.origin,
        );
        wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
        wsUrl.searchParams.set("interval_ms", "1500");
        const token = getApiToken();
        if (token) {
          wsUrl.searchParams.set("token", token);
        }

        socket = new WebSocket(wsUrl.toString());
        socket.onopen = () => {
          clearReconnectTimer();
          setConnectionState({
            status: hasConnectedRef.current ? "reconnecting" : "connecting",
            reconnectAttempt: reconnectAttemptRef.current,
          });
        };
        socket.onmessage = (event) => {
          if (disposed) {
            return;
          }

          try {
            const payload = JSON.parse(event.data || "{}") as ProjectRealtimeEnvelope;
            if (payload.type === "heartbeat") {
              reconnectAttemptRef.current = 0;
              setConnectionState({ status: "connected", reconnectAttempt: 0 });
              return;
            }

            if (payload.type !== "snapshot" || !payload.snapshot) {
              return;
            }

            const changedPaths = payload.changed_paths || [];
            const reason = payload.reason || "change";
            const nextFileFingerprint = payload.snapshot.file_tree.fingerprint || "";
            const nextPipelineFingerprint = payload.snapshot.pipeline.fingerprint || "";

            if (!initializedRef.current) {
              fileFingerprintRef.current = nextFileFingerprint;
              pipelineFingerprintRef.current = nextPipelineFingerprint;
              initializedRef.current = true;
              reconnectAttemptRef.current = 0;
              const shouldResync = shouldResyncRef.current;
              shouldResyncRef.current = false;
              hasConnectedRef.current = true;
              setConnectionState({ status: "connected", reconnectAttempt: 0 });
              if (shouldResync) {
                void fileCallbackRef.current?.({ changedPaths, reason: "resync" });
                void pipelineCallbackRef.current?.({ changedPaths, reason: "resync" });
              }
              return;
            }

            if (nextFileFingerprint && nextFileFingerprint !== fileFingerprintRef.current) {
              fileFingerprintRef.current = nextFileFingerprint;
              void fileCallbackRef.current?.({ changedPaths, reason });
            }

            if (nextPipelineFingerprint && nextPipelineFingerprint !== pipelineFingerprintRef.current) {
              pipelineFingerprintRef.current = nextPipelineFingerprint;
              void pipelineCallbackRef.current?.({ changedPaths, reason });
            }
            reconnectAttemptRef.current = 0;
            setConnectionState({ status: "connected", reconnectAttempt: 0 });
          } catch {
            // Ignore malformed realtime frames.
          }
        };

        socket.onclose = () => {
          socket = null;
          if (disposed) {
            return;
          }
          shouldResyncRef.current = true;
          if (!document.hidden) {
            scheduleReconnect();
          } else {
            setConnectionState({ status: "paused", reconnectAttempt: reconnectAttemptRef.current });
          }
        };
        socket.onerror = () => {
          shouldResyncRef.current = true;
          setConnectionState({
            status: reconnectAttemptRef.current >= 2 ? "degraded" : "reconnecting",
            reconnectAttempt: reconnectAttemptRef.current,
          });
        };
      } catch {
        shouldResyncRef.current = true;
        scheduleReconnect();
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearReconnectTimer();
        closeSocket();
        setConnectionState({ status: "paused", reconnectAttempt: reconnectAttemptRef.current });
        return;
      }
      shouldResyncRef.current = true;
      connect();
    };

    connect();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearReconnectTimer();
      closeSocket();
      setConnectionState({ status: "idle", reconnectAttempt: 0 });
    };
  }, [agentId, projectId]);

  return connectionState;
}