import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Tag,
  Typography,
  message,
} from "antd";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { AgentProfileConfig, AgentProjectSummary } from "../../../api/types/agents";
import { agentsApi } from "../../../api/modules/agents";
import { useAgentStore } from "../../../stores/agentStore";
import styles from "./projectsList.module.less";

const { Text } = Typography;

type ProjectSortField = "updated" | "created";
type ProjectSortOrder = "asc" | "desc";

function toTimestamp(value: string | undefined): number {
  const parsed = Date.parse(value || "");
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareProjects(
  left: AgentProjectSummary,
  right: AgentProjectSummary,
  sortField: ProjectSortField,
  sortOrder: ProjectSortOrder,
): number {
  const direction = sortOrder === "asc" ? 1 : -1;
  const leftTime = sortField === "created"
    ? toTimestamp(left.created_time)
    : toTimestamp(left.updated_time);
  const rightTime = sortField === "created"
    ? toTimestamp(right.created_time)
    : toTimestamp(right.updated_time);

  if (leftTime !== rightTime) {
    return (leftTime - rightTime) * direction;
  }

  const nameCompare = left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  if (nameCompare !== 0) {
    return nameCompare * direction;
  }
  return left.id.localeCompare(right.id, undefined, {
    numeric: true,
    sensitivity: "base",
  }) * direction;
}

export default function ProjectsListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { selectedAgent } = useAgentStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cloningId, setCloningId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [deleteConfirmOpenId, setDeleteConfirmOpenId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sortField, setSortField] = useState<ProjectSortField>("updated");
  const [sortOrder, setSortOrder] = useState<ProjectSortOrder>("desc");
  const [currentAgent, setCurrentAgent] = useState<AgentProfileConfig | undefined>();
  const [projects, setProjects] = useState<AgentProjectSummary[]>([]);
  const [createForm] = Form.useForm<{
    id?: string;
    name: string;
    description?: string;
    tags?: string;
  }>();

  const loadPageData = useCallback(async () => {
    if (!selectedAgent) {
      setCurrentAgent(undefined);
      setProjects([]);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [agent, projectList] = await Promise.all([
        agentsApi.getAgent(selectedAgent),
        agentsApi.listAgentProjects(selectedAgent),
      ]);
      setCurrentAgent(agent);
      setProjects(projectList);
    } catch (err) {
      console.error("failed to load project page data", err);
      setError(
        t("projects.loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [selectedAgent, t]);

  useEffect(() => {
    void loadPageData();
  }, [loadPageData]);

  const sortedProjects = useMemo(
    () => projects.slice().sort((left, right) => (
      compareProjects(left, right, sortField, sortOrder)
    )),
    [projects, sortField, sortOrder],
  );

  const handleClone = useCallback(async (
    projectId: string,
    projectName: string,
    event: React.MouseEvent,
  ) => {
    event.stopPropagation();
    if (!currentAgent) {
      return;
    }

    setCloningId(projectId);
    try {
      const cloned = await agentsApi.cloneProject(currentAgent.id, projectId, {
        target_name: `${projectName} (Clone)`,
      });
      message.success(
        t("projects.cloneSuccess", {
          name: cloned.name || cloned.id,
        }),
      );
      await loadPageData();
    } catch (err) {
      console.error("failed to clone project", err);
      message.error(t("projects.cloneFailed"));
    } finally {
      setCloningId("");
    }
  }, [currentAgent, loadPageData, t]);

  const handleOpenCreate = useCallback(() => {
    createForm.setFieldsValue({
      id: "",
      name: "",
      description: "",
      tags: "",
    });
    setCreateOpen(true);
  }, [createForm]);

  const handleOpenWorkspace = useCallback((projectId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    navigate(`/projects/${encodeURIComponent(projectId)}`);
  }, [navigate]);

  const handleDelete = useCallback(async (
    projectId: string,
    projectName: string,
    event?: React.MouseEvent<HTMLElement>,
  ) => {
    event?.stopPropagation();
    if (!currentAgent) {
      return;
    }

    setDeletingId(projectId);
    try {
      await agentsApi.deleteProject(currentAgent.id, projectId);
      message.success(
        t("projects.deleteSuccess", {
          name: projectName || projectId,
        }),
      );
      await loadPageData();
    } catch (err) {
      console.error("failed to delete project", err);
      message.error(t("projects.deleteFailed"));
    } finally {
      setDeletingId("");
    }
  }, [currentAgent, loadPageData, t]);

  const handleCreateProject = useCallback(async () => {
    if (!currentAgent) {
      return;
    }
    try {
      const values = await createForm.validateFields();
      setCreating(true);
      const tags = (values.tags || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      const created = await agentsApi.createProject(currentAgent.id, {
        id: values.id?.trim() || undefined,
        name: values.name.trim(),
        description: values.description?.trim() || "",
        status: "active",
        data_dir: "output",
        tags,
      });
      message.success(
        t("projects.createSuccess", {
          name: created.name || created.id,
        }),
      );
      setCreateOpen(false);
      navigate(`/projects/${encodeURIComponent(created.id)}`);
    } catch (err) {
      if ((err as { errorFields?: unknown[] })?.errorFields) {
        return;
      }
      console.error("failed to create project", err);
      message.error(t("projects.createFailed"));
    } finally {
      setCreating(false);
    }
  }, [createForm, currentAgent, navigate, t]);

  return (
    <div className={styles.projectsPage}>
      <div className={styles.pageHeader}>
        <div className={styles.breadcrumbHeader}>
          <span className={styles.breadcrumbParent}>{t("nav.agent")}</span>
          <span className={styles.breadcrumbSeparator}>/</span>
          <span className={styles.breadcrumbCurrent}>{t("projects.title")}</span>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.sortControls}>
            <Select
              size="small"
              value={sortField}
              className={styles.sortSelect}
              aria-label={t("projects.sortField")}
              onChange={(value) => setSortField(value as ProjectSortField)}
              options={[
                {
                  label: t("projects.sort.updated"),
                  value: "updated",
                },
                {
                  label: t("projects.sort.created"),
                  value: "created",
                },
              ]}
            />
            <Button
              size="small"
              onClick={() => {
                setSortOrder((current) => (current === "desc" ? "asc" : "desc"));
              }}
              aria-label={t("projects.sortOrder")}
            >
              {sortOrder === "desc"
                ? t("projects.sort.desc")
                : t("projects.sort.asc")}
            </Button>
          </div>
          <Button size="small" type="primary" onClick={handleOpenCreate}>
            {t("projects.create")}
          </Button>
          <Button size="small" onClick={() => void loadPageData()} loading={loading}>
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      {error && <Alert type="error" showIcon message={error} className={styles.inlineAlert} />}

      <div className={styles.workspaceInfo}>
        <p className={styles.workspacePath}>
          {t("projects.workspacePath")}: {" "}
          {currentAgent?.workspace_dir || (
            loading
              ? t("common.loading")
              : t("projects.noAgent")
          )}
        </p>
      </div>

      {loading && !currentAgent ? (
        <div className={styles.centerState}>
          <Spin />
        </div>
      ) : !currentAgent ? (
        <Empty description={t("projects.noAgent")} />
      ) : sortedProjects.length === 0 ? (
        <Empty description={t("projects.noProjects")}
        >
          <Button type="primary" onClick={handleOpenCreate}>
            {t("projects.create")}
          </Button>
        </Empty>
      ) : (
        <div className={styles.projectsGrid}>
          {sortedProjects.map((project) => (
            <Card
              key={project.id}
              hoverable
              className={styles.projectCard}
              data-testid="project-card"
              onClick={() => {
                if (deleteConfirmOpenId === project.id) {
                  return;
                }
                navigate(`/projects/${encodeURIComponent(project.id)}`);
              }}
              onMouseEnter={() => setHoverKey(project.id)}
              onMouseLeave={() => setHoverKey(null)}
            >
              <div className={styles.cardHeader}>
                <div className={styles.projectName} data-testid="project-name">
                  {project.name}
                </div>
                <div className={styles.cardActions}>
                  <Tag color="blue">{project.status}</Tag>
                </div>
              </div>
              <Text className={styles.projectDescription}>
                {project.description || t("projects.noDescription")}
              </Text>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>ID</span>
                <span className={styles.metaValue}>{project.id}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>{t("common.updated")}</span>
                <span className={styles.metaValue}>{project.updated_time}</span>
              </div>

              {(hoverKey === project.id || deleteConfirmOpenId === project.id) && (
                <div className={styles.cardFooter}>
                  <Button
                    size="small"
                    type="primary"
                    className={styles.openButton}
                    onClick={(event) => handleOpenWorkspace(project.id, event)}
                  >
                    {t("projects.open")}
                  </Button>
                  <Button
                    size="small"
                    className={styles.cloneButton}
                    onClick={(event) => void handleClone(project.id, project.name, event)}
                    loading={cloningId === project.id}
                  >
                    {t("projects.clone")}
                  </Button>
                  <Popconfirm
                    open={deleteConfirmOpenId === project.id}
                    title={t(
                      "projects.deleteConfirmTitleWithName",
                      { name: project.name || project.id },
                    )}
                    description={t(
                      "projects.deleteConfirmDescription",
                      { name: project.name || project.id },
                    )}
                    okText={t("common.delete")}
                    cancelText={t("common.cancel")}
                    okButtonProps={{ danger: true, loading: deletingId === project.id }}
                    onOpenChange={(open) => {
                      setDeleteConfirmOpenId(open ? project.id : null);
                    }}
                    onConfirm={(event) => {
                      event?.stopPropagation?.();
                      setDeleteConfirmOpenId(null);
                      void handleDelete(project.id, project.name, event);
                    }}
                    onCancel={(event) => {
                      event?.stopPropagation?.();
                      setDeleteConfirmOpenId(null);
                    }}
                  >
                    <Button
                      size="small"
                      danger
                      className={styles.deleteButton}
                      loading={deletingId === project.id}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {t("common.delete")}
                    </Button>
                  </Popconfirm>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal
        title={t("projects.create")}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void handleCreateProject()}
        confirmLoading={creating}
        okText={t("common.create")}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            label={t("projects.fields.name")}
            name="name"
            rules={[{ required: true, message: t("projects.validation.nameRequired") }]}
          >
            <Input placeholder={t("projects.fields.namePlaceholder")} maxLength={120} />
          </Form.Item>
          <Form.Item
            label={t("projects.fields.id")}
            name="id"
          >
            <Input placeholder={t("projects.fields.idPlaceholder")} maxLength={120} />
          </Form.Item>
          <Form.Item
            label={t("projects.fields.description")}
            name="description"
          >
            <Input.TextArea
              placeholder={t("projects.fields.descriptionPlaceholder")}
              rows={3}
              maxLength={500}
              showCount
            />
          </Form.Item>
          <Form.Item
            label={t("projects.fields.tags")}
            name="tags"
          >
            <Input placeholder={t("projects.fields.tagsPlaceholder")} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
