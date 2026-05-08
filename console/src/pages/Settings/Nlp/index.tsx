import { Button } from "@agentscope-ai/design";
import { Alert, Card, Input, InputNumber, Select, Space, Spin, Switch, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { useNlp } from "./useNlp";
import styles from "./index.module.less";

type MethodStatus = {
  status: string;
  reasonCode: string;
  reason: string;
};

function resolveTagColor(status: string): "success" | "warning" | "error" | "default" {
  if (status === "ready") {
    return "success";
  }
  if (status === "error") {
    return "error";
  }
  if (status === "disabled") {
    return "default";
  }
  return "warning";
}

function NlpPage() {
  const { t } = useTranslation();
  const {
    loading,
    installing,
    downloadingModel,
    savingStrategy,
    dryRunningDecision,
    status,
    provider,
    hanlpProviderActive,
    lastManualSteps,
    lastOperations,
    sidecarReady,
    modelReady,
    fetchStatus,
    handleInstall,
    handleDownloadModel,
    handleUpdateStrategy,
    handleDryRunStrategy,
    lastStrategyDecision,
  } = useNlp();

  const taskStates = status?.tasks ?? {};
  const strategy = status?.strategy;
  const autoClassical = strategy?.auto_classical_chinese;
  const overrideEntries = Object.entries(strategy?.task_overrides ?? {});
  const [modeDraft, setModeDraft] = useState<"auto" | "manual" | "hybrid">("auto");
  const [defaultModelDraft, setDefaultModelDraft] = useState("");
  const [autoEnabledDraft, setAutoEnabledDraft] = useState(true);
  const [thresholdDraft, setThresholdDraft] = useState<number>(0.22);
  const [classicalModelDraft, setClassicalModelDraft] = useState("");
  const [taskOverridesText, setTaskOverridesText] = useState("{}");
  const [strategyParseError, setStrategyParseError] = useState("");
  const [previewTaskKey, setPreviewTaskKey] = useState("ner");
  const [previewText, setPreviewText] = useState("吾之道也");

  useEffect(() => {
    const nextMode = strategy?.mode === "manual" || strategy?.mode === "hybrid" ? strategy.mode : "auto";
    setModeDraft(nextMode);
    setDefaultModelDraft(strategy?.default_model_id || status?.model.model_id || "");
    setAutoEnabledDraft(Boolean(autoClassical?.enabled ?? true));
    setThresholdDraft(typeof autoClassical?.threshold === "number" ? autoClassical.threshold : 0.22);
    setClassicalModelDraft(autoClassical?.model_id || "");
    setTaskOverridesText(JSON.stringify(strategy?.task_overrides ?? {}, null, 2));
    setStrategyParseError("");
  }, [
    autoClassical?.enabled,
    autoClassical?.model_id,
    autoClassical?.threshold,
    status?.model.model_id,
    strategy?.default_model_id,
    strategy?.mode,
    strategy?.task_overrides,
  ]);

  const handleSaveStrategy = async () => {
    let parsedOverrides: Record<string, string> = {};
    const rawText = taskOverridesText.trim();
    if (rawText) {
      try {
        const parsed = JSON.parse(rawText) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          setStrategyParseError("");
          parsedOverrides = Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
              String(key || "").trim(),
              String(value || "").trim(),
            ]).filter(([key, value]) => key && value),
          );
        } else {
          setStrategyParseError("Task overrides must be a JSON object.");
          return;
        }
      } catch {
        setStrategyParseError("Task overrides JSON is invalid.");
        return;
      }
    }

    await handleUpdateStrategy({
      mode: modeDraft,
      default_model_id: defaultModelDraft.trim(),
      task_overrides: parsedOverrides,
      auto_classical_chinese: {
        enabled: autoEnabledDraft,
        threshold: Number.isFinite(thresholdDraft) ? thresholdDraft : 0.22,
        model_id: classicalModelDraft.trim(),
      },
    });
  };

  const methods: Array<{ key: string; taskKey?: string; status: MethodStatus }> = [
    {
      key: "tokenize",
      status: sidecarReady
        ? modelReady
          ? {
              status: "ready",
              reasonCode: "HANLP2_MODEL_READY",
              reason: t("nlpConfig.methods.tokenize.readyReason"),
            }
          : {
              status: "unavailable",
              reasonCode: status?.model.reason_code || "HANLP2_MODEL_LOAD_FAILED",
              reason: status?.model.reason || t("nlpConfig.methods.tokenize.unavailableReason"),
            }
        : {
            status: "unavailable",
            reasonCode: status?.sidecar.reason_code || "HANLP2_SIDECAR_UNCONFIGURED",
            reason: status?.sidecar.reason || t("nlpConfig.methods.tokenize.unavailableReason"),
          },
    },
    {
      key: "nerMsra",
      taskKey: "ner_msra",
      status: {
        status: taskStates.ner_msra?.status || "unavailable",
        reasonCode: taskStates.ner_msra?.reason_code || "HANLP2_TASK_NOT_CONFIGURED",
        reason: taskStates.ner_msra?.reason || t("nlpConfig.methods.defaultUnavailableReason"),
      },
    },
    {
      key: "dep",
      taskKey: "dep",
      status: {
        status: taskStates.dep?.status || "unavailable",
        reasonCode: taskStates.dep?.reason_code || "HANLP2_TASK_NOT_CONFIGURED",
        reason: taskStates.dep?.reason || t("nlpConfig.methods.defaultUnavailableReason"),
      },
    },
    {
      key: "sdp",
      taskKey: "sdp",
      status: {
        status: taskStates.sdp?.status || "unavailable",
        reasonCode: taskStates.sdp?.reason_code || "HANLP2_TASK_NOT_CONFIGURED",
        reason: taskStates.sdp?.reason || t("nlpConfig.methods.defaultUnavailableReason"),
      },
    },
    {
      key: "con",
      taskKey: "con",
      status: {
        status: taskStates.con?.status || "unavailable",
        reasonCode: taskStates.con?.reason_code || "HANLP2_TASK_NOT_CONFIGURED",
        reason: taskStates.con?.reason || t("nlpConfig.methods.defaultUnavailableReason"),
      },
    },
    {
      key: "cor",
      taskKey: "cor",
      status: {
        status: taskStates.cor?.status || "unavailable",
        reasonCode: taskStates.cor?.reason_code || "HANLP2_COREF_NOT_OPEN_SOURCE",
        reason: taskStates.cor?.reason || t("nlpConfig.methods.cor.unavailableReason"),
      },
    },
  ];

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.centerState}>
          <Spin />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.nlpPage}>
      <PageHeader
        items={[
          { title: t("nav.settings") },
          { title: t("nlpConfig.title") },
        ]}
      />

      <Alert
        type="info"
        showIcon
        message={t("nlpConfig.infoTitle")}
        description={t("nlpConfig.infoDescription")}
      />

      <Alert
        type={hanlpProviderActive ? "success" : "warning"}
        showIcon
        message={t("nlpConfig.providerMessage", { provider: provider || "hanlp" })}
        description={
          hanlpProviderActive
            ? t("nlpConfig.providerActive")
            : t("nlpConfig.providerInactive")
        }
      />

      {status?.sidecar.reason_code === "HANLP2_FULL_INSTALL_REQUIRED" ? (
        <Alert
          type="warning"
          showIcon
          message={t("nlpConfig.fullInstallTitle")}
          description={t("nlpConfig.fullInstallDescription")}
        />
      ) : null}

      <div className={styles.content}>
        <Card className={styles.card}>
          <Typography.Title level={5} className={styles.cardTitle}>
            Model Selection Strategy
          </Typography.Title>
          <Typography.Paragraph type="secondary" className={styles.cardDescription}>
            Request-scoped policy used by backend auto-adaptation.
          </Typography.Paragraph>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <div className={styles.statusRow}>
              <span>Mode</span>
              <Tag color={strategy?.mode === "manual" ? "default" : "processing"}>
                {strategy?.mode || "auto"}
              </Tag>
            </div>
            <div className={styles.statusRow}>
              <span>Edit mode</span>
              <Select
                value={modeDraft}
                style={{ width: 180 }}
                options={[
                  { label: "auto", value: "auto" },
                  { label: "manual", value: "manual" },
                  { label: "hybrid", value: "hybrid" },
                ]}
                onChange={(value) => setModeDraft(value)}
              />
            </div>
            <Input
              placeholder="Default model id"
              value={defaultModelDraft}
              onChange={(event) => setDefaultModelDraft(event.target.value)}
            />
            <div className={styles.statusRow}>
              <span>Auto classical Chinese</span>
              <Switch checked={autoEnabledDraft} onChange={setAutoEnabledDraft} />
            </div>
            <InputNumber
              min={0}
              max={1}
              step={0.01}
              value={thresholdDraft}
              onChange={(value) => setThresholdDraft(typeof value === "number" ? value : 0.22)}
            />
            <Input
              placeholder="Classical Chinese model id"
              value={classicalModelDraft}
              onChange={(event) => setClassicalModelDraft(event.target.value)}
            />
            <Input.TextArea
              rows={6}
              value={taskOverridesText}
              onChange={(event) => setTaskOverridesText(event.target.value)}
              placeholder='Task overrides JSON, e.g. {"ner":"model_a"}'
            />
            {strategyParseError ? (
              <Typography.Text type="danger">{strategyParseError}</Typography.Text>
            ) : null}
            <Button type="primary" onClick={handleSaveStrategy} loading={savingStrategy}>
              Save strategy
            </Button>
            <Typography.Text>
              Default model: {strategy?.default_model_id || status?.model.model_id || t("nlpConfig.notConfigured")}
            </Typography.Text>
            <Typography.Text>
              Classical Chinese auto-route: {autoClassical?.enabled ? "enabled" : "disabled"}
            </Typography.Text>
            <Typography.Text>
              Detection threshold: {typeof autoClassical?.threshold === "number" ? autoClassical.threshold : 0.22}
            </Typography.Text>
            <Typography.Text>
              Classical target model: {autoClassical?.model_id || t("nlpConfig.notConfigured")}
            </Typography.Text>
            <div className={styles.operationBlock}>
              <Typography.Text strong>Task overrides</Typography.Text>
              {overrideEntries.length === 0 ? (
                <Typography.Paragraph className={styles.operationOutput}>
                  No task-level overrides configured.
                </Typography.Paragraph>
              ) : (
                overrideEntries.map(([taskKey, modelId]) => (
                  <Typography.Paragraph key={`${taskKey}:${modelId}`} className={styles.operationOutput}>
                    {taskKey}: {modelId}
                  </Typography.Paragraph>
                ))
              )}
            </div>
          </Space>
        </Card>

        <Card className={styles.card}>
          <Typography.Title level={5} className={styles.cardTitle}>
            Strategy Dry-Run Preview
          </Typography.Title>
          <Typography.Paragraph type="secondary" className={styles.cardDescription}>
            Simulate model selection for current strategy without executing NLP tasks.
          </Typography.Paragraph>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Select
              value={previewTaskKey}
              options={[
                { label: "ner", value: "ner" },
                { label: "dep", value: "dep" },
                { label: "sdp", value: "sdp" },
                { label: "con", value: "con" },
                { label: "cor", value: "cor" },
              ]}
              onChange={(value) => setPreviewTaskKey(value)}
              style={{ width: 220 }}
            />
            <Input.TextArea
              rows={4}
              value={previewText}
              onChange={(event) => setPreviewText(event.target.value)}
              placeholder="Enter text for dry-run decision preview"
            />
            <Button
              onClick={() => handleDryRunStrategy(previewText, previewTaskKey)}
              loading={dryRunningDecision}
            >
              Run dry-run
            </Button>
            {lastStrategyDecision ? (
              <div className={styles.operationBlock}>
                <Typography.Paragraph className={styles.operationOutput}>
                  task: {lastStrategyDecision.task_key}
                </Typography.Paragraph>
                <Typography.Paragraph className={styles.operationOutput}>
                  mode: {lastStrategyDecision.strategy_mode}
                </Typography.Paragraph>
                <Typography.Paragraph className={styles.operationOutput}>
                  detected_style: {lastStrategyDecision.detected_style}
                </Typography.Paragraph>
                <Typography.Paragraph className={styles.operationOutput}>
                  detection_score: {lastStrategyDecision.detection_score}
                </Typography.Paragraph>
                <Typography.Paragraph className={styles.operationOutput}>
                  selected_model: {lastStrategyDecision.selected_model || "(empty)"}
                </Typography.Paragraph>
                <Typography.Paragraph className={styles.operationOutput}>
                  matched_rules: {(lastStrategyDecision.matched_rules || []).join(", ") || "(none)"}
                </Typography.Paragraph>
              </div>
            ) : null}
          </Space>
        </Card>

        <Card className={styles.card}>
          <Typography.Title level={5} className={styles.cardTitle}>
            {t("nlpConfig.sidecarTitle")}
          </Typography.Title>
          <Typography.Paragraph type="secondary" className={styles.cardDescription}>
            {t("nlpConfig.sidecarDescription")}
          </Typography.Paragraph>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <div className={styles.statusRow}>
              <span>{t("nlpConfig.sidecarStatus")}</span>
              <Tag color={sidecarReady ? "success" : "warning"}>
                {status?.sidecar.reason_code || status?.sidecar.status}
              </Tag>
            </div>
            <Typography.Text type="secondary">
              {status?.sidecar.reason}
            </Typography.Text>
            <Typography.Text>
              {t("nlpConfig.pythonPath")} {status?.sidecar.python_executable || t("nlpConfig.notConfigured")}
            </Typography.Text>
            <Typography.Text>
              {t("nlpConfig.hanlpHome")} {(status?.sidecar.model_home || status?.sidecar.hanlp_home) || t("nlpConfig.notConfigured")}
            </Typography.Text>
            <Typography.Text>
              {t("nlpConfig.installStrategy", {
                value: status?.sidecar.uv_available
                  ? t("nlpConfig.installStrategyUv")
                  : t("nlpConfig.installStrategyMissingUv"),
              })}
            </Typography.Text>
            <Typography.Text>
              {t("nlpConfig.uvPath")} {status?.sidecar.uv_executable || t("nlpConfig.notConfigured")}
            </Typography.Text>
          </Space>
        </Card>

        <Card className={styles.card}>
          <Typography.Title level={5} className={styles.cardTitle}>
            {t("nlpConfig.modelTitle")}
          </Typography.Title>
          <Typography.Paragraph type="secondary" className={styles.cardDescription}>
            {t("nlpConfig.modelDescription")}
          </Typography.Paragraph>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <div className={styles.statusRow}>
              <span>{t("nlpConfig.modelStatus")}</span>
              <Tag color={modelReady ? "success" : sidecarReady ? "warning" : "default"}>
                {status?.model.reason_code || status?.model.status}
              </Tag>
            </div>
            <Typography.Text type="secondary">
              {status?.model.reason}
            </Typography.Text>
            <Typography.Text>
              {t("nlpConfig.modelId")} {status?.model.model_id || t("nlpConfig.notConfigured")}
            </Typography.Text>
          </Space>
        </Card>

        <Card className={styles.card}>
          <Typography.Title level={5} className={styles.cardTitle}>
            {t("nlpConfig.methodsTitle")}
          </Typography.Title>
          <Typography.Paragraph type="secondary" className={styles.cardDescription}>
            {t("nlpConfig.methodsDescription")}
          </Typography.Paragraph>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {methods.map((method) => (
              <div key={method.key} className={styles.operationBlock}>
                <div className={styles.statusRow}>
                  <Typography.Text strong>{t(`nlpConfig.methods.${method.key}.name`)}</Typography.Text>
                  <Tag color={resolveTagColor(method.status.status)}>
                    {method.status.reasonCode || method.status.status}
                  </Tag>
                </div>
                <Typography.Paragraph className={styles.operationOutput}>
                  {t(`nlpConfig.methods.${method.key}.description`)}
                </Typography.Paragraph>
                <Typography.Text type="secondary">{method.status.reason}</Typography.Text>
                {method.taskKey ? (
                  <Typography.Text type="secondary">
                    {` `}
                    {t("nlpConfig.taskKey")} {method.taskKey}
                  </Typography.Text>
                ) : null}
              </div>
            ))}
          </Space>
        </Card>

        {lastManualSteps.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            message={t("nlpConfig.manualStepsTitle")}
            description={
              <div>
                {lastManualSteps.map((step) => (
                  <div key={step}>{step}</div>
                ))}
              </div>
            }
          />
        ) : null}

        {lastOperations.length > 0 ? (
          <Card className={styles.card}>
            <Typography.Title level={5} className={styles.cardTitle}>
              {t("nlpConfig.operationsTitle")}
            </Typography.Title>
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              {lastOperations.map((operation) => (
                <div key={`${operation.name}-${operation.command}`} className={styles.operationBlock}>
                  <div className={styles.statusRow}>
                    <Typography.Text strong>{operation.name}</Typography.Text>
                    <Tag color={operation.ok ? "success" : "error"}>
                      {operation.ok ? t("nlpConfig.operationOk") : t("nlpConfig.operationFailed")}
                    </Tag>
                  </div>
                  <Typography.Text type="secondary">
                    {operation.command || operation.installer || t("nlpConfig.notConfigured")}
                  </Typography.Text>
                  {operation.output ? (
                    <Typography.Paragraph className={styles.operationOutput}>
                      {operation.output}
                    </Typography.Paragraph>
                  ) : null}
                </div>
              ))}
            </Space>
          </Card>
        ) : null}
      </div>

      <div className={styles.footerButtons}>
        <Button onClick={fetchStatus} disabled={installing || downloadingModel}>
          {t("common.refresh")}
        </Button>
        <Button
          type="primary"
          onClick={handleInstall}
          loading={installing}
          disabled={downloadingModel || sidecarReady || !hanlpProviderActive}
        >
          {sidecarReady ? t("nlpConfig.sidecarReady") : t("nlpConfig.installButton")}
        </Button>
        <Button
          onClick={handleDownloadModel}
          loading={downloadingModel}
          disabled={installing || !sidecarReady || modelReady || !hanlpProviderActive}
        >
          {modelReady ? t("nlpConfig.modelReady") : t("nlpConfig.downloadButton")}
        </Button>
      </div>
    </div>
  );
}

export default NlpPage;