import { Button } from "@agentscope-ai/design";
import { Alert, Card, Space, Spin, Tag, Typography } from "antd";
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
  } = useNlp();

  const taskStates = status?.tasks ?? {};

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