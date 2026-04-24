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
  Spin,
  Tag,
  Typography,
  message,
} from "antd";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { AgentSummary } from "../../../api/types/agents";
import { agentsApi } from "../../../api/modules/agents";
import { useAgentStore } from "../../../stores/agentStore";
import styles from "./projectsList.module.less";

const { Text } = Typography;

function getCurrentAgent(
  agents: AgentSummary[],
  selectedAgent: string,
): AgentSummary | undefined {
  return agents.find((agent) => agent.id === selectedAgent);
}

export default function ProjectsListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { selectedAgent, agents, setAgents } = useAgentStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cloningId, setCloningId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [deleteConfirmOpenId, setDeleteConfirmOpenId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm] = Form.useForm<{
    id?: string;
    name: string;
    description?: string;
    tags?: string;
  }>();

  const currentAgent = useMemo(
    () => getCurrentAgent(agents, selectedAgent),
    [agents, selectedAgent],
  );

  const projects = useMemo(
    () => currentAgent?.projects ?? [],
    [currentAgent?.projects],
  );

  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await agentsApi.listAgents();
      setAgents(data.agents);
    } catch (err) {
      console.error("failed to load project list", err);
      setError(
        t(
          "projects.loadFailed",
          "Failed to load projects for the current agent.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [setAgents, t]);

  useEffect(() => {
    if (!currentAgent) {
      void loadAgents();
    }
  }, [currentAgent, loadAgents]);

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
        t("projects.cloneSuccess", "Project cloned: {{name}}", {
          name: cloned.name || cloned.id,
        }),
      );
      await loadAgents();
    } catch (err) {
      console.error("failed to clone project", err);
      message.error(t("projects.cloneFailed", "Failed to clone project."));
    } finally {
      setCloningId("");
    }
  }, [currentAgent, loadAgents, t]);

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
        t("projects.deleteSuccess", "Project deleted: {{name}}", {
          name: projectName || projectId,
        }),
      );
      await loadAgents();
    } catch (err) {
      console.error("failed to delete project", err);
      message.error(t("projects.deleteFailed", "Failed to delete project."));
    } finally {
      setDeletingId("");
    }
  }, [currentAgent, loadAgents, t]);

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
        data_dir: ".data",
        tags,
      });
      message.success(
        t("projects.createSuccess", "Project created: {{name}}", {
          name: created.name || created.id,
        }),
      );
      setCreateOpen(false);
      await loadAgents();
      navigate(`/projects/${encodeURIComponent(created.id)}`);
    } catch (err) {
      if ((err as { errorFields?: unknown[] })?.errorFields) {
        return;
      }
      console.error("failed to create project", err);
      message.error(t("projects.createFailed", "Failed to create project."));
    } finally {
      setCreating(false);
    }
  }, [createForm, currentAgent, loadAgents, navigate, t]);

  return (
    <div className={styles.projectsPage}>
      <div className={styles.pageHeader}>
        <div className={styles.breadcrumbHeader}>
          <span className={styles.breadcrumbParent}>{t("nav.agent", "Agent")}</span>
          <span className={styles.breadcrumbSeparator}>/</span>
          <span className={styles.breadcrumbCurrent}>{t("projects.title", "Projects")}</span>
        </div>
        <div className={styles.headerRight}>
          <Button size="small" type="primary" onClick={handleOpenCreate}>
            {t("projects.create", "New Project")}
          </Button>
          <Button size="small" onClick={() => void loadAgents()} loading={loading}>
            {t("common.refresh", "Refresh")}
          </Button>
        </div>
      </div>

      {error && <Alert type="error" showIcon message={error} className={styles.inlineAlert} />}

      <div className={styles.workspaceInfo}>
        <p className={styles.workspacePath}>
          {t("projects.workspacePath", "Workspace Path")}: {" "}
          {currentAgent?.workspace_dir ||
            t("projects.noAgent", "No agent is currently available.")}
        </p>
      </div>

      {loading && !currentAgent ? (
        <div className={styles.centerState}>
          <Spin />
        </div>
      ) : !currentAgent ? (
        <Empty description={t("projects.noAgent", "No agent is currently available.")} />
      ) : projects.length === 0 ? (
        <Empty description={t("projects.noProjects", "No projects in this workspace yet.")}
        >
          <Button type="primary" onClick={handleOpenCreate}>
            {t("projects.create", "New Project")}
          </Button>
        </Empty>
      ) : (
        <div className={styles.projectsGrid}>
          {projects.map((project) => (
            <Card
              key={project.id}
              hoverable
              className={styles.projectCard}
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
                <div className={styles.projectName}>{project.name}</div>
                <div className={styles.cardActions}>
                  <Tag color="blue">{project.status}</Tag>
                </div>
              </div>
              <Text className={styles.projectDescription}>
                {project.description || t("projects.noDescription", "No description")}
              </Text>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>ID</span>
                <span className={styles.metaValue}>{project.id}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>{t("common.updated", "Updated")}</span>
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
                    {t("projects.open", "Open")}
                  </Button>
                  <Button
                    size="small"
                    className={styles.cloneButton}
                    onClick={(event) => void handleClone(project.id, project.name, event)}
                    loading={cloningId === project.id}
                  >
                    {t("projects.clone", "Clone")}
                  </Button>
                  <Popconfirm
                    open={deleteConfirmOpenId === project.id}
                    title={t(
                      "projects.deleteConfirmTitleWithName",
                      "Delete project {{name}}?",
                      { name: project.name || project.id },
                    )}
                    description={t(
                      "projects.deleteConfirmDescription",
                      "This action is irreversible and will permanently delete {{name}} and all project files.",
                      { name: project.name || project.id },
                    )}
                    okText={t("common.delete", "Delete")}
                    cancelText={t("common.cancel", "Cancel")}
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
                      {t("common.delete", "Delete")}
                    </Button>
                  </Popconfirm>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal
        title={t("projects.create", "New Project")}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void handleCreateProject()}
        confirmLoading={creating}
        okText={t("common.create", "Create")}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            label={t("projects.fields.name", "Name")}
            name="name"
            rules={[{ required: true, message: t("projects.validation.nameRequired", "Project name is required") }]}
          >
            <Input placeholder={t("projects.fields.namePlaceholder", "My new project")} maxLength={120} />
          </Form.Item>
          <Form.Item
            label={t("projects.fields.id", "ID (optional)")}
            name="id"
          >
            <Input placeholder={t("projects.fields.idPlaceholder", "project-my-topic")} maxLength={120} />
          </Form.Item>
          <Form.Item
            label={t("projects.fields.description", "Description")}
            name="description"
          >
            <Input.TextArea
              placeholder={t("projects.fields.descriptionPlaceholder", "Short summary of this project")}
              rows={3}
              maxLength={500}
              showCount
            />
          </Form.Item>
          <Form.Item
            label={t("projects.fields.tags", "Tags (comma separated)")}
            name="tags"
          >
            <Input placeholder={t("projects.fields.tagsPlaceholder", "demo, draft")} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
