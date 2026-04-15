import { useState } from "react";
import { Button, Empty, Modal, Input, message } from "@agentscope-ai/design";
import { PlusOutlined } from "@ant-design/icons";
import type { MCPClientInfo } from "../../../api/types";
import { MCPClientCard } from "./components";
import { useMCP } from "./useMCP";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { parseCreateClientsJson } from "./clientConfig";
import styles from "./index.module.less";

function MCPPage() {
  const { t } = useTranslation();
  const {
    clients,
    loading,
    refreshStatuses,
    queuedRefreshKeys,
    refreshingKeys,
    toggleEnabled,
    deleteClient,
    createClient,
    updateClient,
  } = useMCP();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const probingCount = queuedRefreshKeys.length + refreshingKeys.length;
  const hasEnabledClients = clients.some((client) => client.enabled);
  const [newClientJson, setNewClientJson] = useState(`{
  "mcpServers": {
    "example-client": {
      "command": "npx",
      "args": ["-y", "@example/mcp-server"],
      "env": {
        "API_KEY": "<YOUR_API_KEY>"
      }
    }
  }
}`);

  const handleToggleEnabled = async (
    client: MCPClientInfo,
    e?: React.MouseEvent,
  ) => {
    e?.stopPropagation();
    await toggleEnabled(client);
  };

  const handleDelete = async (client: MCPClientInfo, e?: React.MouseEvent) => {
    e?.stopPropagation();
    await deleteClient(client);
  };

  const handleProbeStatuses = async () => {
    if (!hasEnabledClients) {
      message.info(t("mcp.noEnabledClients"));
      return;
    }
    await refreshStatuses();
    message.success(t("mcp.probeDone"));
  };

  const handleCreateClient = async () => {
    setIsCreating(true);
    try {
      const clientsToCreate = parseCreateClientsJson(newClientJson);

      // Create all clients
      let allSuccess = true;
      for (const { key, data } of clientsToCreate) {
        const success = await createClient(key, data);
        if (!success) allSuccess = false;
      }

      if (allSuccess) {
        setCreateModalOpen(false);
        setNewClientJson(`{
  "mcpServers": {
    "example-client": {
      "command": "npx",
      "args": ["-y", "@example/mcp-server"],
      "env": {
        "API_KEY": "<YOUR_API_KEY>"
      }
    }
  }
}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Invalid JSON format";
      message.error(errorMessage);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className={styles.mcpPage}>
      <PageHeader
        items={[{ title: t("nav.agent") }, { title: t("mcp.title") }]}
        extra={
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              onClick={() => {
                void handleProbeStatuses();
              }}
              loading={probingCount > 0}
              disabled={loading || !hasEnabledClients}
            >
              {probingCount > 0 ? t("mcp.probing") : t("mcp.probeStatus")}
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateModalOpen(true)}
            >
              {t("mcp.create")}
            </Button>
          </div>
        }
      />

      {loading ? (
        <div className={styles.loading}>
          <p>{t("common.loading")}</p>
        </div>
      ) : clients.length === 0 ? (
        <Empty description={t("mcp.emptyState")} />
      ) : (
        <div className={styles.mcpGrid}>
          {clients.map((client) => (
            <MCPClientCard
              key={client.key}
              client={client}
              onToggle={handleToggleEnabled}
              onDelete={handleDelete}
              onUpdate={updateClient}
              isRefreshing={refreshingKeys.includes(client.key)}
              isQueued={queuedRefreshKeys.includes(client.key)}
            />
          ))}
        </div>
      )}

      <Modal
        title={t("mcp.create")}
        open={createModalOpen}
        onCancel={() => setCreateModalOpen(false)}
        footer={
          <div className={styles.modalFooter}>
            <Button
              onClick={() => setCreateModalOpen(false)}
              style={{ marginRight: 8 }}
              disabled={isCreating}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="primary"
              onClick={handleCreateClient}
              loading={isCreating}
              disabled={isCreating}
            >
              {t("common.create")}
            </Button>
          </div>
        }
        width={800}
      >
        <div className={styles.importHint}>
          <p className={styles.importHintTitle}>{t("mcp.formatSupport")}:</p>
          <ul className={styles.importHintList}>
            <li>
              {t("mcp.standardFormat")}:{" "}
              <code>{`{ "mcpServers": { "key": {...} } }`}</code>
            </li>
            <li>
              {t("mcp.directFormat")}: <code>{`{ "key": {...} }`}</code>
            </li>
            <li>
              {t("mcp.singleFormat")}:{" "}
              <code>{`{ "key": "...", "name": "...", "command": "..." }`}</code>
            </li>
          </ul>
        </div>
        <Input.TextArea
          value={newClientJson}
          onChange={(e) => setNewClientJson(e.target.value)}
          autoSize={{ minRows: 15, maxRows: 25 }}
          className={styles.jsonTextArea}
        />
      </Modal>
    </div>
  );
}

export default MCPPage;
