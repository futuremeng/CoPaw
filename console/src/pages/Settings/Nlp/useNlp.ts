import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import api from "../../../api";
import { useAppMessage } from "../../../hooks/useAppMessage";

const NLP_STATUS_SNAPSHOT_KEY = "copaw:nlp-status-snapshot:v1";
const NLP_STATUS_SNAPSHOT_TTL_MS = 5 * 60 * 1000;

export interface NlpStatus {
  provider?: string;
  strategy?: {
    mode?: string;
    default_model_id?: string;
    task_overrides?: Record<string, string>;
    auto_classical_chinese?: {
      enabled?: boolean;
      threshold?: number;
      model_id?: string;
    };
  };
  sidecar: {
    status: string;
    reason_code: string;
    reason: string;
    enabled: boolean;
    python_executable: string;
    python_version?: string;
    managed: boolean;
    uv_available: boolean;
    uv_executable: string;
    model_home?: string;
    model_cache_path?: string;
    hanlp_home?: string;
  };
  model: {
    status: string;
    reason_code: string;
    reason: string;
    model_id: string;
  };
  api?: Record<string, unknown>;
  tasks?: Record<string, {
    enabled?: boolean;
    status?: string;
    reason_code?: string;
    reason?: string;
  }>;
  preload?: {
    enabled: boolean;
    scope: "critical" | "all_enabled_tasks";
    status: string;
    reason: string;
    model_cache_path?: string;
    started_at?: number | null;
    finished_at?: number | null;
    preloaded_models?: Array<{
      task_key: string;
      model_id: string;
      status: string;
    }>;
    task_results?: Record<string, {
      status: string;
      reason_code?: string;
      reason?: string;
      model_id?: string;
    }>;
  };
  deprecated?: boolean;
  migration?: {
    message?: string;
    target_endpoint?: string;
  };
}

export interface NlpStrategyUpdatePayload {
  mode?: "auto" | "manual" | "hybrid";
  default_model_id?: string;
  task_overrides?: Record<string, string>;
  auto_classical_chinese?: {
    enabled?: boolean;
    threshold?: number;
    model_id?: string;
  };
}

export interface NlpStrategyDryRunDecision {
  task_key: string;
  strategy_mode: string;
  detected_style: string;
  detection_score: number;
  selected_model: string;
  matched_rules: string[];
  fallback_used: boolean;
}

export interface NlpMethodDemoResult {
  task_key: string;
  request_id: string;
  status: string;
  reason_code: string;
  reason: string;
  result: unknown;
  raw_result?: unknown;
  resolved_model: string;
  strategy_mode: string;
  detected_style: string;
  detection_score: number;
  matched_rules: string[];
  fallback_used: boolean;
  duration_ms: number;
  model_cache_path?: string;
  runtime_python_executable?: string;
  effective_task_model_id?: string;
  preload_status?: string;
  sidecar_elapsed_ms?: number;
  sidecar_trace_elapsed_ms?: number;
  sidecar_execution_path?: string;
  sidecar_execution_detail?: string;
  sidecar_trace_stage_ms?: Record<string, number>;
}

export interface NlpLocalModelItem {
  scope: string;
  task_key: string;
  task_name: string;
  model_id: string;
  local_available: boolean;
}

export interface NlpLocalModelsStatus {
  provider?: string;
  engine: string;
  status: string;
  reason_code: string;
  reason: string;
  python_version?: string;
  require_local_models: boolean;
  hanlp_home?: string;
  model_cache_path?: string;
  items: NlpLocalModelItem[];
}

export interface HanlpOperation {
  name: string;
  attempted: boolean;
  installer: string | null;
  command: string;
  ok: boolean;
  output: string;
  returncode: number | null;
}

type NlpStatusSnapshot = {
  ts: number;
  status: NlpStatus | null;
  localModelsStatus: NlpLocalModelsStatus | null;
};

function readNlpStatusSnapshot(): NlpStatusSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(NLP_STATUS_SNAPSHOT_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as NlpStatusSnapshot;
    if (!parsed || typeof parsed.ts !== "number") {
      return null;
    }
    if (Date.now() - parsed.ts > NLP_STATUS_SNAPSHOT_TTL_MS) {
      return null;
    }
    return {
      ts: parsed.ts,
      status: (parsed.status || null) as NlpStatus | null,
      localModelsStatus: (parsed.localModelsStatus || null) as NlpLocalModelsStatus | null,
    };
  } catch {
    return null;
  }
}

