import { useState } from "react";
import { CodeOutlined, FileTextOutlined, RobotOutlined } from "@ant-design/icons";
import { Button, Card, Collapse, Empty, Modal, Select, Spin, Tag, Typography, message } from "antd";
import { useTranslation } from "react-i18next";
import type {
  PlatformFlowTemplateInfo,
  ProjectPipelineNextAction,
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
  onUploadFiles: () => void;
  onOpenImportModal: () => void;
  onCreateRun: () => void;
  onStartAutomation: () => void;
  onPrepareImplementationDraft: () => void;
  onPrepareValidationDraft: () => void;
  onPreparePromotionDraft: () => void;
  onFocusNextActionStep: (stepId: string) => void;
  onApplyNextAction: (action: ProjectPipelineNextAction) => void;
  onExecuteNextAction: (action: ProjectPipelineNextAction) => void;
  onSelectTemplateId: (value: string) => void;
  onSelectRunId: (value: string) => void;
  onSelectStep: (stepId: string) => void;
  onCloseImportModal: () => void;
  onImportPlatformTemplate: () => void;
  onSelectPlatformTemplateId: (value: string) => void;
  formatRunTimeLabel: (raw: string) => string;
  statusTagColor: (status: string) => string;
}

function renderReadonlyCodeEditor(params: {
  value: string;
  empty: boolean;
  emptyText: string;
  languageLabel: string;
  lineCountLabel: string;
}) {
  if (params.empty) {
    return <pre className={`${styles.previewContent} ${styles.previewContentEmpty}`}>{params.emptyText}</pre>;
  }

  const lines = params.value.split("\n");

  return (
    <div className={styles.readonlyCodeEditor}>
      <div className={styles.readonlyCodeEditorToolbar}>
        <span className={styles.readonlyCodeEditorLang}>{params.languageLabel}</span>
        <span className={styles.readonlyCodeEditorMeta}>{params.lineCountLabel}</span>
      </div>
      <div className={styles.readonlyCodeEditorBody}>
        <div className={styles.readonlyCodeEditorLineNumbers} aria-hidden="true">
          {lines.map((_, index) => (
            <div key={`line-${index + 1}`} className={styles.readonlyCodeEditorLineNumber}>
              {index + 1}
            </div>
          ))}
        </div>
        <pre className={styles.readonlyCodeEditorContent}>{params.value}</pre>
      </div>
    </div>
  );
}

