import { Button, Card, Collapse, Empty, Modal, Select, Spin, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type {
  PlatformFlowTemplateInfo,
  ProjectPipelineRunDetail,
  ProjectPipelineRunSummary,
  ProjectPipelineTemplateInfo,
  ProjectPipelineTemplateStep,
} from "../../../api/types/agents";
import styles from "./index.module.less";

const { Text } = Typography;

interface RunProgressSummary {
  total: number;
  completed: number;
  running: number;
  pending: number;
}

interface ProjectAutomationPanelProps {
  selectedRunStatus?: string | null;
  selectedTemplateId: string;
  selectedRunId: string;
  selectedProjectExists: boolean;
  pipelineTemplates: ProjectPipelineTemplateInfo[];
  pipelineLoading: boolean;
  pipelineRuns: ProjectPipelineRunSummary[];
  runsForSelectedTemplate: ProjectPipelineRunSummary[];
  activeRunTemplate?: ProjectPipelineTemplateInfo;
  runDetail: ProjectPipelineRunDetail | null;
  runProgress: RunProgressSummary;
  stepContractById: Map<string, ProjectPipelineTemplateStep>;
  selectedStepId: string;
  highlightedStepIds: Set<string>;
  createRunLoading: boolean;
  importLoading: boolean;
  importModalOpen: boolean;
  selectedPlatformTemplateId: string;
  platformTemplates: PlatformFlowTemplateInfo[];
  verificationGateSummary: string;
  canPromoteToTemplateDraft: boolean;
  onBackToList: () => void;
  onUploadFiles: () => void;
  onOpenImportModal: () => void;
  onCreateRun: () => void;
  onStartAutomation: () => void;
  onPrepareImplementationDraft: () => void;
  onPrepareValidationDraft: () => void;
  onPreparePromotionDraft: () => void;
  onSelectTemplateId: (value: string) => void;
  onSelectRunId: (value: string) => void;
  onSelectStep: (stepId: string) => void;
  onCloseImportModal: () => void;
  onImportPlatformTemplate: () => void;
  onSelectPlatformTemplateId: (value: string) => void;
  formatRunTimeLabel: (raw: string) => string;
  statusTagColor: (status: string) => string;
}

function renderStepContractSummary(params: {
  step: {
    id: string;
    name: string;
    kind: string;
    status?: string;
    depends_on?: string[];
    inputs?: Record<string, unknown>;
    outputs?: Record<string, unknown>;
    input_bindings?: Record<string, string>;
    prompt?: string;
    script?: string;
    retry_policy?: Record<string, unknown>;
  };
  selected: boolean;
  related: boolean;
  templateMode?: boolean;
  statusTagColor: (status: string) => string;
  onSelectStep: (stepId: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const dependsOn = (params.step.depends_on || []).filter(Boolean);
  const inputKeys = Object.keys(params.step.inputs || {});
  const outputKeys = Object.keys(params.step.outputs || {});
  const bindingKeys = Object.keys(params.step.input_bindings || {});
  const hasPrompt = Boolean((params.step.prompt || "").trim());
  const hasScript = Boolean((params.step.script || "").trim());
  const retryMaxAttempts =
    typeof params.step.retry_policy?.max_attempts === "number"
      ? String(params.step.retry_policy.max_attempts)
      : "-";

  return (
    <button
      key={params.step.id}
      type="button"
      className={`${styles.stepItem} ${params.selected ? styles.selected : ""} ${params.related ? styles.related : ""}`}
      onClick={() => params.onSelectStep(params.step.id)}
    >
      <div className={styles.itemTitleRow}>
        <span className={styles.itemTitle}>{params.step.name}</span>
        {params.templateMode ? (
          <Tag color="blue">{params.t("projects.pipeline.templateStep", "template")}</Tag>
        ) : (
          <Tag color={params.statusTagColor(params.step.status || "default")}>
            {params.step.status}
          </Tag>
        )}
      </div>
      <div className={styles.itemMeta}>{params.step.kind}</div>
      <div className={styles.itemMeta}>{params.step.id}</div>
      <div className={styles.itemMeta}>
        {params.t("projects.pipeline.contract.dependsOn", "Depends on")}: {dependsOn.join(", ") || "-"}
      </div>
      <div className={styles.itemMeta}>
        {params.t("projects.pipeline.contract.inputs", "Inputs")}: {inputKeys.join(", ") || "-"}
      </div>
      <div className={styles.itemMeta}>
        {params.t("projects.pipeline.contract.outputs", "Outputs")}: {outputKeys.join(", ") || "-"}
      </div>
      <div className={styles.itemMeta}>
        {params.t("projects.pipeline.contract.bindings", "Input bindings")}: {bindingKeys.join(", ") || "-"}
      </div>
      <div className={styles.itemMeta}>
        {params.t("projects.pipeline.contract.execution", "Execution")}: {hasPrompt ? "prompt" : "-"}
        {hasScript ? "+script" : ""}
      </div>
      <div className={styles.itemMeta}>
        {params.t("projects.pipeline.contract.retry", "Retry max attempts")}: {retryMaxAttempts}
      </div>
    </button>
  );
}

export default function ProjectAutomationPanel({
  selectedRunStatus,
  selectedTemplateId,
  selectedRunId,
  selectedProjectExists,
  pipelineTemplates,
  pipelineLoading,
  runsForSelectedTemplate,
  activeRunTemplate,
  runDetail,
  runProgress,
  stepContractById,
  selectedStepId,
  highlightedStepIds,
  createRunLoading,
  importLoading,
  importModalOpen,
  selectedPlatformTemplateId,
  platformTemplates,
  verificationGateSummary,
  canPromoteToTemplateDraft,
  onBackToList,
  onUploadFiles,
  onOpenImportModal,
  onCreateRun,
  onStartAutomation,
  onPrepareImplementationDraft,
  onPrepareValidationDraft,
  onPreparePromotionDraft,
  onSelectTemplateId,
  onSelectRunId,
  onSelectStep,
  onCloseImportModal,
  onImportPlatformTemplate,
  onSelectPlatformTemplateId,
  formatRunTimeLabel,
  statusTagColor,
}: ProjectAutomationPanelProps) {
  const { t } = useTranslation();

  return (
    <>
      <Card
        title={<span className={styles.sectionTitle}>{t("projects.automation.title", "Automation")}</span>}
        styles={{ body: { padding: 12 } }}
        extra={
          <Text type="secondary" className={styles.panelExtraText}>
            {selectedRunStatus || t("projects.pipeline.noRun", "No run")}
          </Text>
        }
      >
        <div className={styles.scrollContainer}>
          <div className={styles.pipelineTopActions}>
            <Button size="small" onClick={onBackToList}>
              {t("projects.backToList", "Back to project list")}
            </Button>
            <Button size="small" onClick={onUploadFiles}>
              {t("projects.upload.button", "Upload Files")}
            </Button>
            <Button
              size="small"
              onClick={onOpenImportModal}
              loading={importLoading && !importModalOpen}
            >
              {t("projects.pipeline.importGlobal", "Import Global")}
            </Button>
          </div>

          <div className={styles.runToolbar}>
            <Select
              size="small"
              className={styles.templateSelect}
              value={selectedTemplateId || undefined}
              placeholder={t("projects.pipeline.template", "Select template")}
              options={pipelineTemplates.map((template) => ({
                label: `${template.name}${template.version ? ` (${template.version})` : ""}`,
                value: template.id,
              }))}
              onChange={onSelectTemplateId}
            />
            <Button
              size="small"
              type="primary"
              className={styles.runButton}
              disabled={!selectedTemplateId || !selectedProjectExists}
              loading={createRunLoading}
              onClick={onCreateRun}
            >
              {t("projects.pipeline.run", "Run")}
            </Button>
          </div>

          <div className={styles.progressCoach}>
            <div className={styles.progressCoachMeta}>
              <div className={styles.subSectionTitle}>
                {t("projects.automation.guidance", "Automation Guidance")}
              </div>
              <div className={styles.itemMeta}>{verificationGateSummary}</div>
            </div>
            <div className={styles.progressCoachActions}>
              <Button size="small" onClick={onStartAutomation}>
                {t("projects.chat.startAutomation", "Open automation design")}
              </Button>
              <Button size="small" onClick={onPrepareImplementationDraft}>
                {t("projects.pipeline.nextImplementation", "Prepare next implementation prompt")}
              </Button>
              <Button size="small" onClick={onPrepareValidationDraft}>
                {t("projects.pipeline.nextValidation", "Prepare validation prompt")}
              </Button>
              <Button
                size="small"
                type="primary"
                disabled={!canPromoteToTemplateDraft || !selectedTemplateId || !selectedRunId}
                onClick={onPreparePromotionDraft}
              >
                {t("projects.pipeline.promoteDraft", "Prepare promotion-to-template prompt")}
              </Button>
            </div>
          </div>

          {pipelineLoading ? (
            <div className={styles.centerState}>
              <Spin />
            </div>
          ) : (
            <>
              <div className={styles.runList}>
                {runsForSelectedTemplate.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t("projects.pipeline.noRunsForFlow", "No runs for selected flow yet")}
                  />
                ) : (
                  <Collapse
                    accordion
                    ghost
                    activeKey={selectedRunId || undefined}
                    onChange={(activeKey) => {
                      const key = Array.isArray(activeKey) ? activeKey[0] : activeKey;
                      onSelectRunId(typeof key === "string" ? key : "");
                    }}
                    items={runsForSelectedTemplate.map((run) => ({
                      key: run.id,
                      label: (
                        <div className={styles.itemTitleRow}>
                          <span className={styles.itemTitle}>
                            {t("projects.pipeline.runStartedAt", "Run @ {{time}}", {
                              time: formatRunTimeLabel(run.created_at),
                            })}
                          </span>
                          <Tag color={statusTagColor(run.status)}>{run.status}</Tag>
                        </div>
                      ),
                      children: (
                        <div className={styles.runAccordionBody}>
                          <div className={styles.itemMeta}>{run.id}</div>
                          <div className={styles.itemMeta}>{run.template_id}</div>
                          <div className={styles.itemMeta}>{run.updated_at}</div>
                          {selectedRunId === run.id && runDetail ? (
                            <>
                              <div className={styles.subSectionTitle}>
                                {t("projects.pipeline.steps", "Steps")}
                              </div>
                              <div className={styles.progressLine}>
                                {t("projects.pipeline.progress", "Progress")}: {runProgress.completed}/
                                {runProgress.total} · running {runProgress.running} · pending {runProgress.pending}
                              </div>
                              {runDetail.steps.length > 0 ? (
                                runDetail.steps.map((step) => {
                                  const contract = stepContractById.get(step.id);
                                  return renderStepContractSummary({
                                    step: {
                                      ...step,
                                      depends_on: contract?.depends_on,
                                      inputs: contract?.inputs,
                                      outputs: contract?.outputs,
                                      input_bindings: contract?.input_bindings,
                                      prompt: contract?.prompt,
                                      script: contract?.script,
                                      retry_policy: contract?.retry_policy,
                                    },
                                    selected: selectedStepId === step.id,
                                    related: !selectedStepId && highlightedStepIds.has(step.id) ? false : highlightedStepIds.has(step.id) && selectedStepId !== step.id,
                                    statusTagColor,
                                    onSelectStep,
                                    t,
                                  });
                                })
                              ) : (
                                <Empty
                                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                                  description={t("projects.pipeline.noSteps", "No steps available")}
                                />
                              )}
                            </>
                          ) : (
                            <div className={styles.itemMeta}>
                              {t("projects.pipeline.expandToViewSteps", "Expand selected run to view step records")}
                            </div>
                          )}
                        </div>
                      ),
                    }))}
                  />
                )}
              </div>

              {runsForSelectedTemplate.length === 0 && (
                <div className={styles.stepPanel}>
                  <div className={styles.subSectionTitle}>{t("projects.pipeline.steps", "Steps")}</div>
                  {activeRunTemplate?.steps && activeRunTemplate.steps.length > 0 ? (
                    activeRunTemplate.steps.map((step) =>
                      renderStepContractSummary({
                        step,
                        selected: selectedStepId === step.id,
                        related: highlightedStepIds.has(step.id) && selectedStepId !== step.id,
                        templateMode: true,
                        statusTagColor,
                        onSelectStep,
                        t,
                      }),
                    )
                  ) : (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={t("projects.pipeline.noSteps", "No steps available")}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      <Modal
        title={t("projects.pipeline.importGlobalTitle", "Import Global Pipeline")}
        open={importModalOpen}
        confirmLoading={importLoading}
        onOk={onImportPlatformTemplate}
        onCancel={onCloseImportModal}
        okButtonProps={{ disabled: !selectedPlatformTemplateId }}
        okText={t("projects.pipeline.importGlobal", "Import Global")}
      >
        {platformTemplates.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("projects.pipeline.noGlobalTemplates", "No global templates available")}
          />
        ) : (
          <Select
            className={styles.importTemplateSelect}
            value={selectedPlatformTemplateId || undefined}
            options={platformTemplates.map((template) => ({
              label: `${template.name}${template.version ? ` (${template.version})` : ""}`,
              value: template.id,
            }))}
            onChange={onSelectPlatformTemplateId}
          />
        )}
      </Modal>
    </>
  );
}