function writeNlpStatusSnapshot(snapshot: NlpStatusSnapshot): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(NLP_STATUS_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Best-effort cache; ignore quota or serialization errors.
  }
}

export function useNlp() {
  const { t } = useTranslation();
  const { message } = useAppMessage();

  const [snapshotSeed] = useState<NlpStatusSnapshot | null>(() => readNlpStatusSnapshot());

  const [loading, setLoading] = useState(snapshotSeed == null);
  const [installing, setInstalling] = useState(false);
  const [downloadingModel, setDownloadingModel] = useState(false);
  const [downloadingMissingLocalModels, setDownloadingMissingLocalModels] = useState(false);
  const [lastDownloadAttempts, setLastDownloadAttempts] = useState<Array<{
    model_id: string;
    status: string;
    reason_code: string;
    reason: string;
  }> | null>(null);
  const [savingPreload, setSavingPreload] = useState(false);
  const [runningPreload, setRunningPreload] = useState(false);
  const [savingStrategy, setSavingStrategy] = useState(false);
  const [dryRunningDecision, setDryRunningDecision] = useState(false);
  const [status, setStatus] = useState<NlpStatus | null>(snapshotSeed?.status ?? null);
  const [localModelsStatus, setLocalModelsStatus] = useState<NlpLocalModelsStatus | null>(
    snapshotSeed?.localModelsStatus ?? null,
  );
  const [lastManualSteps, setLastManualSteps] = useState<string[]>([]);
  const [lastOperations, setLastOperations] = useState<HanlpOperation[]>([]);
  const [lastStrategyDecision, setLastStrategyDecision] = useState<NlpStrategyDryRunDecision | null>(null);
  const [runningDemoTask, setRunningDemoTask] = useState<string | null>(null);
  const [demoResults, setDemoResults] = useState<Record<string, NlpMethodDemoResult>>({});

  const fetchStatus = async (showLoading = false) => {
    if (showLoading) {
      setLoading(true);
    }
    try {
      const [statusRes, localModelsRes] = await Promise.all([
        api.getNlpStatus(),
        api.getNlpLocalModelsStatus().catch(() => null),
      ]);
      setStatus(statusRes);
      setLocalModelsStatus(localModelsRes);
      writeNlpStatusSnapshot({
        ts: Date.now(),
        status: statusRes,
        localModelsStatus: localModelsRes,
      });
    } catch (error) {
      console.error("Failed to load NLP settings:", error);
      message.error(t("nlpConfig.loadFailed"));
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void fetchStatus(snapshotSeed == null);
  }, []);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const res = await api.installHanlp();
      setLastManualSteps(res.manual_steps ?? []);
      setLastOperations(res.operations ?? []);
      if (res.success) {
        message.success(t("nlpConfig.installSuccess"));
      } else {
        message.warning(t("nlpConfig.installPartial"));
      }
      await fetchStatus();
    } catch (error) {
      console.error("Failed to install HanLP sidecar:", error);
      message.error(t("nlpConfig.installFailed"));
    } finally {
      setInstalling(false);
    }
  };

  const handleDownloadModel = async () => {
    setDownloadingModel(true);
    try {
      const res = await api.downloadHanlpModel();
      setLastManualSteps(res.manual_steps ?? []);
      setLastOperations([
        {
          name: "model-verify",
          attempted: true,
          installer: "hanlp",
          command: res.model_result?.model_id || "",
          ok: res.success,
          output: res.model_result?.reason || "",
          returncode: res.success ? 0 : null,
        },
      ]);
      if (res.success) {
        message.success(t("nlpConfig.downloadSuccess"));
      } else {
        message.warning(t("nlpConfig.downloadPartial"));
      }
      await fetchStatus();
    } catch (error) {
      console.error("Failed to download HanLP model:", error);
      message.error(t("nlpConfig.downloadFailed"));
    } finally {
      setDownloadingModel(false);
    }
  };

  const handleDownloadMissingLocalModels = async () => {
    setDownloadingMissingLocalModels(true);
    setLastDownloadAttempts(null);
    try {
      const res = await api.downloadMissingNlpLocalModels();
      setLastDownloadAttempts(res.attempts ?? null);
      if (res.success) {
        message.success("本地缺失模型已全部下载完成");
      } else {
        const remaining = res.after?.missing_count ?? (res.attempts ?? []).filter((a) => a.status !== "ready").length;
        message.warning(`下载完成，仍有 ${remaining} 个模型未就绪，请查看详情`);
      }
      await fetchStatus();
      return res;
    } catch (error) {
      console.error("Failed to download missing local NLP models:", error);
      message.error("批量下载本地模型失败");
      return null;
    } finally {
      setDownloadingMissingLocalModels(false);
    }
  };

  const handleUpdateStrategy = async (payload: NlpStrategyUpdatePayload) => {
    setSavingStrategy(true);
    try {
      await api.updateNlpStrategy(payload);
      message.success("NLP strategy updated");
      await fetchStatus();
      return true;
    } catch (error) {
      console.error("Failed to update NLP strategy:", error);
      message.error("Failed to update NLP strategy");
      return false;
    } finally {
      setSavingStrategy(false);
    }
  };

  const handleUpdatePreload = async (payload: {
    enabled: boolean;
    scope: "critical" | "all_enabled_tasks";
  }) => {
    setSavingPreload(true);
    try {
      await api.updateNlpPreload(payload);
      message.success("NLP preload settings updated");
      await fetchStatus();
      return true;
    } catch (error) {
      console.error("Failed to update NLP preload settings:", error);
      message.error("Failed to update NLP preload settings");
      return false;
    } finally {
      setSavingPreload(false);
    }
  };

  const handleTriggerPreload = async (force = false) => {
    setRunningPreload(true);
    try {
      await api.triggerNlpPreload({ force });
      message.success("HanLP preload started");
      await fetchStatus();
      return true;
    } catch (error) {
      console.error("Failed to start HanLP preload:", error);
      message.error("Failed to start HanLP preload");
      return false;
    } finally {
      setRunningPreload(false);
    }
  };

  const handleDryRunStrategy = async (text: string, taskKey: string) => {
    const normalizedText = String(text || "").trim();
    if (!normalizedText) {
      message.warning("Please enter text for strategy preview");
      return null;
    }
    setDryRunningDecision(true);
    try {
      const res = await api.dryRunNlpStrategy({ text: normalizedText, task_key: taskKey });
      setLastStrategyDecision(res.decision || null);
      return res.decision || null;
    } catch (error) {
      console.error("Failed to preview NLP strategy decision:", error);
      message.error("Failed to preview NLP strategy decision");
      return null;
    } finally {
      setDryRunningDecision(false);
    }
  };

  const runMethodDemo = async (taskKey: string, text: string) => {
    const normalizedTaskKey = String(taskKey || "").trim();
    const normalizedText = String(text || "").trim();
    if (!normalizedTaskKey || !normalizedText) {
      message.warning("Please select a method and provide test text");
      return null;
    }

    setRunningDemoTask(normalizedTaskKey);
    try {
      const result = await api.runNlpTaskDemo(normalizedTaskKey, {
        text: normalizedText,
      });
      setDemoResults((prev) => ({ ...prev, [normalizedTaskKey]: result }));
      if (result.status === "ready") {
        message.success(`${normalizedTaskKey} demo finished`);
      } else {
        message.warning(`${normalizedTaskKey} demo: ${result.reason_code}`);
      }
      return result;
    } catch (error) {
      console.error("Failed to run NLP method demo:", error);
      message.error("Failed to run NLP method demo");
      return null;
    } finally {
      setRunningDemoTask(null);
    }
  };

  const sidecarReady = status?.sidecar.status === "ready";
  const modelReady = status?.model.status === "ready";
  const provider = String(status?.provider || "hanlp").toLowerCase();
  const hanlpProviderActive = provider === "hanlp";

  return {
    loading,
    installing,
    downloadingModel,
    downloadingMissingLocalModels,
    lastDownloadAttempts,
    savingPreload,
    runningPreload,
    savingStrategy,
    dryRunningDecision,
    status,
    localModelsStatus,
    provider,
    hanlpProviderActive,
    lastManualSteps,
    lastOperations,
    runningDemoTask,
    demoResults,
    sidecarReady,
    modelReady,
    fetchStatus,
    handleInstall,
    handleDownloadModel,
    handleDownloadMissingLocalModels,
    handleUpdatePreload,
    clearDownloadAttempts: () => setLastDownloadAttempts(null),
    handleTriggerPreload,
    handleUpdateStrategy,
    handleDryRunStrategy,
    lastStrategyDecision,
    runMethodDemo,
  };
}
