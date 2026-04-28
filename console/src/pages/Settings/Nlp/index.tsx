import { Button } from "@agentscope-ai/design";
import { Alert, Card, Space, Spin, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { useNlp } from "./useNlp";
import styles from "./index.module.less";

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
        message={`Provider: ${provider || "hanlp"}`}
        description={
          hanlpProviderActive
            ? "HanLP provider is active."
            : "Current provider is not HanLP; HanLP install/model actions are disabled."
        }
      />

      {status?.sidecar.reason_code === "HANLP2_FULL_INSTALL_REQUIRED" ? (
        <Alert
          type="warning"
          showIcon
          message="HanLP full package is required"
          description="Install with pip install 'hanlp[full]' in a dedicated Python environment, then refresh status."
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