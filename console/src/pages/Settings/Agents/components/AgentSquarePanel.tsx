import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  message,
} from "antd";
import {
  ReloadOutlined,
  DownloadOutlined,
  PlusOutlined,
  SettingOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { agentsApi } from "../../../../api/modules/agents";
import type {
  AgentSquareItem,
  AgentsSquareSourceSpec,
  AgentsSquareSourcesPayload,
  AgentSquareSourceError,
} from "../../../../api/types/agents";
import { createDefaultAgentsSquareSources } from "../../../../constants/agentsSquare";

interface AgentSquarePanelProps {
  onImported?: () => Promise<void> | void;
}

interface EditableSource extends AgentsSquareSourceSpec {
  _localKey: string;
}

export function AgentSquarePanel({ onImported }: AgentSquarePanelProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<AgentSquareItem[]>([]);
  const [sourceErrors, setSourceErrors] = useState<AgentSquareSourceError[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [sources, setSources] = useState<EditableSource[]>([]);
  const [sourcesVersion, setSourcesVersion] = useState(1);
  const [cacheTtlSec, setCacheTtlSec] = useState(600);
  const [overwriteDefault, setOverwriteDefault] = useState(false);
  const [preserveWorkspaceFiles, setPreserveWorkspaceFiles] = useState(true);
  const [sourceSaving, setSourceSaving] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [validatingKey, setValidatingKey] = useState<string | null>(null);

  const loadSquareItems = async (refresh = false) => {
    setLoading(true);
    try {
      const data = await agentsApi.getSquareItems(refresh);
      setItems(data.items || []);
      setSourceErrors(data.source_errors || []);
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : t("agent.squareLoadFailed", "加载智能体广场失败");
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSquareItems(false);
  }, []);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) {
      return items;
    }
    return items.filter((item) => {
      return [
        item.name,
        item.agent_id,
        item.source_id,
        item.description,
        item.tags?.join(" ") || "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [items, search]);

  const toEditableSource = (item: AgentsSquareSourceSpec, index: number) => ({
    ...item,
    _localKey: `${item.id || "source"}-${index}`,
  });

  const fromEditableSource = (item: EditableSource): AgentsSquareSourceSpec => {
    const { _localKey: _ignored, ...raw } = item;
    return raw;
  };

  const loadSquareSources = async () => {
    setSourceLoading(true);
    try {
      const payload = await agentsApi.getSquareSources();
      setSourcesVersion(payload.version || 1);
      setCacheTtlSec(payload.cache?.ttl_sec ?? 600);
      setOverwriteDefault(payload.install?.overwrite_default ?? false);
      setPreserveWorkspaceFiles(
        payload.install?.preserve_workspace_files ?? true,
      );
      setSources(
        (payload.sources || []).map((item, idx) => toEditableSource(item, idx)),
      );
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : t("agent.squareSourceLoadFailed", "加载来源设置失败");
      message.error(msg);
    } finally {
      setSourceLoading(false);
    }
  };

  const handleOpenSourceModal = async () => {
    setSourceModalOpen(true);
    await loadSquareSources();
  };

  const updateSource = (
    localKey: string,
    patch: Partial<AgentsSquareSourceSpec>,
  ) => {
    setSources((prev) =>
      prev.map((item) =>
        item._localKey === localKey ? { ...item, ...patch } : item,
      ),
    );
  };

  const handleAddSource = () => {
    const nextIdx = sources.length + 1;
    const base = createDefaultAgentsSquareSources()[0];
    const newSource: EditableSource = {
      ...base,
      id: `custom-source-${Date.now()}`,
      name: `custom-source-${nextIdx}`,
      url: "https://github.com/owner/repo",
      enabled: true,
      pinned: false,
      order: nextIdx,
      _localKey: `new-${Date.now()}`,
    };
    setSources((prev) => [...prev, newSource]);
  };

  const handleDeleteSource = (localKey: string) => {
    setSources((prev) => prev.filter((item) => item._localKey !== localKey));
  };

  const handleValidateSource = async (row: EditableSource) => {
    setValidatingKey(row._localKey);
    try {
      const res = await agentsApi.validateSquareSource(fromEditableSource(row));
      updateSource(row._localKey, res.normalized);
      message.success(t("agent.squareSourceValidateOk", "来源校验通过"));
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : t("agent.squareSourceValidateFailed", "来源校验失败");
      message.error(msg);
    } finally {
      setValidatingKey(null);
    }
  };

  const handleResetSources = async () => {
    setSourceSaving(true);
    try {
      const payload = await agentsApi.resetSquareSources();
      setSourcesVersion(payload.version || 1);
      setCacheTtlSec(payload.cache?.ttl_sec ?? 600);
      setOverwriteDefault(payload.install?.overwrite_default ?? false);
      setPreserveWorkspaceFiles(
        payload.install?.preserve_workspace_files ?? true,
      );
      setSources(
        (payload.sources || []).map((item, idx) => toEditableSource(item, idx)),
      );
      message.success(t("agent.squareSourceResetOk", "已恢复默认来源"));
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : t("agent.squareSourceResetFailed", "恢复默认来源失败");
      message.error(msg);
    } finally {
      setSourceSaving(false);
    }
  };

  const handleSaveSources = async () => {
    setSourceSaving(true);
    try {
      const payload: AgentsSquareSourcesPayload = {
        version: sourcesVersion,
        cache: {
          ttl_sec: Number(cacheTtlSec) > 0 ? Number(cacheTtlSec) : 600,
        },
        install: {
          overwrite_default: overwriteDefault,
          preserve_workspace_files: preserveWorkspaceFiles,
        },
        sources: sources.map((item, idx) => ({
          ...fromEditableSource(item),
          order: idx + 1,
        })),
      };
      await agentsApi.updateSquareSources(payload);
      message.success(t("agent.squareSourceSaveOk", "来源设置已保存"));
      await loadSquareItems(true);
      setSourceModalOpen(false);
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : t("agent.squareSourceSaveFailed", "保存来源设置失败");
      message.error(msg);
    } finally {
      setSourceSaving(false);
    }
  };

  const handleImport = async (item: AgentSquareItem) => {
    const key = `${item.source_id}/${item.agent_id}`;
    setImportingKey(key);
    try {
      const imported = await agentsApi.importSquareAgent({
        source_id: item.source_id,
        agent_id: item.agent_id,
      });
      message.success(
        t(
          "agent.squareImportSuccess",
          `导入成功: ${imported.name || imported.id}`,
        ),
      );
      await onImported?.();
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : t("agent.squareImportFailed", "导入智能体失败");
      message.error(msg);
    } finally {
      setImportingKey(null);
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search
          allowClear
          placeholder={t(
            "agent.squareSearchPlaceholder",
            "按名称/ID/来源搜索",
          )}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 300 }}
        />
        <Button
          icon={<ReloadOutlined />}
          onClick={() => void loadSquareItems(true)}
          loading={loading}
        >
          {t("agent.squareRefresh", "刷新广场")}
        </Button>
        <Button icon={<SettingOutlined />} onClick={() => void handleOpenSourceModal()}>
          {t("agent.squareSources", "来源设置")}
        </Button>
      </Space>

      {sourceErrors.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {sourceErrors.map((err) => (
            <Alert
              key={`${err.source_id}-${err.code}`}
              type="warning"
              showIcon
              message={`${err.source_id}: ${err.message}`}
              style={{ marginBottom: 8 }}
            />
          ))}
        </div>
      )}

      <Table
        rowKey={(record) => `${record.source_id}/${record.agent_id}`}
        dataSource={filteredItems}
        loading={loading}
        locale={{
          emptyText: t("agent.squareEmpty", "暂无可导入的智能体"),
        }}
        pagination={{
          pageSize: 10,
          showSizeChanger: false,
        }}
        columns={[
          {
            title: t("agent.name"),
            key: "name",
            render: (_, record) => (
              <div>
                <div style={{ fontWeight: 500 }}>{record.name || record.agent_id}</div>
                {record.description ? (
                  <div style={{ opacity: 0.7, fontSize: 12 }}>
                    {record.description}
                  </div>
                ) : null}
              </div>
            ),
          },
          {
            title: t("agent.id"),
            dataIndex: "agent_id",
            key: "agent_id",
            width: 180,
          },
          {
            title: t("agent.squareSource", "来源"),
            dataIndex: "source_id",
            key: "source_id",
            width: 180,
          },
          {
            title: t("agent.squareVersion", "版本"),
            dataIndex: "version",
            key: "version",
            width: 120,
          },
          {
            title: t("agent.squareTags", "标签"),
            key: "tags",
            render: (_, record) => (
              <Space size={[4, 4]} wrap>
                {(record.tags || []).slice(0, 4).map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </Space>
            ),
          },
          {
            title: t("common.actions"),
            key: "actions",
            width: 120,
            render: (_, record) => {
              const key = `${record.source_id}/${record.agent_id}`;
              return (
                <Button
                  type="link"
                  icon={<DownloadOutlined />}
                  onClick={() => void handleImport(record)}
                  loading={importingKey === key}
                >
                  {t("agent.squareImport", "导入")}
                </Button>
              );
            },
          },
        ]}
      />

      <Modal
        title={t("agent.squareSources", "来源设置")}
        open={sourceModalOpen}
        onCancel={() => setSourceModalOpen(false)}
        width={1100}
        footer={[
          <Button key="add" icon={<PlusOutlined />} onClick={handleAddSource}>
            {t("agent.squareSourceAdd", "新增来源")}
          </Button>,
          <Button key="reset" onClick={() => void handleResetSources()} loading={sourceSaving}>
            {t("agent.squareSourceReset", "恢复默认")}
          </Button>,
          <Button key="cancel" onClick={() => setSourceModalOpen(false)}>
            {t("common.cancel")}
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={sourceSaving}
            onClick={() => void handleSaveSources()}
          >
            {t("common.save")}
          </Button>,
        ]}
      >
        <Space style={{ marginBottom: 12 }} wrap>
          <span>{t("agent.squareCacheTtl", "缓存秒数")}</span>
          <Input
            value={String(cacheTtlSec)}
            onChange={(e) => setCacheTtlSec(Number(e.target.value) || 0)}
            style={{ width: 120 }}
          />
          <span>{t("agent.squareOverwriteDefault", "安装默认覆盖")}</span>
          <Switch checked={overwriteDefault} onChange={setOverwriteDefault} />
          <span>{t("agent.squarePreserveWorkspace", "保留工作区文件")}</span>
          <Switch
            checked={preserveWorkspaceFiles}
            onChange={setPreserveWorkspaceFiles}
          />
        </Space>

        <Table
          rowKey="_localKey"
          dataSource={sources}
          loading={sourceLoading}
          pagination={false}
          scroll={{ x: 1000, y: 420 }}
          columns={[
            {
              title: t("common.enabled", "启用"),
              dataIndex: "enabled",
              width: 80,
              render: (enabled: boolean, row) => (
                <Switch
                  checked={enabled}
                  onChange={(checked) =>
                    updateSource(row._localKey, { enabled: checked })
                  }
                />
              ),
            },
            {
              title: t("agent.id"),
              dataIndex: "id",
              width: 180,
              render: (value: string, row) => (
                <Input
                  value={value}
                  onChange={(e) =>
                    updateSource(row._localKey, { id: e.target.value })
                  }
                />
              ),
            },
            {
              title: t("agent.name"),
              dataIndex: "name",
              width: 180,
              render: (value: string, row) => (
                <Input
                  value={value}
                  onChange={(e) =>
                    updateSource(row._localKey, { name: e.target.value })
                  }
                />
              ),
            },
            {
              title: t("agent.squareSourceUrl", "URL"),
              dataIndex: "url",
              width: 260,
              render: (value: string, row) => (
                <Input
                  value={value}
                  onChange={(e) =>
                    updateSource(row._localKey, { url: e.target.value })
                  }
                />
              ),
            },
            {
              title: t("agent.squareSourceBranch", "分支"),
              dataIndex: "branch",
              width: 120,
              render: (value: string, row) => (
                <Input
                  value={value}
                  onChange={(e) =>
                    updateSource(row._localKey, { branch: e.target.value })
                  }
                />
              ),
            },
            {
              title: t("agent.squareSourcePath", "路径"),
              dataIndex: "path",
              width: 120,
              render: (value: string, row) => (
                <Input
                  value={value}
                  onChange={(e) =>
                    updateSource(row._localKey, { path: e.target.value })
                  }
                />
              ),
            },
            {
              title: t("common.actions"),
              key: "actions",
              width: 140,
              render: (_, row) => (
                <Space>
                  <Button
                    type="text"
                    icon={<CheckCircleOutlined />}
                    loading={validatingKey === row._localKey}
                    onClick={() => void handleValidateSource(row)}
                  />
                  <Popconfirm
                    title={t("agent.squareSourceDeleteConfirm", "确认删除该来源？")}
                    onConfirm={() => handleDeleteSource(row._localKey)}
                    disabled={row.pinned}
                  >
                    <Button
                      type="text"
                      icon={<DeleteOutlined />}
                      disabled={row.pinned}
                    />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Modal>
    </div>
  );
}