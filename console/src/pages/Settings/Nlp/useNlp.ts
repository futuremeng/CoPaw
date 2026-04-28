import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import api from "../../../api";
import { useAppMessage } from "../../../hooks/useAppMessage";

export interface NlpStatus {
  provider?: string;
  sidecar: {
    status: string;
    reason_code: string;
    reason: string;
    enabled: boolean;
    python_executable: string;
    managed: boolean;
    uv_available: boolean;
    uv_executable: string;
    model_home?: string;
    hanlp_home?: string;
  };
  model: {
    status: string;
    reason_code: string;
    reason: string;
    model_id: string;
  };
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

export function useNlp() {
  const { t } = useTranslation();
  const { message } = useAppMessage();

  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [downloadingModel, setDownloadingModel] = useState(false);
  const [status, setStatus] = useState<NlpStatus | null>(null);
  const [lastManualSteps, setLastManualSteps] = useState<string[]>([]);
  const [lastOperations, setLastOperations] = useState<HanlpOperation[]>([]);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await api.getNlpStatus();
      setStatus(res);
    } catch (error) {
      console.error("Failed to load NLP settings:", error);
      message.error(t("nlpConfig.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
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

  const sidecarReady = status?.sidecar.status === "ready";
  const modelReady = status?.model.status === "ready";

  return {
    loading,
    installing,
    downloadingModel,
    status,
    lastManualSteps,
    lastOperations,
    sidecarReady,
    modelReady,
    fetchStatus,
    handleInstall,
    handleDownloadModel,
  };
}