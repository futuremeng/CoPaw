import { useState, useEffect, useCallback } from "react";
import { Form, Modal } from "@agentscope-ai/design";
import { useTranslation } from "react-i18next";
import api from "../../../api";
import type { AgentsRunningConfig } from "../../../api/types";
import { useAppMessage } from "../../../hooks/useAppMessage";
import { useAgentStore } from "../../../stores/agentStore";
import {
  CONTEXT_MANAGER_BACKEND_MAPPINGS,
  MEMORY_MANAGER_BACKEND_MAPPINGS,
} from "../../../constants/backendMappings";
import type { ToolExecutionLevel } from "./components/ToolExecutionLevelCard";

export function useAgentConfig() {
  const { t } = useTranslation();
  const { message } = useAppMessage();
  const { selectedAgent } = useAgentStore();
  const [form] = Form.useForm();
  const [runningConfigSnapshot, setRunningConfigSnapshot] =
    useState<AgentsRunningConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>("zh");
  const [savingLang, setSavingLang] = useState(false);
  const [timezone, setTimezone] = useState<string>("UTC");
  const [savingTimezone, setSavingTimezone] = useState(false);
  const [approvalLevel, setApprovalLevel] =
    useState<ToolExecutionLevel>("AUTO");

  const normalizeConfigForForm = useCallback(
    (config: AgentsRunningConfig) => {
      const contextBackend =
        config.context_manager_backend &&
        config.context_manager_backend in CONTEXT_MANAGER_BACKEND_MAPPINGS
          ? config.context_manager_backend
          : "light";
      const memoryBackend =
        config.memory_manager_backend in MEMORY_MANAGER_BACKEND_MAPPINGS
          ? config.memory_manager_backend
          : "remelight";
      return {
        ...(config as AgentsRunningConfig),
        auto_continue_on_text_only: config.auto_continue_on_text_only ?? false,
        shell_command_timeout: config.shell_command_timeout ?? 60.0,
        shell_command_executable: config.shell_command_executable ?? "",
        context_manager_backend: contextBackend,
        memory_manager_backend: memoryBackend,
        auto_title_config: config.auto_title_config ?? {
          enabled: true,
          timeout_seconds: 30.0,
        },
      };
    },
    [],
  );

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [config, langResp, tzResp] = await Promise.all([
        api.getAgentRunningConfig(),
        api.getAgentLanguage(),
        api.getUserTimezone(),
      ]);
      const loadedLevel = (
        config.approval_level || "AUTO"
      ).toUpperCase() as ToolExecutionLevel;
      setApprovalLevel(loadedLevel);
      setRunningConfigSnapshot(config);
      form.setFieldsValue(normalizeConfigForForm(config));
      setLanguage(langResp.language);
      setTimezone(tzResp.timezone || "UTC");
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : t("agentConfig.loadFailed");
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  }, [form, normalizeConfigForForm, t, selectedAgent]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload = {
        ...(runningConfigSnapshot ?? {}),
        ...values,
        approval_level: approvalLevel,
      } as AgentsRunningConfig;
      const savedConfig = await api.updateAgentRunningConfig(payload);
      setRunningConfigSnapshot(savedConfig);
      setApprovalLevel(
        ((savedConfig.approval_level || "AUTO") as string).toUpperCase() as ToolExecutionLevel,
      );
      form.setFieldsValue(normalizeConfigForForm(savedConfig));
      message.success(t("agentConfig.saveSuccess"));
    } catch (err) {
      if (err instanceof Error && "errorFields" in err) return;
      const errMsg =
        err instanceof Error ? err.message : t("agentConfig.saveFailed");
      message.error(errMsg);
    } finally {
      setSaving(false);
    }
  }, [
    approvalLevel,
    form,
    message,
    normalizeConfigForForm,
    runningConfigSnapshot,
    t,
  ]);

  const handleLanguageChange = useCallback(
    (value: string): void => {
      if (value === language) return;
      Modal.confirm({
        title: t("agentConfig.languageConfirmTitle"),
        content: (
          <span style={{ whiteSpace: "pre-line" }}>
            {t("agentConfig.languageConfirmContent")}
          </span>
        ),
        okText: t("agentConfig.languageConfirmOk"),
        cancelText: t("common.cancel"),
        onOk: async () => {
          setSavingLang(true);
          try {
            const resp = await api.updateAgentLanguage(value);
            setLanguage(resp.language);
            if (resp.copied_files && resp.copied_files.length > 0) {
              message.success(
                t("agentConfig.languageSaveSuccessWithFiles", {
                  count: resp.copied_files.length,
                }),
              );
            } else {
              message.success(t("agentConfig.languageSaveSuccess"));
            }
          } catch (err) {
            const errMsg =
              err instanceof Error
                ? err.message
                : t("agentConfig.languageSaveFailed");
            message.error(errMsg);
          } finally {
            setSavingLang(false);
          }
        },
      });
    },
    [language, t],
  );

  const handleTimezoneChange = useCallback(
    async (value: string) => {
      if (value === timezone) return;
      setSavingTimezone(true);
      try {
        await api.updateUserTimezone(value);
        setTimezone(value);
        message.success(t("agentConfig.timezoneSaveSuccess"));
      } catch (err) {
        const errMsg =
          err instanceof Error
            ? err.message
            : t("agentConfig.timezoneSaveFailed");
        message.error(errMsg);
      } finally {
        setSavingTimezone(false);
      }
    },
    [timezone, t],
  );

  return {
    form,
    loading,
    saving,
    error,
    language,
    savingLang,
    timezone,
    savingTimezone,
    approvalLevel,
    setApprovalLevel,
    fetchConfig,
    handleSave,
    handleLanguageChange,
    handleTimezoneChange,
  };
}
