import { Table, Button, Space, Popconfirm, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { EditOutlined, DeleteOutlined, RobotOutlined } from "@ant-design/icons";
import { EyeOff, Eye } from "lucide-react";
import type { AgentSummary } from "../../../../api/types/agents";
import { useTheme } from "../../../../contexts/ThemeContext";
import { getAgentDisplayName } from "../../../../utils/agentDisplayName";
import { SortableAgentRow, DragHandle } from "./SortableAgentRow";
import { providerIcon } from "../../Models/components/providerIcon";
import styles from "../index.module.less";

interface AgentTableProps {
  agents: AgentSummary[];
  loading: boolean;
  reordering: boolean;
  onEdit: (agent: AgentSummary) => void;
  onDelete: (agentId: string) => void;
  onToggle: (agentId: string, currentEnabled: boolean) => void;
  onReorder: (activeId: string, overId: string) => void;
}

export function AgentTable({
  agents,
  loading,
  reordering,
  onEdit,
  onDelete,
  onToggle,
  onReorder,
}: AgentTableProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isProtectedAgent = (record: AgentSummary) =>
    record.id === "default" || record.system_protected;
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  );

  const disabledStyle: React.CSSProperties = isDark
    ? { color: "rgba(255,255,255,0.35)", opacity: 1 }
    : {};

  const iconStyle: React.CSSProperties = isDark
    ? { color: "rgba(255,255,255,0.85)" }
    : {};

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    onReorder(String(active.id), String(over.id));
  };

  const columns: ColumnsType<AgentSummary> = [
    {
      title: "",
      key: "sort",
      width: 56,
      align: "center",
      render: () => (
        <Tooltip title={t("agent.dragHandleTooltip")}>
          <span>
            <DragHandle disabled={reordering || loading} />
          </span>
        </Tooltip>
      ),
    },
    {
      title: t("agent.name"),
      dataIndex: "name",
      key: "name",
      width: 300,
      render: (_text: string, record: AgentSummary) => (
        <Space>
          <RobotOutlined
            style={{
              fontSize: 16,
              opacity: record.enabled ? 1 : 0.5,
            }}
          />
          <span style={{ opacity: record.enabled ? 1 : 0.5 }}>
            {getAgentDisplayName(record, t)}
          </span>
          {!record.enabled && <Tag color="error">{t("agent.disabled")}</Tag>}
        </Space>
      ),
    },
    {
      title: t("agent.id"),
      dataIndex: "id",
      key: "id",
    },
    {
      title: t("agent.type", "类型"),
      key: "agentType",
      width: 120,
      render: (_: any, record: AgentSummary) => (
        <Tag color={record.is_builtin ? "processing" : "default"}>
          {record.is_builtin
            ? t("agent.typeBuiltin", "内建")
            : t("agent.typeCustom", "自定义")}
        </Tag>
      ),
    },
    {
      title: t("agent.feature", "特性"),
      key: "feature",
      width: 140,
      render: (_: any, record: AgentSummary) => {
        if (!record.is_builtin) {
          return <span style={{ opacity: 0.6 }}>-</span>;
        }

        return record.builtin_label ? (
          <Tag color="cyan">{record.builtin_label}</Tag>
        ) : (
          <span style={{ opacity: 0.6 }}>-</span>
        );
      },
    },
    {
      title: t("agent.description"),
      dataIndex: "description",
      key: "description",
      ellipsis: true,
    },
    {
      title: t("agent.workspace"),
      dataIndex: "workspace_dir",
      key: "workspace_dir",
      ellipsis: true,
    },
    {
      title: t("agent.modelColumn"),
      key: "active_model",
      width: 260,
      ellipsis: true,
      render: (_: any, record: AgentSummary) => {
        if (!record.active_model) {
          return (
            <span style={{ opacity: 0.45 }}>{t("agent.modelPlaceholder")}</span>
          );
        }
        return (
          <Space size={6}>
            <img
              src={providerIcon(record.active_model.provider_id)}
              alt=""
              style={{ width: 16, height: 16 }}
            />
            <Tooltip title={record.active_model.model}>
              <span>{record.active_model.model}</span>
            </Tooltip>
          </Space>
        );
      },
    },
    {
      title: t("common.actions"),
      key: "actions",
      render: (_: any, record: AgentSummary) => {
        const isProtected = isProtectedAgent(record);
        const blockedReason = record.system_protected
          ? t("agent.systemAgentProtected", "系统内建智能体不可在此处修改")
          : undefined;

        return (
          <Space>
            <Button
              type="text"
              size="middle"
              icon={<EditOutlined />}
              onClick={() => onEdit(record)}
              disabled={isProtected}
              style={isProtected ? disabledStyle : iconStyle}
              title={
                blockedReason ||
                (record.id === "default"
                  ? t("agent.defaultNotEditable")
                  : undefined)
              }
            />
            <Popconfirm
              title={
                record.enabled
                  ? t("agent.disableConfirm")
                  : t("agent.enableConfirm")
              }
              description={
                record.enabled
                  ? t("agent.disableConfirmDesc")
                  : t("agent.enableConfirmDesc")
              }
              onConfirm={() => onToggle(record.id, record.enabled)}
              disabled={isProtected}
              okText={t("common.confirm")}
              cancelText={t("common.cancel")}
            >
              <Button
                type="text"
                size="middle"
                icon={record.enabled ? <EyeOff size={14} /> : <Eye size={14} />}
                disabled={isProtected}
                style={isProtected ? disabledStyle : iconStyle}
                title={
                  blockedReason ||
                  (record.id === "default"
                    ? t("agent.defaultNotDisablable")
                    : undefined)
                }
              />
            </Popconfirm>
            <Popconfirm
              title={t("agent.deleteConfirm")}
              description={t("agent.deleteConfirmDesc")}
              onConfirm={() => onDelete(record.id)}
              disabled={isProtected}
              okText={t("common.confirm")}
              cancelText={t("common.cancel")}
            >
              <Button
                type="link"
                size="middle"
                danger
                icon={<DeleteOutlined />}
                disabled={isProtected}
                style={isProtected ? disabledStyle : undefined}
                title={
                  blockedReason ||
                  (record.id === "default"
                    ? t("agent.defaultNotDeletable")
                    : undefined)
                }
              />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div className={styles.tableCard}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={agents.map((agent) => agent.id)}
          strategy={verticalListSortingStrategy}
        >
          <Table
            dataSource={agents}
            columns={columns}
            loading={loading}
            rowKey="id"
            components={{
              body: {
                row: SortableAgentRow,
              },
            }}
            pagination={false}
          />
        </SortableContext>
      </DndContext>
    </div>
  );
}
