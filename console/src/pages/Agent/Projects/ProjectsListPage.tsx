import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Spin, Tag, Typography, message } from "antd";
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

  return (
    <div className={styles.projectsPage}>
      <div className={styles.pageHeader}>
        <div className={styles.breadcrumbHeader}>
          <span className={styles.breadcrumbParent}>{t("nav.agent", "Agent")}</span>
          <span className={styles.breadcrumbSeparator}>/</span>
          <span className={styles.breadcrumbCurrent}>{t("projects.title", "Projects")}</span>
        </div>
        <div className={styles.headerRight}>
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
        <Empty description={t("projects.noProjects", "No projects in this workspace yet.")} />
      ) : (
        <div className={styles.projectsGrid}>
          {projects.map((project) => (
            <Card
              key={project.id}
              hoverable
              className={styles.projectCard}
              onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}`)}
            >
              <div className={styles.cardHeader}>
                <div className={styles.projectName}>{project.name}</div>
                <div className={styles.cardActions}>
                  <Tag color="blue">{project.status}</Tag>
                  <Button
                    size="small"
                    onClick={(event) => void handleClone(project.id, project.name, event)}
                    loading={cloningId === project.id}
                  >
                    {t("projects.clone", "Clone")}
                  </Button>
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
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
