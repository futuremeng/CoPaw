import { type MouseEvent, useCallback, useState } from "react";
import { Button, Empty, Modal, Input, Select, Tabs, message } from "@agentscope-ai/design";
import { PlusOutlined } from "@ant-design/icons";
import type { MCPClientInfo } from "../../../api/types";
import { MCPClientCard } from "./components";
import { useMCP } from "./useMCP";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { parseCreateClientsJson } from "./clientConfig";
import styles from "./index.module.less";

type MCPTransport = "streamable_http" | "sse" | "stdio";

const defaultForm = {
  key: "",
  name: "",
  description: "",
  transport: "streamable_http" as MCPTransport,
  url: "",
  command: "",
  args: "",
  env: "",
  cwd: "",
};

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
  const [activeTab, setActiveTab] = useState<"json" | "form">("json");
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

  // Form state
  const [form, setForm] = useState({ ...defaultForm });

  const setField = useCallback(
    <K extends keyof typeof defaultForm>(k: K, v: (typeof defaultForm)[K]) => {
      setForm((prev) => ({ ...prev, [k]: v }));
    },
    [],
  );

  const resetModal = useCallback(() => {
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
    setForm({ ...defaultForm });
    setActiveTab("json");
  }, []);

  const handleToggleEnabled = async (
    client: MCPClientInfo,
    e?: MouseEvent,
  ) => {
    e?.stopPropagation();
    await toggleEnabled(client);
  };

  const handleDelete = async (client: MCPClientInfo, e?: MouseEvent) => {
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

      let allSuccess = true;
      for (const { key, data } of clientsToCreate) {
        const success = await createClient(key, data);
        if (!success) allSuccess = false;
      }

      if (allSuccess) {
        setCreateModalOpen(false);
        resetModal();
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Invalid JSON format";
      message.error(errorMessage);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateFromForm = async () => {
    const key = form.key.trim();
    const name = form.name.trim();
    if (!key) {
      message.error(t("mcp.form.keyRequired"));
      return;
    }
    if (!name) {
      message.error(t("mcp.form.nameRequired"));
      return;
    }

    const isHttp =
      form.transport === "streamable_http" || form.transport === "sse";

    if (isHttp && !form.url.trim()) {
      message.error(t("mcp.form.urlRequired"));
      return;
    }
    if (form.transport === "stdio" && !form.command.trim()) {
      message.error(t("mcp.form.commandRequired"));
      return;
    }

    const args = form.args
      .split(/[\n, ]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const env: Record<string, string> = {};
    form.env
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((line) => {
        const idx = line.indexOf("=");
        if (idx > 0) {
          env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      });

    setIsCreating(true);
    try {
      const success = await createClient(key, {
        name,
        description: form.description,
        transport: form.transport,
        url: isHttp ? form.url.trim() : "",
        command: form.transport === "stdio" ? form.command.trim() : "",
        args,
        env,
        cwd: form.cwd.trim(),
      });
      if (success) {
        setCreateModalOpen(false);
        resetModal();
      }
    } finally {
      setIsCreating(false);
    }
  };

  const isHttpTransport =
    form.transport === "streamable_http" || form.transport === "sse";

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
        <div className={styles.emptyState}>
          <Empty description={t("mcp.emptyState")} />
        </div>
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
        onCancel={() => {
          setCreateModalOpen(false);
          resetModal();
        }}
        footer={
          <div className={styles.modalFooter}>
            <Button
              onClick={() => {
                setCreateModalOpen(false);
                resetModal();
              }}
              style={{ marginRight: 8 }}
              disabled={isCreating}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="primary"
              onClick={() => {
                void (activeTab === "form"
                  ? handleCreateFromForm()
                  : handleCreateClient());
              }}
              loading={isCreating}
              disabled={isCreating}
            >
              {t("common.create")}
            </Button>
          </div>
        }
        width={800}
      >
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as "json" | "form")}
          items={[
            {
              key: "json",
              label: t("mcp.tab.json"),
              children: (
                <div>
                  <div className={styles.importHint}>
                    <p className={styles.importHintTitle}>
                      {t("mcp.formatSupport")}:
                    </p>
                    <ul className={styles.importHintList}>
                      <li>
                        {t("mcp.standardFormat")}:{" "}
                        <code>{`{ "mcpServers": { "key": {...} } }`}</code>
                      </li>
                      <li>
                        {t("mcp.directFormat")}:{" "}
                        <code>{`{ "key": {...} }`}</code>
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
                </div>
              ),
            },
            {
              key: "form",
              label: t("mcp.tab.form"),
              children: (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 10 }}
                >
                  {/* Key + Name */}
                  <div style={rowStyle}>
                    <div style={fieldStyle}>
                      <label style={labelStyle}>
                        {t("mcp.form.key")}
                        <span style={{ color: "#c0392b" }}> *</span>
                      </label>
                      <Input
                        placeholder={t("mcp.form.keyPlaceholder")}
                        value={form.key}
                        onChange={(e) => setField("key", e.target.value)}
                      />
                    </div>
                    <div style={fieldStyle}>
                      <label style={labelStyle}>
                        {t("mcp.form.name")}
                        <span style={{ color: "#c0392b" }}> *</span>
                      </label>
                      <Input
                        placeholder={t("mcp.form.namePlaceholder")}
                        value={form.name}
                        onChange={(e) => setField("name", e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Transport */}
                  <div>
                    <label style={labelStyle}>{t("mcp.form.transport")}</label>
                    <Select
                      value={form.transport}
                      onChange={(v) => setField("transport", v as MCPTransport)}
                      style={{ width: "100%" }}
                      options={[
                        {
                          label: "Streamable HTTP",
                          value: "streamable_http",
                        },
                        { label: "SSE", value: "sse" },
                        { label: "Stdio", value: "stdio" },
                      ]}
                    />
                  </div>

                  {/* URL (HTTP/SSE) or Command (stdio) */}
                  {isHttpTransport ? (
                    <div>
                      <label style={labelStyle}>
                        {t("mcp.form.url")}
                        <span style={{ color: "#c0392b" }}> *</span>
                      </label>
                      <Input
                        placeholder="https://mcp.example.com/mcp"
                        value={form.url}
                        onChange={(e) => setField("url", e.target.value)}
                      />
                    </div>
                  ) : (
                    <>
                      <div>
                        <label style={labelStyle}>
                          {t("mcp.form.command")}
                          <span style={{ color: "#c0392b" }}> *</span>
                        </label>
                        <Input
                          placeholder="npx"
                          value={form.command}
                          onChange={(e) => setField("command", e.target.value)}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>{t("mcp.form.args")}</label>
                        <Input
                          placeholder="-y @example/mcp-server"
                          value={form.args}
                          onChange={(e) => setField("args", e.target.value)}
                        />
                      </div>
                    </>
                  )}

                  {/* Description */}
                  <div>
                    <label style={labelStyle}>
                      {t("mcp.form.description")}
                    </label>
                    <Input
                      placeholder={t("mcp.form.descriptionPlaceholder")}
                      value={form.description}
                      onChange={(e) => setField("description", e.target.value)}
                    />
                  </div>

                  {/* Env (only for stdio) */}
                  {form.transport === "stdio" && (
                    <div>
                      <label style={labelStyle}>{t("mcp.form.env")}</label>
                      <Input.TextArea
                        placeholder={t("mcp.form.envPlaceholder")}
                        value={form.env}
                        onChange={(e) => setField("env", e.target.value)}
                        autoSize={{ minRows: 2, maxRows: 5 }}
                      />
                    </div>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Modal>
    </div>
  );
}

const rowStyle = {
  display: "flex",
  gap: 12,
} as const;

const fieldStyle = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: 4,
} as const;

const labelStyle = {
  fontSize: 12,
  color: "#555",
  fontWeight: 500,
} as const;

export default MCPPage;