function renderStepContractSummary(params: {
  step: {
    id: string;
    name: string;
    kind: string;
    description?: string;
    status?: string;
    depends_on?: string[];
    inputs?: Record<string, unknown>;
    outputs?: Record<string, unknown>;
    input_bindings?: Record<string, string>;
    prompt?: string;
    script?: string;
    input_preview_items?: string[];
    output_preview_items?: string[];
    retry_policy?: Record<string, unknown>;
  };
  selected: boolean;
  related: boolean;
  templateMode?: boolean;
  stepOrder?: number;
  previewExpanded: boolean;
  statusTagColor: (status: string) => string;
  onSelectStep: (stepId: string) => void;
  onTogglePreview: (stepId: string) => void;
  isSectionCollapsed: (stepId: string, sectionKey: string) => boolean;
  onToggleSection: (stepId: string, sectionKey: string) => void;
  onCopySection: (sectionLabel: string, value: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const dependsOn = (params.step.depends_on || []).filter(Boolean);
  const inputKeys = Object.keys(params.step.inputs || {});
  const outputKeys = Object.keys(params.step.outputs || {});
  const bindingKeys = Object.keys(params.step.input_bindings || {});
  const promptText = (params.step.prompt || "").trim();
  const scriptText = (params.step.script || "").trim();
  const descriptionText = (params.step.description || "").trim();
  const inputPreviewItems = params.step.input_preview_items || [];
  const outputPreviewItems = params.step.output_preview_items || [];
  const hasPrompt = Boolean(promptText);
  const hasScript = Boolean(scriptText);
  const retryMaxAttempts =
    typeof params.step.retry_policy?.max_attempts === "number"
      ? String(params.step.retry_policy.max_attempts)
      : "-";
  const previewSections = [
    {
      key: "agent",
      label: params.t("projects.pipeline.stepPreviewAgent"),
      mode: params.t("projects.pipeline.stepPreviewMetaMode"),
      tone: "meta",
      value: params.step.kind || "-",
      empty: false,
    },
    {
      key: "description",
      label: params.t("projects.pipeline.stepPreviewDescription"),
      mode: params.t("projects.pipeline.stepPreviewTextMode"),
      tone: "text",
      value: descriptionText || params.t("projects.pipeline.stepPreviewNoDescription"),
      empty: !descriptionText,
    },
    {
      key: "prompt",
      label: params.t("projects.pipeline.stepPreviewPrompt"),
      mode: params.t("projects.pipeline.stepPreviewCodeMode"),
      tone: "code",
      value: promptText || params.t("projects.pipeline.stepPreviewNoPrompt"),
      empty: !promptText,
    },
    {
      key: "script",
      label: params.t("projects.pipeline.stepPreviewScript"),
      mode: params.t("projects.pipeline.stepPreviewCodeMode"),
      tone: "code",
      value: scriptText || params.t("projects.pipeline.stepPreviewNoScript"),
      empty: !scriptText,
    },
    {
      key: "inputs",
      label: params.t("projects.pipeline.stepPreviewInputs"),
      mode: params.t("projects.pipeline.stepPreviewTextMode"),
      tone: "text",
      value:
        inputPreviewItems.length > 0
          ? inputPreviewItems.map((item, index) => `${index + 1}. ${item}`).join("\n")
          : params.t("projects.pipeline.stepPreviewNoInputs"),
      empty: inputPreviewItems.length === 0,
    },
    {
      key: "outputs",
      label: params.t("projects.pipeline.stepPreviewOutputs"),
      mode: params.t("projects.pipeline.stepPreviewTextMode"),
      tone: "text",
      value:
        outputPreviewItems.length > 0
          ? outputPreviewItems.map((item, index) => `${index + 1}. ${item}`).join("\n")
          : params.t("projects.pipeline.stepPreviewNoOutputs"),
      empty: outputPreviewItems.length === 0,
    },
  ];
  const configuredPreviewCount = previewSections.filter((section) => !section.empty).length;
  const previewModeSummary = [
    hasPrompt ? params.t("projects.pipeline.stepPreviewPrompt") : null,
    hasScript ? params.t("projects.pipeline.stepPreviewScript") : null,
  ]
    .filter(Boolean)
    .join(" / ");

  return (
    <div
      key={params.step.id}
      role="button"
      tabIndex={0}
      className={`${styles.stepItem} ${params.selected ? styles.selected : ""} ${params.related ? styles.related : ""}`}
      onClick={() => params.onSelectStep(params.step.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          params.onSelectStep(params.step.id);
        }
      }}
    >
      <div className={styles.itemTitleRow}>
        <div className={styles.itemTitleMain}>
          <span className={styles.itemTitle}>
            {typeof params.stepOrder === "number" ? (
              <span className={styles.stepOrderBadge}>{params.stepOrder + 1}</span>
            ) : null}
            {params.step.name}
          </span>
        </div>
        <div className={styles.itemActions}>
          <span className={styles.stepCapabilityIcons}>
            <span
              className={`${styles.stepCapabilityIcon} ${styles.stepCapabilityIconAgent}`}
              title={params.t("projects.pipeline.stepPreviewAgent")}
            >
              <RobotOutlined />
            </span>
            {descriptionText ? (
              <span
                className={`${styles.stepCapabilityIcon} ${styles.stepCapabilityIconText}`}
                title={params.t("projects.pipeline.stepPreviewDescription")}
              >
                <FileTextOutlined />
              </span>
            ) : null}
            {hasPrompt ? (
              <span
                className={`${styles.stepCapabilityIcon} ${styles.stepCapabilityIconPrompt}`}
                title={params.t("projects.pipeline.stepPreviewPrompt")}
              >
                <FileTextOutlined />
              </span>
            ) : null}
            {hasScript ? (
              <span
                className={`${styles.stepCapabilityIcon} ${styles.stepCapabilityIconScript}`}
                title={params.t("projects.pipeline.stepPreviewScript")}
              >
                <CodeOutlined />
              </span>
            ) : null}
          </span>
          {params.templateMode ? (
            <Tag color="blue">{params.t("projects.pipeline.templateStep")}</Tag>
          ) : (
            <Tag color={params.statusTagColor(params.step.status || "default")}>
              {params.step.status}
            </Tag>
          )}
          <Button
            size="small"
            type={params.previewExpanded ? "primary" : "default"}
            onClick={(event) => {
              event.stopPropagation();
              params.onTogglePreview(params.step.id);
            }}
          >
            {params.previewExpanded
              ? params.t("projects.pipeline.stepPreviewClose")
              : params.t("projects.pipeline.stepPreviewOpen")}
          </Button>
        </div>
      </div>
      <div className={styles.itemMeta}>{params.step.kind}</div>
      <div className={styles.itemMeta}>{params.step.id}</div>
      <div className={styles.itemMeta}>
        {params.t("projects.pipeline.contract.dependsOn")}: {dependsOn.join(", ") || "-"}
      </div>
      <div className={styles.itemMeta}>
        {params.t("projects.pipeline.contract.inputs")}: {inputKeys.join(", ") || "-"}
      </div>
      <div className={styles.itemMeta}>
        {params.t("projects.pipeline.contract.outputs")}: {outputKeys.join(", ") || "-"}
      </div>
      <div className={styles.itemMeta}>
        {params.t("projects.pipeline.contract.bindings")}: {bindingKeys.join(", ") || "-"}
      </div>
      <div className={styles.itemMeta}>
        {params.t("projects.pipeline.contract.execution")}: {hasPrompt ? "prompt" : "-"}
        {hasScript ? "+script" : ""}
      </div>
      <div className={styles.itemMeta}>
        {params.t("projects.pipeline.contract.retry")}: {retryMaxAttempts}
      </div>

      {params.previewExpanded ? (
        <div
          className={styles.stepPreviewShell}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className={styles.stepPreviewShellHeader}>
            <div className={styles.stepPreviewShellHeaderMain}>
              <span className={styles.stepPreviewShellTitle}>
                {params.t("projects.pipeline.stepPreviewNotebook")}
              </span>
              <span className={styles.stepPreviewShellSubtitle}>
                {params.t("projects.pipeline.stepPreviewConfiguredSummary", {
                  count: configuredPreviewCount,
                  total: previewSections.length,
                })}
                {previewModeSummary ? ` · ${previewModeSummary}` : ""}
              </span>
            </div>
            <Text type="secondary" className={styles.itemMeta}>
              {params.step.id}
            </Text>
          </div>
          <div className={styles.stepPreviewGrid}>
            {previewSections.map((section, index) => {
              const toneClassName =
                section.tone === "code"
                  ? styles.stepPreviewCellCode
                  : section.tone === "text"
                    ? styles.stepPreviewCellText
                    : styles.stepPreviewCellMeta;

              const sectionCollapsed = params.isSectionCollapsed(params.step.id, section.key);
              const canCopy = (section.key === "prompt" || section.key === "script") && !section.empty;

              return (
                <div key={section.key} className={`${styles.stepPreviewCell} ${toneClassName}`}>
                  <div className={styles.stepPreviewGutter}>
                    <div className={styles.stepPreviewExecutionCount}>[{index + 1}]</div>
                    <div className={styles.stepPreviewExecutionType}>{section.mode}</div>
                  </div>
                  <div className={styles.stepPreviewCellMain}>
                    <div className={styles.stepPreviewCellHeader}>
                      <span className={styles.stepPreviewCellLabel}>{section.label}</span>
                      <div className={styles.stepPreviewCellActions}>
                        <Tag>{section.mode}</Tag>
                        {canCopy ? (
                          <Button
                            size="small"
                            onClick={() => params.onCopySection(section.label, section.value)}
                          >
                            {params.t("projects.pipeline.stepPreviewCopy")}
                          </Button>
                        ) : null}
                        <Button
                          size="small"
                          type={sectionCollapsed ? "default" : "text"}
                          onClick={() => params.onToggleSection(params.step.id, section.key)}
                        >
                          {sectionCollapsed
                            ? params.t("projects.pipeline.stepPreviewExpandCell")
                            : params.t("projects.pipeline.stepPreviewCollapseCell")}
                        </Button>
                      </div>
                    </div>
                    {sectionCollapsed ? (
                      <div className={styles.stepPreviewCollapsedHint}>
                        {params.t("projects.pipeline.stepPreviewCollapsedHint")}
                      </div>
                    ) : section.tone === "code" ? (
                      renderReadonlyCodeEditor({
                        value: section.value,
                        empty: section.empty,
                        emptyText: section.value,
                        languageLabel: section.label,
                        lineCountLabel: params.t("projects.pipeline.stepPreviewLineCount", {
                          count: section.value.split("\n").length,
                        }),
                      })
                    ) : (
                      <pre
                        className={`${styles.previewContent} ${section.empty ? styles.previewContentEmpty : ""}`}
                      >
                        {section.value}
                      </pre>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function actionSeverityColor(severity: string): string {
  const key = (severity || "").toLowerCase();
  if (key === "high") {
    return "red";
  }
  if (key === "medium") {
    return "orange";
  }
  if (key === "low") {
    return "blue";
  }
  return "default";
}

function actionSeverityLabel(t: ReturnType<typeof useTranslation>["t"], severity: string): string {
  const key = (severity || "info").toLowerCase();
  const keyMap: Record<string, string> = {
    high: "projects.pipeline.severity.high",
    medium: "projects.pipeline.severity.medium",
    low: "projects.pipeline.severity.low",
    info: "projects.pipeline.severity.info",
  };
  return t(keyMap[key] || keyMap.info);
}

function localizeConvergenceStage(t: ReturnType<typeof useTranslation>["t"], stage: string): string {
  const key = (stage || "").toLowerCase();
  const keyMap: Record<string, string> = {
    bootstrapping: "projects.pipeline.stage.bootstrapping",
    executing: "projects.pipeline.stage.executing",
    analyzing: "projects.pipeline.stage.analyzing",
    blocked: "projects.pipeline.stage.blocked",
    "closed-loop": "projects.pipeline.stage.closedLoop",
  };
  return t(keyMap[key] || "projects.pipeline.stage.unknown");
}

function localizeConvergenceItem(t: ReturnType<typeof useTranslation>["t"], message: string): string {
  const text = (message || "").trim();
  if (!text) {
    return "";
  }

  const directMap: Record<string, string> = {
    "Term extraction artifacts detected": "projects.pipeline.convergenceItem.termDetected",
    "Cross-book alignment artifacts detected": "projects.pipeline.convergenceItem.alignmentDetected",
    "Relation matrix artifacts detected": "projects.pipeline.convergenceItem.relationDetected",
    "Review pack artifacts detected": "projects.pipeline.convergenceItem.reviewDetected",
    "Term workbench outputs are incomplete": "projects.pipeline.convergenceItem.termIncomplete",
    "Cross-book alignment outputs are incomplete": "projects.pipeline.convergenceItem.alignmentIncomplete",
    "Relation matrix outputs are incomplete": "projects.pipeline.convergenceItem.relationIncomplete",
    "Review pack outputs are incomplete": "projects.pipeline.convergenceItem.reviewIncomplete",
  };
  const mappedKey = directMap[text];
  if (mappedKey) {
    return t(mappedKey);
  }

  if (text.startsWith("Missing step records:")) {
    return t("projects.pipeline.convergenceItem.missingStepRecords", {
      value: text.replace("Missing step records:", "").trim(),
    });
  }
  if (text.startsWith("Failed steps:")) {
    return t("projects.pipeline.convergenceItem.failedSteps", {
      value: text.replace("Failed steps:", "").trim(),
    });
  }

  return text;
}

function localizeNextAction(
  t: ReturnType<typeof useTranslation>["t"],
  action: ProjectPipelineNextAction,
): { title: string; description: string } {
  const keyMap: Record<string, { title: string; description: string }> = {
    wait_for_completion: {
      title: "projects.pipeline.nextActionText.waitForCompletion.title",
      description: "projects.pipeline.nextActionText.waitForCompletion.description",
    },
    handle_failed_steps: {
      title: "projects.pipeline.nextActionText.handleFailedSteps.title",
      description: "projects.pipeline.nextActionText.handleFailedSteps.description",
    },
    validate_template_contract: {
      title: "projects.pipeline.nextActionText.validateTemplateContract.title",
      description: "projects.pipeline.nextActionText.validateTemplateContract.description",
    },
    complete_term_extraction: {
      title: "projects.pipeline.nextActionText.completeTermExtraction.title",
      description: "projects.pipeline.nextActionText.completeTermExtraction.description",
    },
    complete_alignment: {
      title: "projects.pipeline.nextActionText.completeAlignment.title",
      description: "projects.pipeline.nextActionText.completeAlignment.description",
    },
    build_relation_matrix: {
      title: "projects.pipeline.nextActionText.buildRelationMatrix.title",
      description: "projects.pipeline.nextActionText.buildRelationMatrix.description",
    },
    finish_review_pack: {
      title: "projects.pipeline.nextActionText.finishReviewPack.title",
      description: "projects.pipeline.nextActionText.finishReviewPack.description",
    },
    start_improvement_iteration: {
      title: "projects.pipeline.nextActionText.startImprovementIteration.title",
      description: "projects.pipeline.nextActionText.startImprovementIteration.description",
    },
  };

  const mapped = keyMap[action.id];
  if (!mapped) {
    return {
      title: action.title,
      description: action.description,
    };
  }

  return {
    title: t(mapped.title),
    description: t(mapped.description),
  };
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
  onUploadFiles,
  onOpenImportModal,
  onCreateRun,
  onStartAutomation,
  onPrepareImplementationDraft,
  onPrepareValidationDraft,
  onPreparePromotionDraft,
  onFocusNextActionStep,
  onApplyNextAction,
  onExecuteNextAction,
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
  const [expandedStepIds, setExpandedStepIds] = useState<string[]>([]);
  const [collapsedPreviewSectionKeys, setCollapsedPreviewSectionKeys] = useState<string[]>([]);

  const isStepPreviewExpanded = (stepId: string): boolean => expandedStepIds.includes(stepId);
  const makeSectionStateKey = (stepId: string, sectionKey: string): string => `${stepId}::${sectionKey}`;

  const isPreviewSectionCollapsed = (stepId: string, sectionKey: string): boolean =>
    collapsedPreviewSectionKeys.includes(makeSectionStateKey(stepId, sectionKey));

  const toggleStepPreview = (stepId: string) => {
    setExpandedStepIds((current) =>
      current.includes(stepId)
        ? current.filter((value) => value !== stepId)
        : [...current, stepId],
    );
  };

  const togglePreviewSection = (stepId: string, sectionKey: string) => {
    const stateKey = makeSectionStateKey(stepId, sectionKey);
    setCollapsedPreviewSectionKeys((current) =>
      current.includes(stateKey)
        ? current.filter((value) => value !== stateKey)
        : [...current, stateKey],
    );
  };

  const handleCopyPreviewSection = async (sectionLabel: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success(
        t("projects.pipeline.stepPreviewCopySuccess", {
          section: sectionLabel,
        }),
      );
    } catch {
      message.error(
        t("projects.pipeline.stepPreviewCopyFailed", {
          section: sectionLabel,
        }),
      );
    }
  };

  const setStepPreviewBatch = (stepIds: string[], expanded: boolean) => {
    setExpandedStepIds((current) => {
      if (expanded) {
        return Array.from(new Set([...current, ...stepIds]));
      }
      const hidden = new Set(stepIds);
      return current.filter((value) => !hidden.has(value));
    });
  };

  const formatStepInputPreviewItems = (params: {
    stepId: string;
    stepInputs?: Record<string, unknown>;
    contractInputs?: Record<string, unknown>;
  }): string[] => {
    const items: string[] = [];
    const inputKeys = Object.keys(params.stepInputs || params.contractInputs || {});
    for (const key of inputKeys) {
      items.push(`dataset:${key}`);
    }

    for (const artifact of runDetail?.artifact_records || []) {
      if (!(artifact.consumer_step_ids || []).includes(params.stepId)) {
        continue;
      }
      const label = (artifact.path || artifact.name || "").trim();
      if (!label) {
        continue;
      }
      items.push(label);
    }

    return Array.from(new Set(items));
  };

  const formatStepOutputPreviewItems = (params: {
    stepId: string;
    stepOutputs?: Record<string, unknown>;
    contractOutputs?: Record<string, unknown>;
  }): string[] => {
    const items: string[] = [];
    const outputKeys = Object.keys(params.stepOutputs || params.contractOutputs || {});
    for (const key of outputKeys) {
      items.push(`dataset:${key}`);
    }

    for (const artifact of runDetail?.artifact_records || []) {
      if ((artifact.producer_step_id || "") !== params.stepId) {
        continue;
      }
      const label = (artifact.path || artifact.name || "").trim();
      if (!label) {
        continue;
      }
      items.push(label);
    }

    return Array.from(new Set(items));
  };

  const renderStepPreviewBatchActions = (stepIds: string[]) => {
    if (stepIds.length === 0) {
      return null;
    }
    const allExpanded = stepIds.every((stepId) => expandedStepIds.includes(stepId));

    return (
      <div className={styles.stepPreviewBatchActions}>
        <Button size="small" onClick={() => setStepPreviewBatch(stepIds, true)}>
          {t("projects.pipeline.stepPreviewExpandAll")}
        </Button>
        <Button size="small" disabled={!allExpanded} onClick={() => setStepPreviewBatch(stepIds, false)}>
          {t("projects.pipeline.stepPreviewCollapseAll")}
        </Button>
      </div>
    );
  };

  return (
    <>
      <Card
        title={<span className={styles.sectionTitle}>{t("projects.automation.title")}</span>}
        styles={{ body: { padding: 12 } }}
        extra={
          <Text type="secondary" className={styles.panelExtraText}>
            {selectedRunStatus || t("projects.pipeline.noRun")}
          </Text>
        }
      >
        <div className={styles.scrollContainer}>
          <div className={styles.automationResponsiveTop}>
            <div className={styles.automationTopCard}>
              <div className={styles.pipelineTopActions}>
                <Button size="small" onClick={onUploadFiles}>
                  {t("projects.upload.batchButton")}
                </Button>
                <Button
                  size="small"
                  onClick={onOpenImportModal}
                  loading={importLoading && !importModalOpen}
                >
                  {t("projects.pipeline.importGlobal")}
                </Button>
              </div>
              <div className={styles.itemMeta}>{t("projects.upload.batchBehaviorHint")}</div>
            </div>

            <div className={styles.automationTopCard}>
              <div className={styles.runToolbar}>
                <Select
                  size="small"
                  className={styles.templateSelect}
                  value={selectedTemplateId || undefined}
                  placeholder={t("projects.pipeline.template")}
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
                  {t("projects.pipeline.run")}
                </Button>
              </div>
            </div>

            <div className={`${styles.automationTopCard} ${styles.automationTopCardWide}`}>
              <div className={styles.progressCoach}>
                <div className={styles.progressCoachMeta}>
                  <div className={styles.subSectionTitle}>
                    {t("projects.automation.guidance")}
                  </div>
                  <div className={styles.itemMeta}>{verificationGateSummary}</div>
                </div>
                <div className={styles.progressCoachActions}>
                  <Button size="small" onClick={onStartAutomation}>
                    {t("projects.chat.startAutomation")}
                  </Button>
                  <Button size="small" onClick={onPrepareImplementationDraft}>
                    {t("projects.pipeline.nextImplementation")}
                  </Button>
                  <Button size="small" onClick={onPrepareValidationDraft}>
                    {t("projects.pipeline.nextValidation")}
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    disabled={!canPromoteToTemplateDraft || !selectedTemplateId || !selectedRunId}
                    onClick={onPreparePromotionDraft}
                  >
                    {t("projects.pipeline.promoteDraft")}
                  </Button>
                </div>
              </div>
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
                    description={t("projects.pipeline.noRunsForFlow")}
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
                            {t("projects.pipeline.runStartedAt", {
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
                              <div className={styles.detailSectionCard}>
                                <div className={styles.subSectionTitle}>
                                  {t("projects.pipeline.convergence")}
                                </div>
                                <div className={styles.automationMetaGrid}>
                                  <div className={styles.itemMeta}>
                                    {t("projects.pipeline.convergenceStage")}: {localizeConvergenceStage(
                                      t,
                                      runDetail.convergence?.stage || "",
                                    )}
                                  </div>
                                  <div className={styles.itemMeta}>
                                    {t("projects.pipeline.convergenceScore")}: {runDetail.convergence?.score ?? 0}%
                                    {" · "}
                                    {runDetail.convergence?.passed_checks ?? 0}/
                                    {runDetail.convergence?.total_checks ?? 0}
                                  </div>
                                  {(runDetail.convergence?.highlights || []).length > 0 && (
                                    <div className={`${styles.itemMeta} ${styles.automationMetaGridWide}`}>
                                      {t("projects.pipeline.highlights")}: {runDetail.convergence.highlights.map(
                                        (item) => localizeConvergenceItem(t, item),
                                      ).join("; ")}
                                    </div>
                                  )}
                                  {(runDetail.convergence?.blocking_issues || []).length > 0 && (
                                    <div className={`${styles.itemMeta} ${styles.automationMetaGridWide}`}>
                                      {t("projects.pipeline.blockingIssues")}: {runDetail.convergence.blocking_issues.map(
                                        (item) => localizeConvergenceItem(t, item),
                                      ).join("; ")}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className={styles.detailSectionCard}>
                                <div className={styles.subSectionTitle}>
                                  {t("projects.pipeline.nextActions")}
                                </div>
                                {runDetail.next_actions && runDetail.next_actions.length > 0 ? (
                                  <div className={styles.nextActionsGrid}>
                                    {runDetail.next_actions.map((action) => (
                                      <div key={action.id} className={styles.nextActionCard}>
                                        <div className={styles.itemMeta}>
                                          <Tag color={actionSeverityColor(action.severity)}>
                                            {actionSeverityLabel(t, action.severity || "info")}
                                          </Tag>
                                          <strong>{localizeNextAction(t, action).title}</strong>
                                          {": "}
                                          {localizeNextAction(t, action).description}
                                        </div>
                                        <div className={styles.nextActionButtons}>
                                          {action.target_step_id ? (
                                            <Button
                                              size="small"
                                              type="primary"
                                              onClick={() => onExecuteNextAction(action)}
                                            >
                                              {t("projects.pipeline.executeAction")}
                                            </Button>
                                          ) : null}
                                          {action.target_step_id ? (
                                            <Button
                                              size="small"
                                              onClick={() => onFocusNextActionStep(action.target_step_id || "")}
                                            >
                                              {t("projects.pipeline.focusStep")}
                                            </Button>
                                          ) : null}
                                          <Button
                                            size="small"
                                            type="primary"
                                            onClick={() => onApplyNextAction(action)}
                                          >
                                            {t("projects.pipeline.useInChat")}
                                          </Button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className={styles.itemMeta}>
                                    {t("projects.pipeline.noNextActions")}
                                  </div>
                                )}
                              </div>

                              <div className={styles.detailSectionCard}>
                                <div className={styles.subSectionTitle}>
                                  {t("projects.pipeline.steps")}
                                </div>
                                {renderStepPreviewBatchActions(runDetail.steps.map((step) => step.id))}
                                <div className={styles.progressLine}>
                                  {t("projects.pipeline.progress")}: {runProgress.completed}/
                                  {runProgress.total} · running {runProgress.running} · pending {runProgress.pending}
                                </div>
                                {runDetail.steps.length > 0 ? (
                                  <div className={styles.stepCardGrid}>
                                    {runDetail.steps.map((step, stepIndex) => {
                                      const contract = stepContractById.get(step.id);
                                      return renderStepContractSummary({
                                        step: {
                                          ...step,
                                          description: step.description || contract?.description,
                                          depends_on: step.depends_on?.length ? step.depends_on : contract?.depends_on,
                                          inputs: Object.keys(step.inputs || {}).length ? step.inputs : contract?.inputs,
                                          outputs: Object.keys(step.outputs || {}).length ? step.outputs : contract?.outputs,
                                          input_bindings: Object.keys(step.input_bindings || {}).length
                                            ? step.input_bindings
                                            : contract?.input_bindings,
                                          prompt: step.prompt || contract?.prompt,
                                          script: step.script || contract?.script,
                                          input_preview_items: formatStepInputPreviewItems({
                                            stepId: step.id,
                                            stepInputs: step.inputs,
                                            contractInputs: contract?.inputs,
                                          }),
                                          output_preview_items: formatStepOutputPreviewItems({
                                            stepId: step.id,
                                            stepOutputs: step.outputs,
                                            contractOutputs: contract?.outputs,
                                          }),
                                          retry_policy: Object.keys(step.retry_policy || {}).length
                                            ? step.retry_policy
                                            : contract?.retry_policy,
                                        },
                                        selected: selectedStepId === step.id,
                                        related: !selectedStepId && highlightedStepIds.has(step.id) ? false : highlightedStepIds.has(step.id) && selectedStepId !== step.id,
                                        stepOrder: stepIndex,
                                        previewExpanded: isStepPreviewExpanded(step.id),
                                        statusTagColor,
                                        onSelectStep,
                                        onTogglePreview: toggleStepPreview,
                                        isSectionCollapsed: isPreviewSectionCollapsed,
                                        onToggleSection: togglePreviewSection,
                                        onCopySection: handleCopyPreviewSection,
                                        t,
                                      });
                                    })}
                                  </div>
                                ) : (
                                  <Empty
                                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                                    description={t("projects.pipeline.noSteps")}
                                  />
                                )}
                              </div>
                            </>
                          ) : (
                            <div className={styles.itemMeta}>
                              {t("projects.pipeline.expandToViewSteps")}
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
                  <div className={styles.subSectionTitle}>{t("projects.pipeline.steps")}</div>
                  {renderStepPreviewBatchActions((activeRunTemplate?.steps || []).map((step) => step.id))}
                  {activeRunTemplate?.steps && activeRunTemplate.steps.length > 0 ? (
                    <div className={styles.stepCardGrid}>
                      {activeRunTemplate.steps.map((step, stepIndex) =>
                        renderStepContractSummary({
                          step: {
                            ...step,
                            input_preview_items: formatStepInputPreviewItems({
                              stepId: step.id,
                              stepInputs: step.inputs,
                              contractInputs: step.inputs,
                            }),
                            output_preview_items: formatStepOutputPreviewItems({
                              stepId: step.id,
                              stepOutputs: step.outputs,
                              contractOutputs: step.outputs,
                            }),
                          },
                          selected: selectedStepId === step.id,
                          related: highlightedStepIds.has(step.id) && selectedStepId !== step.id,
                          templateMode: true,
                          stepOrder: stepIndex,
                          previewExpanded: isStepPreviewExpanded(step.id),
                          statusTagColor,
                          onSelectStep,
                          onTogglePreview: toggleStepPreview,
                          isSectionCollapsed: isPreviewSectionCollapsed,
                          onToggleSection: togglePreviewSection,
                          onCopySection: handleCopyPreviewSection,
                          t,
                        }),
                      )}
                    </div>
                  ) : (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={t("projects.pipeline.noSteps")}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      <Modal
        title={t("projects.pipeline.importGlobalTitle")}
        open={importModalOpen}
        confirmLoading={importLoading}
        onOk={onImportPlatformTemplate}
        onCancel={onCloseImportModal}
        okButtonProps={{ disabled: !selectedPlatformTemplateId }}
        okText={t("projects.pipeline.importGlobal")}
      >
        {platformTemplates.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("projects.pipeline.noGlobalTemplates")}
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