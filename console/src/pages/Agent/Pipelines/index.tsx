import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Descriptions, Empty, List, Progress, Select, Space, Spin, Tag, Typography, message } from "antd";
import { useAgentStore } from "../../../stores/agentStore";
import { agentsApi } from "../../../api/modules/agents";
import { flowsApi } from "../../../api/modules/flows";
import { knowledgeApi } from "../../../api/modules/knowledge";
import type { AgentProjectSummary } from "../../../api/types/agents";
import type { FlowDefinition, FlowRunRecord, FlowRunTimeline } from "../../../api/types/flows";
import type { ProjectKnowledgePipelineState } from "../../../api/types/knowledge";
import { formatPipelineDateTime, getCanonicalStageLabel } from "./display.ts";
import { deriveBuiltinProjectKnowledgeStages } from "./builtinStages.ts";
import {
  filterCompatibleFlowDefinitions,
  getRunStatusColor,
  getStructuredErrorSummary,
  isKnowledgeFlowDefinition,
  sortFlowDefinitions,
} from "./viewModel.ts";
import styles from "./index.module.less";

const { Title, Text, Paragraph } = Typography;

export default function PipelinesPage() {
  const { selectedAgent, setSelectedAgent, agents } = useAgentStore();

  const [projects, setProjects] = useState<AgentProjectSummary[]>([]);
  const [definitions, setDefinitions] = useState<FlowDefinition[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedDefinitionId, setSelectedDefinitionId] = useState("");
  const [runs, setRuns] = useState<FlowRunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedRunTimeline, setSelectedRunTimeline] = useState<FlowRunTimeline | null>(null);
  const [knowledgeStatus, setKnowledgeStatus] = useState<ProjectKnowledgePipelineState | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [actionKey, setActionKey] = useState<string>("");
  const [pageError, setPageError] = useState("");
  const [runtimeError, setRuntimeError] = useState("");

  const agentOptions = useMemo(
    () => agents.map((agent) => ({ value: agent.id, label: agent.name || agent.id })),
    [agents],
  );

  const projectOptions = useMemo(
    () => projects.map((project) => ({ value: project.id, label: project.name || project.id })),
    [projects],
  );

  const visibleDefinitions = useMemo(
    () => sortFlowDefinitions(filterCompatibleFlowDefinitions(definitions)),
    [definitions],
  );

  const selectedDefinition = useMemo(
    () => visibleDefinitions.find((definition) => definition.id === selectedDefinitionId) || null,
    [selectedDefinitionId, visibleDefinitions],
  );

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  const builtinStages = useMemo(
    () => deriveBuiltinProjectKnowledgeStages(knowledgeStatus),
    [knowledgeStatus],
  );

  const refreshRuntime = useCallback(async (projectId: string, preferredRunId?: string) => {
    if (!projectId) {
      setKnowledgeStatus(null);
      setRuns([]);
      setSelectedRunId("");
      setSelectedRunTimeline(null);
      return;
    }

    setRuntimeLoading(true);
    setRuntimeError("");
    try {
      const [status, scopedRuns] = await Promise.all([
        knowledgeApi.getProjectKnowledgePipelineStatus({ projectId }),
        flowsApi.listFlowRuns({ scopeKind: "project", scopeId: projectId }),
      ]);

      const orderedRuns = [...scopedRuns].sort((left, right) => right.created_at.localeCompare(left.created_at));
      setKnowledgeStatus(status);
      setRuns(orderedRuns);

      const nextRunId = preferredRunId || status.flow_run_id || orderedRuns[0]?.id || "";
      setSelectedRunId(nextRunId);
      setSelectedRunTimeline(null);
    } catch (error) {
      const summary = getStructuredErrorSummary(error);
      setRuntimeError(summary.message);
      setKnowledgeStatus(null);
      setRuns([]);
      setSelectedRunId("");
      setSelectedRunTimeline(null);
    } finally {
      setRuntimeLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    const loadPageData = async () => {
      setPageLoading(true);
      setPageError("");
      try {
        const [projectList, definitionList] = await Promise.all([
          agentsApi.listAgentProjects(selectedAgent),
          flowsApi.listFlowDefinitions(),
        ]);

        if (!active) {
          return;
        }

        const visible = sortFlowDefinitions(filterCompatibleFlowDefinitions(definitionList));
        setProjects(projectList);
        setDefinitions(definitionList);
        setSelectedProjectId((current) =>
          projectList.some((project) => project.id === current) ? current : (projectList[0]?.id || ""),
        );
        setSelectedDefinitionId((current) =>
          visible.some((definition) => definition.id === current) ? current : (visible[0]?.id || ""),
        );
      } catch (error) {
        if (!active) {
          return;
        }
        setPageError(getStructuredErrorSummary(error).message);
        setProjects([]);
        setDefinitions([]);
      } finally {
        if (active) {
          setPageLoading(false);
        }
      }
    };

    void loadPageData();
    return () => {
      active = false;
    };
  }, [selectedAgent]);

  useEffect(() => {
    void refreshRuntime(selectedProjectId);
  }, [refreshRuntime, selectedProjectId]);

  useEffect(() => {
    let active = true;

    const loadTimeline = async () => {
      if (!selectedRunId) {
        setSelectedRunTimeline(null);
        return;
      }

      setTimelineLoading(true);
      try {
        const timeline = await flowsApi.getFlowRun(selectedRunId);
        if (active) {
          setSelectedRunTimeline(timeline);
        }
      } catch (error) {
        if (active) {
          setSelectedRunTimeline(null);
          message.error(getStructuredErrorSummary(error).message);
        }
      } finally {
        if (active) {
          setTimelineLoading(false);
        }
      }
    };

    void loadTimeline();
    return () => {
      active = false;
    };
  }, [selectedRunId]);

  const runKnowledgePipeline = useCallback(async () => {
    if (!selectedProjectId) {
      return;
    }
    setActionKey("run");
    try {
      const response = await knowledgeApi.runProjectKnowledgePipeline({
        projectId: selectedProjectId,
        trigger: "manual",
      });
      await refreshRuntime(selectedProjectId, response.state.flow_run_id);
      message.success(response.deduplicated ? "Reused existing pipeline run." : "Knowledge pipeline started.");
    } catch (error) {
      message.error(getStructuredErrorSummary(error).message);
    } finally {
      setActionKey("");
    }
  }, [refreshRuntime, selectedProjectId]);

  const createFlowRun = useCallback(async () => {
    if (!selectedProjectId || !selectedDefinitionId) {
      return;
    }
    setActionKey("create");
    try {
      const run = await flowsApi.createFlowRun({
        definition_id: selectedDefinitionId,
        scope_kind: "project",
        scope_id: selectedProjectId,
        priority: 100,
      });
      setSelectedRunId(run.id);
      await refreshRuntime(selectedProjectId, run.id);
      message.success("Flow run created.");
    } catch (error) {
      message.error(getStructuredErrorSummary(error).message);
    } finally {
      setActionKey("");
    }
  }, [refreshRuntime, selectedDefinitionId, selectedProjectId]);

  const sendKnowledgeCommand = useCallback(async (commandType: "pause" | "resume" | "cancel") => {
    if (!selectedProjectId) {
      return;
    }
    setActionKey(commandType);
    try {
      const response = await knowledgeApi.commandProjectKnowledgePipeline({
        projectId: selectedProjectId,
        commandType,
      });
      await refreshRuntime(selectedProjectId, response.flow_run_id);
      message.success(`${humanizeFlowKey(commandType)} command accepted.`);
    } catch (error) {
      message.error(getStructuredErrorSummary(error).message);
    } finally {
      setActionKey("");
    }
  }, [refreshRuntime, selectedProjectId]);

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div>
          <Title level={2} className={styles.pageTitle}>Pipelines</Title>
          <Paragraph className={styles.pageDescription}>
            Canonical flow definitions, scoped project knowledge controls, and run timelines.
          </Paragraph>
        </div>
        <Space wrap>
          <Select
            value={selectedAgent}
            className={styles.select}
            options={agentOptions}
            onChange={(value) => setSelectedAgent(String(value))}
            placeholder="Select agent"
          />
          <Select
            value={selectedProjectId || undefined}
            className={styles.select}
            options={projectOptions}
            onChange={(value) => setSelectedProjectId(String(value))}
            placeholder="Select project"
          />
          <Button onClick={() => void refreshRuntime(selectedProjectId)} loading={runtimeLoading}>
            Refresh
          </Button>
        </Space>
      </div>

      {pageError ? <Alert type="error" showIcon message={pageError} /> : null}
      {runtimeError ? <Alert type="warning" showIcon message={runtimeError} /> : null}

      <Spin spinning={pageLoading}>
        <div className={styles.grid}>
          <Card title={`Definitions (${visibleDefinitions.length})`} className={styles.card}>
            {visibleDefinitions.length === 0 ? (
              <Empty description="No compatible flow definitions were loaded." />
            ) : (
              <List
                dataSource={visibleDefinitions}
                renderItem={(definition) => (
                  <List.Item
                    className={definition.id === selectedDefinitionId ? styles.listItemActive : styles.listItem}
                    onClick={() => setSelectedDefinitionId(definition.id)}
                  >
                    <div className={styles.listItemHeader}>
                      <Text strong>{definition.name}</Text>
                      <Tag color={definition.system_owned ? "green" : "blue"}>
                        {definition.system_owned ? "system" : "custom"}
                      </Tag>
                    </div>
                    <Text type="secondary">{definition.id}</Text>
                    <div className={styles.tagRow}>
                      {(definition.tags || []).map((tag) => (
                        <Tag key={tag}>{tag}</Tag>
                      ))}
                    </div>
                  </List.Item>
                )}
              />
            )}

            {selectedDefinition ? (
              <div className={styles.definitionDetail}>
                <Title level={4}>{selectedDefinition.name}</Title>
                <Paragraph>{selectedDefinition.description || "No description."}</Paragraph>
                <Descriptions size="small" column={1} bordered>
                  <Descriptions.Item label="Definition ID">{selectedDefinition.id}</Descriptions.Item>
                  <Descriptions.Item label="Version">{selectedDefinition.version || "-"}</Descriptions.Item>
                  <Descriptions.Item label="Classification">
                    {isKnowledgeFlowDefinition(selectedDefinition) ? "Knowledge pipeline" : "Flow definition"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Updated At">{formatPipelineDateTime(selectedDefinition.updated_at)}</Descriptions.Item>
                </Descriptions>

                <List
                  header={<Text strong>Steps</Text>}
                  dataSource={selectedDefinition.steps}
                  renderItem={(step) => (
                    <List.Item className={styles.stepItem}>
                      <div>
                        <Text strong>{step.name}</Text>
                        <div className={styles.stepMeta}>
                          <Tag>{step.kind}</Tag>
                          {step.executor ? <Tag color="blue">{step.executor}</Tag> : null}
                          {(step.depends_on || []).map((dependency) => (
                            <Tag key={dependency}>after:{dependency}</Tag>
                          ))}
                        </div>
                        <Text type="secondary">{step.description || "No description."}</Text>
                      </div>
                    </List.Item>
                  )}
                />
              </div>
            ) : null}
          </Card>

          <Card title="Project Knowledge Control" className={styles.card} extra={selectedProject ? <Text type="secondary">{selectedProject.name}</Text> : null}>
            {!selectedProject ? (
              <Empty description="Select a project to inspect knowledge runtime." />
            ) : (
              <Spin spinning={runtimeLoading}>
                <Space className={styles.actionRow} wrap>
                  <Button type="primary" onClick={() => void runKnowledgePipeline()} loading={actionKey === "run"}>
                    Run Knowledge Pipeline
                  </Button>
                  <Button onClick={() => void createFlowRun()} loading={actionKey === "create"}>
                    Create Flow Run
                  </Button>
                  <Button onClick={() => void sendKnowledgeCommand("pause")} loading={actionKey === "pause"}>
                    Pause
                  </Button>
                  <Button onClick={() => void sendKnowledgeCommand("resume")} loading={actionKey === "resume"}>
                    Resume
                  </Button>
                  <Button danger onClick={() => void sendKnowledgeCommand("cancel")} loading={actionKey === "cancel"}>
                    Cancel
                  </Button>
                </Space>

                <Descriptions size="small" column={1} bordered className={styles.statusPanel}>
                  <Descriptions.Item label="Status">
                    <Tag color={getRunStatusColor(knowledgeStatus?.status || "idle")}>{knowledgeStatus?.status || "idle"}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Current Stage">{getCanonicalStageLabel(knowledgeStatus?.current_stage || knowledgeStatus?.stage || "idle")}</Descriptions.Item>
                  <Descriptions.Item label="Flow Run ID">{knowledgeStatus?.flow_run_id || "-"}</Descriptions.Item>
                  <Descriptions.Item label="Recent Control Command">{knowledgeStatus?.recent_control_command || "-"}</Descriptions.Item>
                  <Descriptions.Item label="Updated At">{formatPipelineDateTime(knowledgeStatus?.control_updated_at || knowledgeStatus?.operation_updated_at)}</Descriptions.Item>
                  <Descriptions.Item label="Workspace">{selectedProject.workspace_dir}</Descriptions.Item>
                </Descriptions>

                {knowledgeStatus?.recent_error_code || knowledgeStatus?.last_error ? (
                  <Alert
                    className={styles.runtimeAlert}
                    type="warning"
                    showIcon
                    message={knowledgeStatus.recent_error_code || "Knowledge pipeline warning"}
                    description={knowledgeStatus.last_error || knowledgeStatus.recent_error_source || "The backend reported a recoverable issue."}
                  />
                ) : null}

                <div className={styles.stageList}>
                  {builtinStages.map((stage) => (
                    <div key={stage.key} className={styles.stageItem}>
                      <div className={styles.stageHeader}>
                        <Text strong>{getCanonicalStageLabel(stage.key)}</Text>
                        <Tag color={getRunStatusColor(stage.status)}>{stage.status}</Tag>
                      </div>
                      <Text type="secondary">{stage.summary || "-"}</Text>
                      {typeof stage.progress === "number" ? <Progress percent={stage.progress} size="small" showInfo={false} /> : null}
                    </div>
                  ))}
                </div>
              </Spin>
            )}
          </Card>

          <Card title={`Run Timeline (${runs.length})`} className={styles.card}>
            {!selectedProject ? (
              <Empty description="Select a project to load scoped runs." />
            ) : (
              <Spin spinning={runtimeLoading || timelineLoading}>
                {runs.length === 0 ? (
                  <Empty description="No flow runs found for this project." />
                ) : (
                  <div className={styles.timelineGrid}>
                    <List
                      className={styles.timelineList}
                      dataSource={runs}
                      renderItem={(run) => (
                        <List.Item
                          className={run.id === selectedRunId ? styles.listItemActive : styles.listItem}
                          onClick={() => setSelectedRunId(run.id)}
                        >
                          <div className={styles.listItemHeader}>
                            <Text strong>{run.definition_id}</Text>
                            <Tag color={getRunStatusColor(run.status)}>{run.status}</Tag>
                          </div>
                          <Text type="secondary">{run.id}</Text>
                          <Text type="secondary">Updated {formatPipelineDateTime(run.updated_at)}</Text>
                        </List.Item>
                      )}
                    />

                    <div className={styles.timelineDetail}>
                      {selectedRunTimeline ? (
                        <>
                          <Descriptions size="small" column={1} bordered>
                            <Descriptions.Item label="Run ID">{selectedRunTimeline.run.id}</Descriptions.Item>
                            <Descriptions.Item label="Definition">{selectedRunTimeline.run.definition_id}</Descriptions.Item>
                            <Descriptions.Item label="Scope">{selectedRunTimeline.run.scope_kind}:{selectedRunTimeline.run.scope_id}</Descriptions.Item>
                            <Descriptions.Item label="Current Step">{selectedRunTimeline.run.current_step_id || "-"}</Descriptions.Item>
                            <Descriptions.Item label="Created At">{formatPipelineDateTime(selectedRunTimeline.run.created_at)}</Descriptions.Item>
                          </Descriptions>

                          <List
                            header={<Text strong>Events</Text>}
                            dataSource={selectedRunTimeline.events}
                            locale={{ emptyText: "No events recorded." }}
                            renderItem={(event) => (
                              <List.Item className={styles.eventItem}>
                                <div>
                                  <div className={styles.listItemHeader}>
                                    <Text strong>{event.event_type}</Text>
                                    {event.status ? <Tag color={getRunStatusColor(event.status)}>{event.status}</Tag> : null}
                                  </div>
                                  <Text type="secondary">{event.step_id || "run-level event"}</Text>
                                  <Text type="secondary">{formatPipelineDateTime(event.created_at)}</Text>
                                </div>
                              </List.Item>
                            )}
                          />

                          <List
                            header={<Text strong>Commands</Text>}
                            dataSource={selectedRunTimeline.commands}
                            locale={{ emptyText: "No commands recorded." }}
                            renderItem={(command) => (
                              <List.Item className={styles.eventItem}>
                                <div>
                                  <div className={styles.listItemHeader}>
                                    <Text strong>{command.command_type}</Text>
                                    <Tag color={getRunStatusColor(command.status)}>{command.status}</Tag>
                                  </div>
                                  <Text type="secondary">{formatPipelineDateTime(command.updated_at)}</Text>
                                </div>
                              </List.Item>
                            )}
                          />
                        </>
                      ) : (
                        <Empty description="Select a run to inspect timeline details." />
                      )}
                    </div>
                  </div>
                )}
              </Spin>
            )}
          </Card>
        </div>
      </Spin>
    </div>
  );
}