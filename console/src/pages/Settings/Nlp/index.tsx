import { Button } from "@agentscope-ai/design";
import { Alert, Card, Collapse, Input, InputNumber, Select, Space, Spin, Switch, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import type { KeyboardEventHandler } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { useNlp } from "./useNlp";
import styles from "./index.module.less";

const NAV_SECTION_IDS = [
  "nlp-section-demo",
  "nlp-section-methods",
  "nlp-section-strategy",
  "nlp-section-dryrun",
  "nlp-section-runtime",
  "nlp-section-maintenance",
] as const;

type MethodStatus = {
  status: string;
  reasonCode: string;
  reason: string;
};

type DemoMethod = {
  key: string;
  backendTaskKey: string;
  title: string;
  placeholder: string;
  examples: string[];
};

type NlpDemoMeta = {
  task_key: string;
  request_id: string;
  status: string;
  reason_code: string;
  reason: string;
  result: unknown;
  resolved_model: string;
  strategy_mode: string;
  detected_style: string;
  detection_score: number;
  matched_rules: string[];
  fallback_used: boolean;
  duration_ms: number;
};

const DEMO_METHODS: DemoMethod[] = [
  {
    key: "tokenize",
    backendTaskKey: "tokenize",
    title: "Tokenize",
    placeholder: "输入一段中文文本，例如：微软发布新模型。",
    examples: ["微软发布新模型。", "吾之道也。"],
  },
  {
    key: "nerMsra",
    backendTaskKey: "ner",
    title: "NER (MSRA)",
    placeholder: "输入命名实体识别文本，例如：微软在北京发布Copaw。",
    examples: ["微软在北京发布Copaw。", "阿里巴巴位于杭州。"],
  },
  {
    key: "dep",
    backendTaskKey: "dep",
    title: "Dependency Parsing",
    placeholder: "输入依存句法文本，例如：微软发布新模型。",
    examples: ["微软发布新模型。", "我们正在测试模型自动选择能力。"],
  },
  {
    key: "sdp",
    backendTaskKey: "sdp",
    title: "Semantic Dependency Parsing",
    placeholder: "输入语义依存文本。",
    examples: ["微软发布新模型。", "他们在上海召开会议。"],
  },
  {
    key: "con",
    backendTaskKey: "con",
    title: "Constituency Parsing",
    placeholder: "输入短语结构分析文本。",
    examples: ["微软发布新模型。", "这个系统运行稳定。"],
  },
  {
    key: "cor",
    backendTaskKey: "cor",
    title: "Coreference Resolution",
    placeholder: "输入指代消解文本。",
    examples: ["张三到了公司，他开始写代码。", "李雷见到韩梅梅，她很高兴。"],
  },
];

function resolveTagColor(status: string): "success" | "warning" | "error" | "default" {
  if (status === "ready") {
    return "success";
  }
  if (status === "error") {
    return "error";
  }
  if (status === "disabled") {
    return "default";
  }
  return "warning";
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function renderTokenRail(tokens: string[], activeTokenIndex?: number | null) {
  if (tokens.length === 0) {
    return null;
  }
  return (
    <div className={styles.demoTokenRail}>
      {tokens.map((token, index) => (
        <span
          key={`${token}-${index}`}
          className={`${styles.demoTokenNode} ${activeTokenIndex === index ? styles.demoTokenNodeActive : ""}`}
        >
          <span className={styles.demoTokenIndex}>{index + 1}</span>
          <span>{token}</span>
        </span>
      ))}
    </div>
  );
}

function getTokenListFromResult(taskKey: string, result: unknown): string[] {
  if (taskKey === "tokenize" && Array.isArray(result)) {
    return result.map((item) => String(item || "")).filter(Boolean);
  }
  if ((taskKey === "dep" || taskKey === "sdp") && Array.isArray(result)) {
    return result
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((row) => String(row.token || row.text || row.word || ""))
      .filter(Boolean);
  }
  return [];
}

function getSelectableCount(taskKey: string, result: unknown): number {
  if (!Array.isArray(result)) {
    return 0;
  }
  if (taskKey === "tokenize") {
    return result.length;
  }
  if (taskKey === "ner" || taskKey === "dep" || taskKey === "sdp") {
    return result.length;
  }
  return 0;
}

function renderNerHighlightedText(
  sourceText: string,
  rows: Array<Record<string, unknown>>,
  activeEntityIndex?: number | null,
) {
  const text = String(sourceText || "");
  if (!text) {
    return null;
  }
  const entities = rows
    .map((row) => {
      const start = asNumber(row.start);
      const end = asNumber(row.end);
      if (start === null || end === null) {
        return null;
      }
      const label = String(row.label || "").trim() || "ENTITY";
      return {
        start: Math.max(0, Math.min(start, text.length)),
        end: Math.max(0, Math.min(end, text.length)),
        label,
      };
    })
    .filter((item): item is { start: number; end: number; label: string } => Boolean(item))
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);

  if (entities.length === 0) {
    return null;
  }

  const blocks: Array<{ text: string; label?: string; isEntity: boolean; entityIndex?: number }> = [];
  let cursor = 0;
  for (const [entityIndex, entity] of entities.entries()) {
    if (entity.start < cursor) {
      continue;
    }
    if (entity.start > cursor) {
      blocks.push({ text: text.slice(cursor, entity.start), isEntity: false });
    }
    blocks.push({ text: text.slice(entity.start, entity.end), label: entity.label, isEntity: true, entityIndex });
    cursor = entity.end;
  }
  if (cursor < text.length) {
    blocks.push({ text: text.slice(cursor), isEntity: false });
  }

  return (
    <div className={styles.demoHighlightBox}>
      {blocks.map((block, index) =>
        block.isEntity ? (
          <span
            key={`entity-${index}`}
            className={`${styles.demoHighlightEntity} ${block.entityIndex === activeEntityIndex ? styles.demoHighlightEntityActive : ""}`}
          >
            {block.text}
            <span className={styles.demoHighlightLabel}>{block.label}</span>
          </span>
        ) : (
          <span key={`text-${index}`}>{block.text}</span>
        ),
      )}
    </div>
  );
}

function renderRecordRows(
  rows: Array<Record<string, unknown>>,
  preferredColumns: string[],
  options?: {
    interactive?: boolean;
    selectedRowIndex?: number | null;
    hoveredRowIndex?: number | null;
    onSelectRow?: (index: number | null) => void;
    onHoverRow?: (index: number | null) => void;
  },
) {
  if (rows.length === 0) {
    return <Typography.Text type="secondary">No rows returned.</Typography.Text>;
  }

  const firstRowKeys = Object.keys(rows[0] || {});
  const remainingKeys = firstRowKeys.filter((key) => !preferredColumns.includes(key));
  const columns = [...preferredColumns, ...remainingKeys].filter((key) =>
    rows.some((row) => row[key] !== undefined),
  );

  if (columns.length === 0) {
    return (
      <Typography.Paragraph className={styles.operationOutput}>
        {prettyJson(rows)}
      </Typography.Paragraph>
    );
  }

  return (
    <div className={styles.demoTable}>
      <div className={styles.demoTableHeader} style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
        {columns.map((column) => (
          <span key={`header-${column}`}>{column}</span>
        ))}
      </div>
      {rows.map((row, index) => {
        const highlighted = (options?.hoveredRowIndex ?? options?.selectedRowIndex) === index;
        if (options?.interactive && options.onSelectRow) {
          return (
            <button
              type="button"
              key={`row-${index}`}
              className={`${styles.demoTableRow} ${highlighted ? styles.demoTableRowActive : ""}`}
              style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
              onClick={() => options.onSelectRow?.(options.selectedRowIndex === index ? null : index)}
              onMouseEnter={() => options.onHoverRow?.(index)}
              onMouseLeave={() => options.onHoverRow?.(null)}
            >
              {columns.map((column) => (
                <span key={`row-${index}-${column}`}>{String(row[column] ?? "")}</span>
              ))}
            </button>
          );
        }
        return (
          <div
            key={`row-${index}`}
            className={styles.demoTableRow}
            style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
          >
            {columns.map((column) => (
              <span key={`row-${index}-${column}`}>{String(row[column] ?? "")}</span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function renderResultByTask(
  taskKey: string,
  result: unknown,
  sourceText: string,
  activeRowIndex: number | null,
  hoveredRowIndex: number | null,
  onSelectRow: (index: number | null) => void,
  onHoverRow: (index: number | null) => void,
) {
  const highlightedRowIndex = hoveredRowIndex ?? activeRowIndex;
  if (taskKey === "tokenize") {
    const tokens = Array.isArray(result) ? result : [];
    return (
      <>
        <div className={styles.demoTokenWrap}>
          {tokens.length === 0 ? (
            <Typography.Text type="secondary">No tokens returned.</Typography.Text>
          ) : (
            tokens.map((token, index) => (
              <Tag
                key={`${String(token)}-${index}`}
                className={`${styles.demoChip} ${highlightedRowIndex === index ? styles.demoChipActive : ""}`}
                onClick={() => onSelectRow(activeRowIndex === index ? null : index)}
              >
                {String(token)}
              </Tag>
            ))
          )}
        </div>
        {renderTokenRail(tokens.map((token) => String(token)), highlightedRowIndex)}
      </>
    );
  }

  if (taskKey === "ner" && Array.isArray(result)) {
    const rows = result
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    return (
      <>
        <div className={styles.demoTable}>
          <div className={styles.demoTableHeader}>
            <span>Text</span>
            <span>Label</span>
            <span>Span</span>
          </div>
          {rows.map((row, index) => (
            <button
              type="button"
              key={`ner-row-${index}`}
              className={`${styles.demoTableRow} ${highlightedRowIndex === index ? styles.demoTableRowActive : ""}`}
              onClick={() => onSelectRow(activeRowIndex === index ? null : index)}
              onMouseEnter={() => onHoverRow(index)}
              onMouseLeave={() => onHoverRow(null)}
            >
              <span>{String(row.text || "")}</span>
              <span>{String(row.label || "")}</span>
              <span>{`${String(row.start ?? "")}-${String(row.end ?? "")}`}</span>
            </button>
          ))}
        </div>
        {renderNerHighlightedText(sourceText, rows, highlightedRowIndex)}
      </>
    );
  }

  if (taskKey === "dep" && Array.isArray(result)) {
    const rows = result
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    const tokens = rows.map((row) => String(row.token || row.text || row.word || "")).filter(Boolean);
    return (
      <>
        <div className={styles.demoTable}>
          <div className={styles.demoTableHeader}>
            <span>Token</span>
            <span>Head</span>
            <span>DepRel</span>
          </div>
          {rows.map((row, index) => (
            <button
              type="button"
              key={`dep-row-${index}`}
              className={`${styles.demoTableRow} ${highlightedRowIndex === index ? styles.demoTableRowActive : ""}`}
              onClick={() => onSelectRow(activeRowIndex === index ? null : index)}
              onMouseEnter={() => onHoverRow(index)}
              onMouseLeave={() => onHoverRow(null)}
            >
              <span>{String(row.token || "")}</span>
              <span>{String(row.head ?? "")}</span>
              <span>{String(row.deprel || "")}</span>
            </button>
          ))}
        </div>
        {renderTokenRail(tokens, highlightedRowIndex)}
      </>
    );
  }

  if (taskKey === "sdp") {
    if (Array.isArray(result)) {
      const rows = result
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item));
      const tokens = rows.map((row) => String(row.token || row.text || row.word || "")).filter(Boolean);
      return (
        <>
          {renderRecordRows(rows, ["token", "head", "deprel", "relation", "score"], {
            interactive: true,
            selectedRowIndex: activeRowIndex,
            hoveredRowIndex,
            onSelectRow,
            onHoverRow,
          })}
          {renderTokenRail(tokens, highlightedRowIndex)}
        </>
      );
    }
    const record = asRecord(result);
    if (record) {
      return renderRecordRows([record], ["task", "text", "status"]);
    }
  }

  if (taskKey === "con") {
    if (typeof result === "string") {
      return (
        <Typography.Paragraph className={styles.operationOutput}>
          {result}
        </Typography.Paragraph>
      );
    }
    if (Array.isArray(result)) {
      const rows = result
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item));
      return renderRecordRows(rows, ["label", "text", "start", "end"]);
    }
    const record = asRecord(result);
    if (record) {
      const treeLike = record.tree || record.bracket || record.parse;
      if (typeof treeLike === "string") {
        return (
          <Typography.Paragraph className={styles.operationOutput}>
            {treeLike}
          </Typography.Paragraph>
        );
      }
      return renderRecordRows([record], ["task", "text", "status"]);
    }
  }

  if (taskKey === "cor") {
    if (Array.isArray(result)) {
      const maybeCluster = result.every((item) => Array.isArray(item));
      if (maybeCluster) {
        return (
          <div className={styles.demoClusterWrap}>
            {result.map((cluster, clusterIndex) => (
              <div key={`cluster-${clusterIndex}`} className={styles.demoClusterCard}>
                <Typography.Text strong>Cluster {clusterIndex + 1}</Typography.Text>
                <div className={styles.demoTokenWrap}>
                  {(cluster as unknown[]).map((mention, mentionIndex) => (
                    <Tag key={`cluster-${clusterIndex}-${mentionIndex}`} className={styles.demoChip}>
                      {String(mention)}
                    </Tag>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      }
      const rows = result
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item));
      return renderRecordRows(rows, ["mention", "cluster", "start", "end"]);
    }
    const record = asRecord(result);
    if (record) {
      return renderRecordRows([record], ["task", "text", "status"]);
    }
  }

  return (
    <Typography.Paragraph className={styles.operationOutput}>
      {prettyJson(result)}
    </Typography.Paragraph>
  );
}

function NlpPage() {
  const { t } = useTranslation();
  const {
    loading,
    installing,
    downloadingModel,
    savingStrategy,
    dryRunningDecision,
    status,
    provider,
    hanlpProviderActive,
    lastManualSteps,
    lastOperations,
    sidecarReady,
    modelReady,
    fetchStatus,
    handleInstall,
    handleDownloadModel,
    handleUpdateStrategy,
    handleDryRunStrategy,
    lastStrategyDecision,
    runMethodDemo,
    runningDemoTask,
    demoResults,
  } = useNlp();

  const taskStates = status?.tasks ?? {};
  const strategy = status?.strategy;
  const autoClassical = strategy?.auto_classical_chinese;
  const overrideEntries = Object.entries(strategy?.task_overrides ?? {});
  const [modeDraft, setModeDraft] = useState<"auto" | "manual" | "hybrid">("auto");
  const [defaultModelDraft, setDefaultModelDraft] = useState("");
  const [autoEnabledDraft, setAutoEnabledDraft] = useState(true);
  const [thresholdDraft, setThresholdDraft] = useState<number>(0.22);
  const [classicalModelDraft, setClassicalModelDraft] = useState("");
  const [taskOverridesText, setTaskOverridesText] = useState("{}");
  const [strategyParseError, setStrategyParseError] = useState("");
  const [previewTaskKey, setPreviewTaskKey] = useState("ner");
  const [previewText, setPreviewText] = useState("吾之道也");
  const [demoInputs, setDemoInputs] = useState<Record<string, string>>({});
  const [activeDemoTaskKey, setActiveDemoTaskKey] = useState("tokenize");
  const [activeDemoRowIndex, setActiveDemoRowIndex] = useState<number | null>(null);
  const [hoveredDemoRowIndex, setHoveredDemoRowIndex] = useState<number | null>(null);
  const [activeAnchorSection, setActiveAnchorSection] = useState<string>("nlp-section-demo");
  const [sideGroupKeys, setSideGroupKeys] = useState<string[]>(["strategy", "runtime"]);

  useEffect(() => {
    if (Object.keys(demoInputs).length > 0) {
      return;
    }
    const initial = Object.fromEntries(
      DEMO_METHODS.map((item) => [item.backendTaskKey, item.examples[0] || ""]),
    ) as Record<string, string>;
    setDemoInputs(initial);
  }, [demoInputs]);

  useEffect(() => {
    const nextMode = strategy?.mode === "manual" || strategy?.mode === "hybrid" ? strategy.mode : "auto";
    setModeDraft(nextMode);
    setDefaultModelDraft(strategy?.default_model_id || status?.model.model_id || "");
    setAutoEnabledDraft(Boolean(autoClassical?.enabled ?? true));
    setThresholdDraft(typeof autoClassical?.threshold === "number" ? autoClassical.threshold : 0.22);
    setClassicalModelDraft(autoClassical?.model_id || "");
    setTaskOverridesText(JSON.stringify(strategy?.task_overrides ?? {}, null, 2));
    setStrategyParseError("");
  }, [
    autoClassical?.enabled,
    autoClassical?.model_id,
    autoClassical?.threshold,
    status?.model.model_id,
    strategy?.default_model_id,
    strategy?.mode,
    strategy?.task_overrides,
  ]);

  const handleSaveStrategy = async () => {
    let parsedOverrides: Record<string, string> = {};
    const rawText = taskOverridesText.trim();
    if (rawText) {
      try {
        const parsed = JSON.parse(rawText) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          setStrategyParseError("");
          parsedOverrides = Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
              String(key || "").trim(),
              String(value || "").trim(),
            ]).filter(([key, value]) => key && value),
          );
        } else {
          setStrategyParseError("Task overrides must be a JSON object.");
          return;
        }
      } catch {
        setStrategyParseError("Task overrides JSON is invalid.");
        return;
      }
    }

    await handleUpdateStrategy({
      mode: modeDraft,
      default_model_id: defaultModelDraft.trim(),
      task_overrides: parsedOverrides,
      auto_classical_chinese: {
        enabled: autoEnabledDraft,
        threshold: Number.isFinite(thresholdDraft) ? thresholdDraft : 0.22,
        model_id: classicalModelDraft.trim(),
      },
    });
  };

  const methods: Array<{ key: string; taskKey?: string; status: MethodStatus }> = [
    {
      key: "tokenize",
      status: sidecarReady
        ? modelReady
          ? {
              status: "ready",
              reasonCode: "HANLP2_MODEL_READY",
              reason: t("nlpConfig.methods.tokenize.readyReason"),
            }
          : {
              status: "unavailable",
              reasonCode: status?.model.reason_code || "HANLP2_MODEL_LOAD_FAILED",
              reason: status?.model.reason || t("nlpConfig.methods.tokenize.unavailableReason"),
            }
        : {
            status: "unavailable",
            reasonCode: status?.sidecar.reason_code || "HANLP2_SIDECAR_UNCONFIGURED",
            reason: status?.sidecar.reason || t("nlpConfig.methods.tokenize.unavailableReason"),
          },
    },
    {
      key: "nerMsra",
      taskKey: "ner_msra",
      status: {
        status: taskStates.ner_msra?.status || "unavailable",
        reasonCode: taskStates.ner_msra?.reason_code || "HANLP2_TASK_NOT_CONFIGURED",
        reason: taskStates.ner_msra?.reason || t("nlpConfig.methods.defaultUnavailableReason"),
      },
    },
    {
      key: "dep",
      taskKey: "dep",
      status: {
        status: taskStates.dep?.status || "unavailable",
        reasonCode: taskStates.dep?.reason_code || "HANLP2_TASK_NOT_CONFIGURED",
        reason: taskStates.dep?.reason || t("nlpConfig.methods.defaultUnavailableReason"),
      },
    },
    {
      key: "sdp",
      taskKey: "sdp",
      status: {
        status: taskStates.sdp?.status || "unavailable",
        reasonCode: taskStates.sdp?.reason_code || "HANLP2_TASK_NOT_CONFIGURED",
        reason: taskStates.sdp?.reason || t("nlpConfig.methods.defaultUnavailableReason"),
      },
    },
    {
      key: "con",
      taskKey: "con",
      status: {
        status: taskStates.con?.status || "unavailable",
        reasonCode: taskStates.con?.reason_code || "HANLP2_TASK_NOT_CONFIGURED",
        reason: taskStates.con?.reason || t("nlpConfig.methods.defaultUnavailableReason"),
      },
    },
    {
      key: "cor",
      taskKey: "cor",
      status: {
        status: taskStates.cor?.status || "unavailable",
        reasonCode: taskStates.cor?.reason_code || "HANLP2_COREF_NOT_OPEN_SOURCE",
        reason: taskStates.cor?.reason || t("nlpConfig.methods.cor.unavailableReason"),
      },
    },
  ];

  const methodStatusByTask: Record<string, MethodStatus> = {
    tokenize: methods.find((item) => item.key === "tokenize")?.status || {
      status: "unavailable",
      reasonCode: "UNKNOWN",
      reason: "No status available",
    },
    ner: methods.find((item) => item.key === "nerMsra")?.status || {
      status: "unavailable",
      reasonCode: "UNKNOWN",
      reason: "No status available",
    },
    dep: methods.find((item) => item.key === "dep")?.status || {
      status: "unavailable",
      reasonCode: "UNKNOWN",
      reason: "No status available",
    },
    sdp: methods.find((item) => item.key === "sdp")?.status || {
      status: "unavailable",
      reasonCode: "UNKNOWN",
      reason: "No status available",
    },
    con: methods.find((item) => item.key === "con")?.status || {
      status: "unavailable",
      reasonCode: "UNKNOWN",
      reason: "No status available",
    },
    cor: methods.find((item) => item.key === "cor")?.status || {
      status: "unavailable",
      reasonCode: "UNKNOWN",
      reason: "No status available",
    },
  };

  const activeDemoMethod = DEMO_METHODS.find((item) => item.backendTaskKey === activeDemoTaskKey) || DEMO_METHODS[0];
  const activeDemoInput = demoInputs[activeDemoMethod.backendTaskKey] || "";
  const activeDemoStatus = methodStatusByTask[activeDemoMethod.backendTaskKey] || {
    status: "unavailable",
    reasonCode: "UNKNOWN",
    reason: "No status available",
  };
  const activeDemoResult = (demoResults[activeDemoMethod.backendTaskKey] || null) as NlpDemoMeta | null;
  const activeSelectableCount = getSelectableCount(
    activeDemoMethod.backendTaskKey,
    activeDemoResult?.result,
  );
  const activeResultTokens = getTokenListFromResult(
    activeDemoMethod.backendTaskKey,
    activeDemoResult?.result,
  );
  const methodStatuses = Object.values(methodStatusByTask);
  const readyMethodCount = methodStatuses.filter((item) => item.status === "ready").length;
  const unavailableMethodCount = methodStatuses.length - readyMethodCount;

  useEffect(() => {
    setActiveDemoRowIndex(null);
    setHoveredDemoRowIndex(null);
  }, [activeDemoMethod.backendTaskKey, activeDemoResult?.request_id]);

  useEffect(() => {
    const raw = window.localStorage.getItem("copaw-nlp-side-groups");
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const cleaned = parsed
          .map((item) => String(item || "").trim())
          .filter(Boolean);
        if (cleaned.length > 0) {
          setSideGroupKeys(cleaned);
        }
      }
    } catch {
      // ignore malformed local cache
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("copaw-nlp-side-groups", JSON.stringify(sideGroupKeys));
  }, [sideGroupKeys]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
      return;
    }

    const candidates = NAV_SECTION_IDS
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => Boolean(element));

    if (candidates.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible.length === 0) {
          return;
        }
        const id = visible[0].target.id;
        if (id) {
          setActiveAnchorSection(id);
        }
      },
      {
        root: null,
        rootMargin: "-120px 0px -55% 0px",
        threshold: [0.2, 0.5, 0.8],
      },
    );

    candidates.forEach((element) => observer.observe(element));
    return () => {
      observer.disconnect();
    };
  }, []);

  const handleDemoResultKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (!activeDemoResult || activeSelectableCount <= 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = activeDemoRowIndex === null ? 0 : (activeDemoRowIndex + 1) % activeSelectableCount;
      setActiveDemoRowIndex(next);
      setHoveredDemoRowIndex(null);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const next =
        activeDemoRowIndex === null
          ? activeSelectableCount - 1
          : (activeDemoRowIndex - 1 + activeSelectableCount) % activeSelectableCount;
      setActiveDemoRowIndex(next);
      setHoveredDemoRowIndex(null);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setActiveDemoRowIndex(null);
      setHoveredDemoRowIndex(null);
    }
  };

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (!element) {
      return;
    }
    setActiveAnchorSection(sectionId);
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className={styles.nlpPage}>
      <PageHeader
        items={[
          { title: t("nav.settings") },
          { title: t("nlpConfig.title") },
        ]}
      />

      <div className={styles.content}>
        <div className={styles.alertStack}>
          {loading ? (
            <Alert
              type="info"
              showIcon
              message="Loading NLP runtime status"
              description={<Space size={8}><Spin size="small" /><span>页面已可用，运行态信息正在刷新。</span></Space>}
            />
          ) : null}

          <Alert
            type="info"
            showIcon
            message={t("nlpConfig.infoTitle")}
            description={t("nlpConfig.infoDescription")}
          />

          <Alert
            type={hanlpProviderActive ? "success" : "warning"}
            showIcon
            message={t("nlpConfig.providerMessage", { provider: provider || "hanlp" })}
            description={
              hanlpProviderActive
                ? t("nlpConfig.providerActive")
                : t("nlpConfig.providerInactive")
            }
          />

          {status?.sidecar.reason_code === "HANLP2_FULL_INSTALL_REQUIRED" ? (
            <Alert
              type="warning"
              showIcon
              message={t("nlpConfig.fullInstallTitle")}
              description={t("nlpConfig.fullInstallDescription")}
            />
          ) : null}
        </div>

        <div className={styles.kpiGrid}>
          <Card className={styles.metricCard}>
            <Typography.Text type="secondary">Demo Coverage</Typography.Text>
            <Typography.Title level={4} className={styles.metricValue}>
              {readyMethodCount}/{methodStatuses.length}
            </Typography.Title>
            <Typography.Text type="secondary">Methods ready</Typography.Text>
          </Card>
          <Card className={styles.metricCard}>
            <Typography.Text type="secondary">Unavailable</Typography.Text>
            <Typography.Title level={4} className={styles.metricValue}>
              {unavailableMethodCount}
            </Typography.Title>
            <Typography.Text type="secondary">Need configuration</Typography.Text>
          </Card>
          <Card className={styles.metricCard}>
            <Typography.Text type="secondary">Model</Typography.Text>
            <Typography.Title level={5} className={styles.metricLabel}>
              {status?.model.model_id || t("nlpConfig.notConfigured")}
            </Typography.Title>
            <Tag color={modelReady ? "success" : "warning"}>{status?.model.reason_code || status?.model.status}</Tag>
          </Card>
          <Card className={styles.metricCard}>
            <Typography.Text type="secondary">Strategy Mode</Typography.Text>
            <Typography.Title level={4} className={styles.metricValue}>
              {strategy?.mode || "auto"}
            </Typography.Title>
            <Typography.Text type="secondary">Default: {strategy?.default_model_id || "(inherit)"}</Typography.Text>
          </Card>
        </div>

        <Card className={`${styles.card} ${styles.sectionNavCard}`}>
          <Typography.Title level={5} className={styles.cardTitle}>
            Workbench Navigation
          </Typography.Title>
          <Typography.Paragraph type="secondary" className={styles.cardDescription}>
            快速跳转到演示、策略、健康与维护区域。
          </Typography.Paragraph>
          <Space wrap className={styles.navButtonWrap}>
            <Button
              size="small"
              className={activeAnchorSection === "nlp-section-demo" ? styles.sectionNavButtonActive : ""}
              onClick={() => scrollToSection("nlp-section-demo")}
            >
              Demo Lab
            </Button>
            <Button
              size="small"
              className={activeAnchorSection === "nlp-section-methods" ? styles.sectionNavButtonActive : ""}
              onClick={() => scrollToSection("nlp-section-methods")}
            >
              Methods Matrix
            </Button>
            <Button
              size="small"
              className={activeAnchorSection === "nlp-section-strategy" ? styles.sectionNavButtonActive : ""}
              onClick={() => scrollToSection("nlp-section-strategy")}
            >
              Strategy
            </Button>
            <Button
              size="small"
              className={activeAnchorSection === "nlp-section-dryrun" ? styles.sectionNavButtonActive : ""}
              onClick={() => scrollToSection("nlp-section-dryrun")}
            >
              Dry-Run
            </Button>
            <Button
              size="small"
              className={activeAnchorSection === "nlp-section-runtime" ? styles.sectionNavButtonActive : ""}
              onClick={() => scrollToSection("nlp-section-runtime")}
            >
              Runtime
            </Button>
            <Button
              size="small"
              className={activeAnchorSection === "nlp-section-maintenance" ? styles.sectionNavButtonActive : ""}
              onClick={() => scrollToSection("nlp-section-maintenance")}
            >
              Maintenance
            </Button>
          </Space>
        </Card>

        <div className={styles.workspaceLayout}>
          <div className={styles.primaryColumn}>
            <div id="nlp-section-demo" className={styles.sectionAnchorOffset}>
              <Card className={`${styles.card} ${styles.primaryCard}`}>
                <Typography.Title level={5} className={styles.cardTitle}>
                  NLP Method Demos
                </Typography.Title>
                <Typography.Paragraph type="secondary" className={styles.cardDescription}>
                  首屏工作区：选择任务、填入示例、运行并查看结构化结果与映射高亮。
                </Typography.Paragraph>
                <div className={styles.demoWorkbench}>
                  <div className={styles.demoMethodList}>
                    {DEMO_METHODS.map((method) => {
                      const methodStatus = methodStatusByTask[method.backendTaskKey];
                      const active = method.backendTaskKey === activeDemoMethod.backendTaskKey;
                      return (
                        <button
                          key={method.backendTaskKey}
                          type="button"
                          className={`${styles.demoMethodButton} ${active ? styles.demoMethodButtonActive : ""}`}
                          onClick={() => setActiveDemoTaskKey(method.backendTaskKey)}
                        >
                          <span>{method.title}</span>
                          <Tag color={resolveTagColor(methodStatus?.status || "unavailable")}>{methodStatus?.reasonCode || "UNKNOWN"}</Tag>
                        </button>
                      );
                    })}
                  </div>
                  <div className={styles.demoPanel}>
                    <div className={styles.demoInputPanel}>
                      <Typography.Title level={5} className={styles.cardTitle}>
                        {activeDemoMethod.title}
                      </Typography.Title>
                      <Typography.Paragraph type="secondary" className={styles.cardDescription}>
                        {activeDemoStatus.reason}
                      </Typography.Paragraph>
                      <Space wrap size={8} className={styles.demoExamples}>
                        {activeDemoMethod.examples.map((sample, index) => (
                          <Button
                            key={`${activeDemoMethod.backendTaskKey}-${index}`}
                            size="small"
                            onClick={() =>
                              setDemoInputs((prev) => ({
                                ...prev,
                                [activeDemoMethod.backendTaskKey]: sample,
                              }))
                            }
                          >
                            示例 {index + 1}
                          </Button>
                        ))}
                      </Space>
                      <Input.TextArea
                        rows={6}
                        value={activeDemoInput}
                        placeholder={activeDemoMethod.placeholder}
                        onChange={(event) =>
                          setDemoInputs((prev) => ({
                            ...prev,
                            [activeDemoMethod.backendTaskKey]: event.target.value,
                          }))
                        }
                      />
                      <Button
                        type="primary"
                        loading={runningDemoTask === activeDemoMethod.backendTaskKey}
                        onClick={() => runMethodDemo(activeDemoMethod.backendTaskKey, activeDemoInput)}
                      >
                        运行测试
                      </Button>
                    </div>
                    <div className={styles.demoResultPanel}>
                      <Typography.Title level={5} className={styles.cardTitle}>
                        结果面板
                      </Typography.Title>
                      <Typography.Text type="secondary">
                        支持交互：点击结果行高亮映射，或在本区域按 ↑/↓ 键逐行浏览，按 Esc 清空选择。
                      </Typography.Text>
                      {!activeDemoResult ? (
                        <Typography.Paragraph type="secondary" className={styles.cardDescription}>
                          点击“运行测试”查看结构化输出。
                        </Typography.Paragraph>
                      ) : (
                        <>
                          <div className={styles.demoMetaGrid}>
                            <div className={styles.demoMetaItem}><span>status</span><Tag color={resolveTagColor(activeDemoResult.status)}>{activeDemoResult.reason_code}</Tag></div>
                            <div className={styles.demoMetaItem}><span>task</span><span>{activeDemoResult.task_key}</span></div>
                            <div className={styles.demoMetaItem}><span>model</span><span>{activeDemoResult.resolved_model || "(empty)"}</span></div>
                            <div className={styles.demoMetaItem}><span>style</span><span>{activeDemoResult.detected_style}</span></div>
                            <div className={styles.demoMetaItem}><span>score</span><span>{activeDemoResult.detection_score}</span></div>
                            <div className={styles.demoMetaItem}><span>duration</span><span>{activeDemoResult.duration_ms} ms</span></div>
                          </div>
                          <Typography.Paragraph className={styles.operationOutput}>
                            {activeDemoResult.reason}
                          </Typography.Paragraph>
                          <div
                            className={styles.demoInteractiveArea}
                            tabIndex={0}
                            onKeyDown={handleDemoResultKeyDown}
                          >
                            {renderResultByTask(
                              activeDemoMethod.backendTaskKey,
                              activeDemoResult.result,
                              activeDemoInput,
                              activeDemoRowIndex,
                              hoveredDemoRowIndex,
                              setActiveDemoRowIndex,
                              setHoveredDemoRowIndex,
                            )}
                          </div>
                          {activeResultTokens.length > 0 ? (
                            <Typography.Text type="secondary">
                              当前 token 数：{activeResultTokens.length}
                            </Typography.Text>
                          ) : null}
                          <Typography.Paragraph className={styles.operationOutput}>
                            rules: {(activeDemoResult.matched_rules || []).join(", ") || "(none)"}
                          </Typography.Paragraph>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            <div id="nlp-section-methods" className={styles.sectionAnchorOffset}>
              <Card className={styles.card}>
                <Typography.Title level={5} className={styles.cardTitle}>
                  {t("nlpConfig.methodsTitle")}
                </Typography.Title>
                <Typography.Paragraph type="secondary" className={styles.cardDescription}>
                  {t("nlpConfig.methodsDescription")}
                </Typography.Paragraph>
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  {methods.map((method) => (
                    <div key={method.key} className={styles.operationBlock}>
                      <div className={styles.statusRow}>
                        <Typography.Text strong>{t(`nlpConfig.methods.${method.key}.name`)}</Typography.Text>
                        <Tag color={resolveTagColor(method.status.status)}>
                          {method.status.reasonCode || method.status.status}
                        </Tag>
                      </div>
                      <Typography.Paragraph className={styles.operationOutput}>
                        {t(`nlpConfig.methods.${method.key}.description`)}
                      </Typography.Paragraph>
                      <Typography.Text type="secondary">{method.status.reason}</Typography.Text>
                      {method.taskKey ? (
                        <Typography.Text type="secondary">
                          {` `}
                          {t("nlpConfig.taskKey")} {method.taskKey}
                        </Typography.Text>
                      ) : null}
                    </div>
                  ))}
                </Space>
              </Card>
            </div>
          </div>

          <div className={styles.sideColumn}>
            <Collapse
              className={styles.sideGroupCollapse}
              activeKey={sideGroupKeys}
              onChange={(keys) => {
                const nextKeys = Array.isArray(keys)
                  ? keys.map((item) => String(item))
                  : [String(keys)];
                setSideGroupKeys(nextKeys);
              }}
              items={[
                {
                  key: "strategy",
                  label: "Strategy Console",
                  children: (
                    <Space direction="vertical" size={16} style={{ width: "100%" }}>
                      <div id="nlp-section-strategy" className={styles.sectionAnchorOffset}>
                        <Card className={styles.card}>
                          <Typography.Title level={5} className={styles.cardTitle}>
                            Model Selection Strategy
                          </Typography.Title>
                          <Typography.Paragraph type="secondary" className={styles.cardDescription}>
                            Request-scoped policy used by backend auto-adaptation.
                          </Typography.Paragraph>
                          <Space direction="vertical" size={12} style={{ width: "100%" }}>
                            <div className={styles.statusRow}>
                              <span>Mode</span>
                              <Tag color={strategy?.mode === "manual" ? "default" : "processing"}>
                                {strategy?.mode || "auto"}
                              </Tag>
                            </div>
                            <div className={styles.statusRow}>
                              <span>Edit mode</span>
                              <Select
                                value={modeDraft}
                                style={{ width: 180 }}
                                options={[
                                  { label: "auto", value: "auto" },
                                  { label: "manual", value: "manual" },
                                  { label: "hybrid", value: "hybrid" },
                                ]}
                                onChange={(value) => setModeDraft(value)}
                              />
                            </div>
                            <Input
                              placeholder="Default model id"
                              value={defaultModelDraft}
                              onChange={(event) => setDefaultModelDraft(event.target.value)}
                            />
                            <div className={styles.statusRow}>
                              <span>Auto classical Chinese</span>
                              <Switch checked={autoEnabledDraft} onChange={setAutoEnabledDraft} />
                            </div>
                            <InputNumber
                              min={0}
                              max={1}
                              step={0.01}
                              value={thresholdDraft}
                              onChange={(value) => setThresholdDraft(typeof value === "number" ? value : 0.22)}
                            />
                            <Input
                              placeholder="Classical Chinese model id"
                              value={classicalModelDraft}
                              onChange={(event) => setClassicalModelDraft(event.target.value)}
                            />
                            <Input.TextArea
                              rows={6}
                              value={taskOverridesText}
                              onChange={(event) => setTaskOverridesText(event.target.value)}
                              placeholder='Task overrides JSON, e.g. {"ner":"model_a"}'
                            />
                            {strategyParseError ? (
                              <Typography.Text type="danger">{strategyParseError}</Typography.Text>
                            ) : null}
                            <Button type="primary" onClick={handleSaveStrategy} loading={savingStrategy}>
                              Save strategy
                            </Button>
                            <Typography.Text>
                              Default model: {strategy?.default_model_id || status?.model.model_id || t("nlpConfig.notConfigured")}
                            </Typography.Text>
                            <Typography.Text>
                              Classical Chinese auto-route: {autoClassical?.enabled ? "enabled" : "disabled"}
                            </Typography.Text>
                            <Typography.Text>
                              Detection threshold: {typeof autoClassical?.threshold === "number" ? autoClassical.threshold : 0.22}
                            </Typography.Text>
                            <Typography.Text>
                              Classical target model: {autoClassical?.model_id || t("nlpConfig.notConfigured")}
                            </Typography.Text>
                            <div className={styles.operationBlock}>
                              <Typography.Text strong>Task overrides</Typography.Text>
                              {overrideEntries.length === 0 ? (
                                <Typography.Paragraph className={styles.operationOutput}>
                                  No task-level overrides configured.
                                </Typography.Paragraph>
                              ) : (
                                overrideEntries.map(([taskKey, modelId]) => (
                                  <Typography.Paragraph key={`${taskKey}:${modelId}`} className={styles.operationOutput}>
                                    {taskKey}: {modelId}
                                  </Typography.Paragraph>
                                ))
                              )}
                            </div>
                          </Space>
                        </Card>
                      </div>

                      <div id="nlp-section-dryrun" className={styles.sectionAnchorOffset}>
                        <Card className={styles.card}>
                          <Typography.Title level={5} className={styles.cardTitle}>
                            Strategy Dry-Run Preview
                          </Typography.Title>
                          <Typography.Paragraph type="secondary" className={styles.cardDescription}>
                            Simulate model selection for current strategy without executing NLP tasks.
                          </Typography.Paragraph>
                          <Space direction="vertical" size={12} style={{ width: "100%" }}>
                            <Select
                              value={previewTaskKey}
                              options={[
                                { label: "ner", value: "ner" },
                                { label: "dep", value: "dep" },
                                { label: "sdp", value: "sdp" },
                                { label: "con", value: "con" },
                                { label: "cor", value: "cor" },
                              ]}
                              onChange={(value) => setPreviewTaskKey(value)}
                              style={{ width: 220 }}
                            />
                            <Input.TextArea
                              rows={4}
                              value={previewText}
                              onChange={(event) => setPreviewText(event.target.value)}
                              placeholder="Enter text for dry-run decision preview"
                            />
                            <Button
                              onClick={() => handleDryRunStrategy(previewText, previewTaskKey)}
                              loading={dryRunningDecision}
                            >
                              Run dry-run
                            </Button>
                            {lastStrategyDecision ? (
                              <div className={styles.operationBlock}>
                                <Typography.Paragraph className={styles.operationOutput}>
                                  task: {lastStrategyDecision.task_key}
                                </Typography.Paragraph>
                                <Typography.Paragraph className={styles.operationOutput}>
                                  mode: {lastStrategyDecision.strategy_mode}
                                </Typography.Paragraph>
                                <Typography.Paragraph className={styles.operationOutput}>
                                  detected_style: {lastStrategyDecision.detected_style}
                                </Typography.Paragraph>
                                <Typography.Paragraph className={styles.operationOutput}>
                                  detection_score: {lastStrategyDecision.detection_score}
                                </Typography.Paragraph>
                                <Typography.Paragraph className={styles.operationOutput}>
                                  selected_model: {lastStrategyDecision.selected_model || "(empty)"}
                                </Typography.Paragraph>
                                <Typography.Paragraph className={styles.operationOutput}>
                                  matched_rules: {(lastStrategyDecision.matched_rules || []).join(", ") || "(none)"}
                                </Typography.Paragraph>
                              </div>
                            ) : null}
                          </Space>
                        </Card>
                      </div>
                    </Space>
                  ),
                },
                {
                  key: "runtime",
                  label: "Runtime & Logs",
                  children: (
                    <Space direction="vertical" size={16} style={{ width: "100%" }}>
                      <div id="nlp-section-runtime" className={styles.sectionAnchorOffset}>
                        <Card className={styles.card}>
                          <Typography.Title level={5} className={styles.cardTitle}>
                            Runtime Health
                          </Typography.Title>
                          <Space direction="vertical" size={10} style={{ width: "100%" }}>
                            <div className={styles.statusRow}>
                              <span>{t("nlpConfig.sidecarStatus")}</span>
                              <Tag color={sidecarReady ? "success" : "warning"}>{status?.sidecar.reason_code || status?.sidecar.status}</Tag>
                            </div>
                            <Typography.Text type="secondary">{status?.sidecar.reason}</Typography.Text>
                            <Typography.Text>{t("nlpConfig.pythonPath")} {status?.sidecar.python_executable || t("nlpConfig.notConfigured")}</Typography.Text>
                            <Typography.Text>{t("nlpConfig.hanlpHome")} {(status?.sidecar.model_home || status?.sidecar.hanlp_home) || t("nlpConfig.notConfigured")}</Typography.Text>
                            <Typography.Text>
                              {t("nlpConfig.installStrategy", {
                                value: status?.sidecar.uv_available
                                  ? t("nlpConfig.installStrategyUv")
                                  : t("nlpConfig.installStrategyMissingUv"),
                              })}
                            </Typography.Text>
                            <Typography.Text>{t("nlpConfig.uvPath")} {status?.sidecar.uv_executable || t("nlpConfig.notConfigured")}</Typography.Text>
                            <div className={styles.statusRow}>
                              <span>{t("nlpConfig.modelStatus")}</span>
                              <Tag color={modelReady ? "success" : sidecarReady ? "warning" : "default"}>{status?.model.reason_code || status?.model.status}</Tag>
                            </div>
                            <Typography.Text type="secondary">{status?.model.reason}</Typography.Text>
                            <Typography.Text>{t("nlpConfig.modelId")} {status?.model.model_id || t("nlpConfig.notConfigured")}</Typography.Text>
                          </Space>
                        </Card>
                      </div>

                      {lastManualSteps.length > 0 ? (
                        <Alert
                          type="warning"
                          showIcon
                          message={t("nlpConfig.manualStepsTitle")}
                          description={
                            <div>
                              {lastManualSteps.map((step) => (
                                <div key={step}>{step}</div>
                              ))}
                            </div>
                          }
                        />
                      ) : null}

                      {lastOperations.length > 0 ? (
                        <Card className={styles.card}>
                          <Typography.Title level={5} className={styles.cardTitle}>
                            {t("nlpConfig.operationsTitle")}
                          </Typography.Title>
                          <Space direction="vertical" size={12} style={{ width: "100%" }}>
                            {lastOperations.map((operation) => (
                              <div key={`${operation.name}-${operation.command}`} className={styles.operationBlock}>
                                <div className={styles.statusRow}>
                                  <Typography.Text strong>{operation.name}</Typography.Text>
                                  <Tag color={operation.ok ? "success" : "error"}>
                                    {operation.ok ? t("nlpConfig.operationOk") : t("nlpConfig.operationFailed")}
                                  </Tag>
                                </div>
                                <Typography.Text type="secondary">
                                  {operation.command || operation.installer || t("nlpConfig.notConfigured")}
                                </Typography.Text>
                                {operation.output ? (
                                  <Typography.Paragraph className={styles.operationOutput}>
                                    {operation.output}
                                  </Typography.Paragraph>
                                ) : null}
                              </div>
                            ))}
                          </Space>
                        </Card>
                      ) : null}
                    </Space>
                  ),
                },
              ]}
            />
          </div>
        </div>

        <div id="nlp-section-maintenance" className={styles.sectionAnchorOffset}>
          <Card className={styles.card}>
          <Typography.Title level={5} className={styles.cardTitle}>
            Environment Maintenance
          </Typography.Title>
          <Typography.Paragraph type="secondary" className={styles.cardDescription}>
            环境治理操作保留在底部，不干扰首屏实验流。
          </Typography.Paragraph>
          <Space size={8}>
            <Button onClick={fetchStatus} disabled={installing || downloadingModel}>
              {t("common.refresh")}
            </Button>
            <Button
              type="primary"
              onClick={handleInstall}
              loading={installing}
              disabled={downloadingModel || sidecarReady || !hanlpProviderActive}
            >
              {sidecarReady ? t("nlpConfig.sidecarReady") : t("nlpConfig.installButton")}
            </Button>
            <Button
              onClick={handleDownloadModel}
              loading={downloadingModel}
              disabled={installing || !sidecarReady || modelReady || !hanlpProviderActive}
            >
              {modelReady ? t("nlpConfig.modelReady") : t("nlpConfig.downloadButton")}
            </Button>
          </Space>
          </Card>
        </div>
      </div>

    </div>
  );
}

export default NlpPage;