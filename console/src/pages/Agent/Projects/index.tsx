import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Spin, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { agentsApi } from "../../../api/modules/agents";
import type {
  AgentProjectFileInfo,
  AgentSummary,
} from "../../../api/types/agents";
import { useAgentStore } from "../../../stores/agentStore";
import styles from "./index.module.less";

const { Title, Text } = Typography;

function getCurrentAgent(
  agents: AgentSummary[],
  selectedAgent: string,
): AgentSummary | undefined {
  return agents.find((agent) => agent.id === selectedAgent);
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ProjectsPage() {
  const { t } = useTranslation();
  const { selectedAgent, agents, setAgents } = useAgentStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectFiles, setProjectFiles] = useState<AgentProjectFileInfo[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [filesLoading, setFilesLoading] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);

  const currentAgent = useMemo(
    () => getCurrentAgent(agents, selectedAgent),
    [agents, selectedAgent],
  );

  const projects = useMemo(
    () => currentAgent?.projects ?? [],
    [currentAgent?.projects],
  );
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId],
  );

  const selectedFile = useMemo(
    () => projectFiles.find((file) => file.path === selectedFilePath),
    [projectFiles, selectedFilePath],
  );

  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await agentsApi.listAgents();
      setAgents(data.agents);
    } catch (err) {
      console.error("failed to load agent projects", err);
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

  const loadProjectFiles = useCallback(async (agentId: string, projectId: string) => {
    setFilesLoading(true);
    setSelectedFilePath("");
    setFileContent("");
    try {
      const files = await agentsApi.listProjectFiles(agentId, projectId);
      setProjectFiles(files);
      if (files.length > 0) {
        setSelectedFilePath(files[0].path);
      }
    } catch (err) {
      console.error("failed to load project files", err);
      setProjectFiles([]);
      setError(
        t("projects.loadFilesFailed", "Failed to load files for this project."),
      );
    } finally {
      setFilesLoading(false);
    }
  }, [t]);

  const loadFileContent = useCallback(async (
    agentId: string,
    projectId: string,
    filePath: string,
  ) => {
    setContentLoading(true);
    setFileContent("");
    try {
      const data = await agentsApi.readProjectFile(agentId, projectId, filePath);
      setFileContent(data.content);
    } catch (err) {
      console.error("failed to load project file content", err);
      setFileContent(
        t(
          "projects.previewLoadFailed",
          "Unable to preview this file. It might be binary or inaccessible.",
        ),
      );
    } finally {
      setContentLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!currentAgent) {
      void loadAgents();
    }
  }, [currentAgent, loadAgents]);

  useEffect(() => {
    if (!currentAgent || projects.length === 0) {
      setSelectedProjectId("");
      setProjectFiles([]);
      setSelectedFilePath("");
      setFileContent("");
      return;
    }

    if (!projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id);
    }
  }, [currentAgent, projects, selectedProjectId]);

  useEffect(() => {
    if (!currentAgent || !selectedProjectId) {
      return;
    }
    void loadProjectFiles(currentAgent.id, selectedProjectId);
  }, [currentAgent, selectedProjectId, loadProjectFiles]);

  useEffect(() => {
    if (!currentAgent || !selectedProject || !selectedFilePath) {
      return;
    }
    void loadFileContent(currentAgent.id, selectedProject.id, selectedFilePath);
  }, [currentAgent, selectedProject, selectedFilePath, loadFileContent]);

  return (
    <div className={styles.agentsPage}>
      <div className={styles.header}>
        <div>
          <Title level={4} className={styles.title}>
            {t("projects.title", "Projects")}
          </Title>
          <Text type="secondary" className={styles.description}>
            {t(
              "projects.description",
              "Browse the projects stored under the current agent workspace.",
            )}
          </Text>
        </div>
        <Button size="small" onClick={() => void loadAgents()} loading={loading}>
          {t("common.refresh", "Refresh")}
        </Button>
      </div>

      {error && <Alert type="error" showIcon message={error} />}

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
        <div className={styles.content}>
          <div className={styles.columnLeft}>
            <Card
              title={
                <span className={styles.sectionTitle}>{t("projects.list", "Projects")}</span>
              }
              bodyStyle={{ padding: 12 }}
            >
              <div className={styles.scrollContainer}>
                {projects.map((project) => {
                  const selected = project.id === selectedProjectId;
                  return (
                    <button
                      key={project.id}
                      type="button"
                      className={`${styles.listItem} ${selected ? styles.selected : ""}`}
                      onClick={() => setSelectedProjectId(project.id)}
                    >
                      <div className={styles.itemTitleRow}>
                        <span className={styles.itemTitle}>{project.name}</span>
                        <Tag color="blue">{project.status}</Tag>
                      </div>
                      <div className={styles.itemMeta}>{project.id}</div>
                      <div className={styles.itemMeta}>{project.updated_time}</div>
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>

          <div className={styles.columnMiddle}>
            <Card
              title={
                <span className={styles.sectionTitle}>{t("projects.files", "Files")}</span>
              }
              bodyStyle={{ padding: 12 }}
              extra={
                <Text type="secondary" className={styles.panelExtraText}>
                  {selectedProject?.name || t("projects.noProject", "No project selected")}
                </Text>
              }
            >
              <div className={styles.scrollContainer}>
                {filesLoading ? (
                  <div className={styles.centerState}>
                    <Spin />
                  </div>
                ) : projectFiles.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t("projects.noFiles", "No files in this project")}
                  />
                ) : (
                  projectFiles.map((file) => {
                    const selected = file.path === selectedFilePath;
                    return (
                      <button
                        key={file.path}
                        type="button"
                        className={`${styles.listItem} ${selected ? styles.selected : ""}`}
                        onClick={() => setSelectedFilePath(file.path)}
                      >
                        <div className={styles.itemTitle}>{file.filename}</div>
                        <div className={styles.itemMeta}>{file.path}</div>
                        <div className={styles.itemMeta}>
                          {formatBytes(file.size)} · {file.modified_time}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </Card>
          </div>

          <div className={styles.columnRight}>
            <Card
              title={
                <span className={styles.sectionTitle}>{t("projects.preview", "Preview")}</span>
              }
              bodyStyle={{ padding: 0 }}
              extra={
                <Text type="secondary" className={styles.panelExtraText}>
                  {selectedFile?.path || ""}
                </Text>
              }
            >
              <div className={styles.previewBody}>
                {contentLoading ? (
                  <div className={styles.centerState}>
                    <Spin />
                  </div>
                ) : selectedFilePath ? (
                  <pre className={styles.previewContent}>{fileContent}</pre>
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t("projects.selectFile", "Select a file to preview")}
                  />
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}