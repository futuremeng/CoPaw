import { Button } from "@agentscope-ai/design";
import { Alert, Card, Input, Space, Switch, Tag, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEventHandler } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { useNlp } from "./useNlp";
import styles from "./index.module.less";

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
  raw_result?: unknown;
  pretty_print?: string;
  resolved_model: string;
  strategy_mode: string;
  detected_style: string;
  detection_score: number;
  matched_rules: string[];
  fallback_used: boolean;
  duration_ms: number;
  model_cache_path?: string;
  runtime_python_executable?: string;
  effective_task_model_id?: string;
  preload_status?: string;
  sidecar_elapsed_ms?: number;
  sidecar_trace_elapsed_ms?: number;
  sidecar_execution_path?: string;
  sidecar_execution_detail?: string;
  sidecar_trace_stage_ms?: Record<string, number>;
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
    key: "pos_ctb",
    backendTaskKey: "pos_ctb",
    title: "POS Tagging (CTB9)",
    placeholder: "输入词性标注文本，例如：微软发布新模型。",
    examples: ["微软发布新模型。", "我们在北京举行会议。"],
  },
  {
    key: "pos_pku",
    backendTaskKey: "pos_pku",
    title: "POS Tagging (PKU)",
    placeholder: "输入词性标注文本，例如：微软发布新模型。",
    examples: ["微软发布新模型。", "我们在北京举行会议。"],
  },
  {
    key: "pos_863",
    backendTaskKey: "pos_863",
    title: "POS Tagging (863)",
    placeholder: "输入词性标注文本，例如：微软发布新模型。",
    examples: ["微软发布新模型。", "我们在北京举行会议。"],
  },
  {
    key: "dep",
    backendTaskKey: "dep",
    title: "Dependency Parsing",
    placeholder: "输入依存句法分析文本，例如：微软发布新模型。",
    examples: ["微软发布新模型。", "我们在北京举行会议。", "吾之道也。"],
  },
  {
    key: "sdp",
    backendTaskKey: "sdp",
    title: "Semantic Dependency Parsing",
    placeholder: "输入语义依存分析文本，例如：微软发布新模型。",
    examples: ["微软发布新模型。", "我们在北京举行会议。", "吾之道也。"],
  },
  {
    key: "con",
    backendTaskKey: "con",
    title: "Constituency Parsing",
    placeholder: "输入短语结构分析文本，例如：微软发布新模型。",
    examples: ["微软发布新模型。", "我们在北京举行会议。", "吾之道也。"],
  },
];

const CLASSICAL_DEMO_METHODS: DemoMethod[] = [
  {
    key: "lzh_tok_fine",
    backendTaskKey: "lzh_tok_fine",
    title: "古汉语分词（细分）",
    placeholder: "输入古汉语文本，例如：晋太元中，武陵人捕鱼为业。",
    examples: ["晋太元中，武陵人捕鱼为业。", "司馬牛問君子", "吾之道也。"],
  },
  {
    key: "lzh_tok_coarse",
    backendTaskKey: "lzh_tok_coarse",
    title: "古汉语分词（粗分）",
    placeholder: "输入古汉语文本进行粗分词，例如：司馬牛問君子。",
    examples: ["司馬牛問君子", "晋太元中，武陵人捕鱼为业。", "吾之道也。"],
  },
  {
    key: "lzh_lem",
    backendTaskKey: "lzh_lem",
    title: "古汉语词形还原（LEM）",
    placeholder: "输入古汉语文本进行词形还原，例如：晋太元中，武陵人捕鱼为业。",
    examples: ["晋太元中，武陵人捕鱼为业。", "司馬牛問君子", "吾之道也。"],
  },
  {
    key: "lzh_pos_upos",
    backendTaskKey: "lzh_pos_upos",
    title: "古汉语词性（UPOS）",
    placeholder: "输入古汉语文本进行 UPOS 词性标注。",
    examples: ["晋太元中，武陵人捕鱼为业。", "司馬牛問君子", "吾之道也。"],
  },
  {
    key: "lzh_pos_xpos",
    backendTaskKey: "lzh_pos_xpos",
    title: "古汉语词性（XPOS）",
    placeholder: "输入古汉语文本进行 XPOS 词性标注。",
    examples: ["晋太元中，武陵人捕鱼为业。", "司馬牛問君子", "吾之道也。"],
  },
  {
    key: "lzh_pos_pku",
    backendTaskKey: "lzh_pos_pku",
    title: "古汉语词性（PKU）",
    placeholder: "输入古汉语文本进行 PKU 词性标注。",
    examples: ["晋太元中，武陵人捕鱼为业。", "司馬牛問君子", "吾之道也。"],
  },
  {
    key: "lzh_dep",
    backendTaskKey: "lzh_dep",
    title: "古汉语依存句法",
    placeholder: "输入古汉语文本进行依存分析，例如：司馬牛問君子。",
    examples: ["司馬牛問君子", "晋太元中，武陵人捕鱼为业。", "吾之道也。"],
  },
];

function resolveTagColor(status: string): string {
  if (status === "ready") {
    return "success";
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

type OverlayAnnotation = {
  start: number;
  end: number;
  label: string;
  rawLabel: string;
  kind: "ner" | "pos";
  rowIndex?: number;
};

function normalizeNerLabel(value: unknown): { raw: string; display: string } {
  const raw = String(value || "").trim();
  const key = raw.toUpperCase();
  const mapped =
    key === "NS"
      ? "LOCATION"
      : key === "NT"
        ? "ORGANIZATION"
        : key === "NR"
          ? "PERSON"
          : raw;
  if (mapped && raw && mapped !== raw) {
    return { raw, display: `${mapped} (${raw})` };
  }
  return { raw: raw || "ENTITY", display: mapped || raw || "ENTITY" };
}

function normalizeOverlayLabel(label: string): string {
  return String(label || "").trim().toUpperCase();
}

function resolvePosTokenOffset(sourceText: string, token: string, from: number): { start: number; end: number } | null {
  const text = String(sourceText || "");
  const tok = String(token || "");
  if (!text || !tok) {
    return null;
  }
  const direct = text.indexOf(tok, Math.max(0, from));
  if (direct >= 0) {
    return { start: direct, end: direct + tok.length };
  }
  const compactText = text.replace(/\s+/g, "");
  const compactTok = tok.replace(/\s+/g, "");
  if (!compactTok) {
    return null;
  }
  const compactIndex = compactText.indexOf(compactTok);
  if (compactIndex < 0) {
    return null;
  }
  let seen = 0;
  let start = -1;
  let end = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (!/\s/.test(text[i])) {
      if (seen === compactIndex) {
        start = i;
      }
      if (seen === compactIndex + compactTok.length - 1) {
        end = i + 1;
        break;
      }
      seen += 1;
    }
  }
  if (start >= 0 && end > start) {
    return { start, end };
  }
  return null;
}

function buildNerAnnotations(
  sourceText: string,
  rows: Array<Record<string, unknown>>,
): OverlayAnnotation[] {
  const text = String(sourceText || "");
  const items: OverlayAnnotation[] = [];
  rows.forEach((row, rowIndex) => {
    const start = asNumber(row.start);
    const end = asNumber(row.end);
    if (start === null || end === null) {
      return;
    }
    const normalized = normalizeNerLabel(row.label);
    const item: OverlayAnnotation = {
      start: Math.max(0, Math.min(start, text.length)),
      end: Math.max(0, Math.min(end, text.length)),
      label: normalized.display,
      rawLabel: normalizeOverlayLabel(normalized.raw || normalized.display),
      kind: "ner",
      rowIndex,
    };
    if (item.end > item.start) {
      items.push(item);
    }
  });
  return items.sort((a, b) => a.start - b.start || b.end - a.end);
}

function buildPosAnnotations(
  sourceText: string,
  rows: Array<Record<string, unknown>>,
): OverlayAnnotation[] {
  const text = String(sourceText || "");
  let cursor = 0;
  const items: OverlayAnnotation[] = [];
  rows.forEach((row, rowIndex) => {
    const token = String(row.token || row.word || row.text || "");
    const pos = String(row.pos || row.tag || "").trim();
    if (!token || !pos) {
      return;
    }
    const offset = resolvePosTokenOffset(text, token, cursor);
    if (!offset) {
      return;
    }
    cursor = Math.max(cursor, offset.end);
    items.push({
      start: offset.start,
      end: offset.end,
      label: pos,
      rawLabel: normalizeOverlayLabel(pos),
      kind: "pos",
      rowIndex,
    });
  });
  return items;
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
  if ((taskKey === "tokenize" || taskKey === "lzh_tok_fine" || taskKey === "lzh_tok_coarse") && Array.isArray(result)) {
    return result.map((item) => String(item || "")).filter(Boolean);
  }
  if ((taskKey === "dep" || taskKey === "sdp" || taskKey === "lzh_dep") && Array.isArray(result)) {
    return result
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((row) => String(row.token || row.text || row.word || ""))
      .filter(Boolean);
  }
  if (
    (taskKey === "pos_ctb" ||
      taskKey === "pos_pku" ||
      taskKey === "pos_863" ||
      taskKey === "lzh_pos_upos" ||
      taskKey === "lzh_pos_xpos" ||
      taskKey === "lzh_pos_pku") &&
    Array.isArray(result)
  ) {
    return result
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((row) => String(row.token || row.index || ""))
      .filter(Boolean);
  }
  return [];
}

function getSelectableCount(taskKey: string, result: unknown): number {
  if (!Array.isArray(result)) {
    return 0;
  }
  if (taskKey === "tokenize" || taskKey === "lzh_tok_fine" || taskKey === "lzh_tok_coarse") {
    return result.length;
  }
  if (taskKey === "ner" || taskKey === "dep" || taskKey === "sdp" || taskKey === "lzh_dep") {
    return result.length;
  }
  if (
    taskKey === "pos_ctb" ||
    taskKey === "pos_pku" ||
    taskKey === "pos_863" ||
    taskKey === "lzh_pos_upos" ||
    taskKey === "lzh_pos_xpos" ||
    taskKey === "lzh_pos_pku" ||
    taskKey === "lzh_lem"
  ) {
    return result.length;
  }
  return 0;
}

function renderNerHighlightedText(
  sourceText: string,
  rows: Array<Record<string, unknown>>,
  entityOnlyView: boolean,
  activeEntityIndex?: number | null,
) {
  const text = String(sourceText || "");
  if (!text) {
    return null;
  }
  const entities = buildNerAnnotations(text, rows);

  if (entities.length === 0) {
    return null;
  }

  const blocks: Array<{ text: string; label?: string; isEntity: boolean; entityIndex?: number }> = [];
  let cursor = 0;
  for (const [entityIndex, entity] of entities.entries()) {
    if (entity.start < cursor) {
      continue;
    }
    if (!entityOnlyView && entity.start > cursor) {
      blocks.push({ text: text.slice(cursor, entity.start), isEntity: false });
    }
    blocks.push({ text: text.slice(entity.start, entity.end), label: entity.label, isEntity: true, entityIndex });
    cursor = entity.end;
  }
  if (!entityOnlyView && cursor < text.length) {
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

function renderBratLikeOverlay(
  sourceText: string,
  annotations: OverlayAnnotation[],
  activeRowIndex?: number | null,
) {
  const text = String(sourceText || "");
  if (!text || annotations.length === 0) {
    return null;
  }
  const boundaries = new Set<number>([0, text.length]);
  annotations.forEach((annotation) => {
    boundaries.add(annotation.start);
    boundaries.add(annotation.end);
  });
  const sortedBoundaries = Array.from(boundaries)
    .filter((point) => point >= 0 && point <= text.length)
    .sort((a, b) => a - b);
  const segments: Array<{
    text: string;
    covers: OverlayAnnotation[];
  }> = [];
  for (let i = 0; i < sortedBoundaries.length - 1; i += 1) {
    const start = sortedBoundaries[i];
    const end = sortedBoundaries[i + 1];
    if (end <= start) {
      continue;
    }
    const segmentText = text.slice(start, end);
    const covers = annotations
      .filter((annotation) => annotation.start <= start && annotation.end >= end)
      .sort((a, b) => {
        if (a.kind !== b.kind) {
          return a.kind === "ner" ? -1 : 1;
        }
        const lenA = a.end - a.start;
        const lenB = b.end - b.start;
        return lenA - lenB;
      });
    segments.push({ text: segmentText, covers });
  }
  return (
    <div className={styles.bratLikeOverlay}>
      {segments.map((segment, index) => {
        if (segment.covers.length === 0) {
          return <span key={`plain-${index}`}>{segment.text}</span>;
        }
        const active = segment.covers.some((cover) => cover.rowIndex === activeRowIndex);
        const primary = segment.covers[0];
        return (
          <span
            key={`seg-${index}`}
            className={`${styles.bratSegment} ${
              primary.kind === "ner" ? styles.bratSegmentNer : styles.bratSegmentPos
            } ${active ? styles.bratSegmentActive : ""}`}
          >
            <span className={styles.bratLabels}>
              {segment.covers.map((cover, coverIndex) => (
                <span
                  key={`label-${index}-${coverIndex}-${cover.rawLabel}`}
                  className={`${styles.bratLabelChip} ${
                    cover.kind === "ner" ? styles.bratLabelChipNer : styles.bratLabelChipPos
                  } ${active ? styles.bratLabelChipActive : ""}`}
                  data-label={cover.rawLabel}
                >
                  {cover.rawLabel}
                </span>
              ))}
            </span>
            <span>{segment.text}</span>
          </span>
        );
      })}
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
  nerEntityOnlyView: boolean,
  activeRowIndex: number | null,
  hoveredRowIndex: number | null,
  onSelectRow: (index: number | null) => void,
  onHoverRow: (index: number | null) => void,
) {
  const highlightedRowIndex = hoveredRowIndex ?? activeRowIndex;
  if (taskKey === "tokenize" || taskKey === "lzh_tok_fine" || taskKey === "lzh_tok_coarse") {
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
              <span>{normalizeNerLabel(row.label).display}</span>
              <span>{`${String(row.start ?? "")}-${String(row.end ?? "")}`}</span>
            </button>
          ))}
        </div>
        <Typography.Text type="secondary">
          高亮区域中的非标签文本是上下文，不代表新增实体。
        </Typography.Text>
        {renderBratLikeOverlay(sourceText, buildNerAnnotations(sourceText, rows), highlightedRowIndex)}
        {renderNerHighlightedText(sourceText, rows, nerEntityOnlyView, highlightedRowIndex)}
      </>
    );
  }

  if ((taskKey === "dep" || taskKey === "lzh_dep") && Array.isArray(result)) {
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

    if (
      (
        taskKey === "pos_ctb" ||
        taskKey === "pos_pku" ||
        taskKey === "pos_863" ||
        taskKey === "lzh_pos_upos" ||
        taskKey === "lzh_pos_xpos" ||
        taskKey === "lzh_pos_pku"
      ) &&
      Array.isArray(result)
    ) {
      const rows = result
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item));
      const tokens = rows.map((row) => String(row.token || row.index || "")).filter(Boolean);
      return (
        <>
          <div className={styles.demoTable}>
            <div className={styles.demoTableHeader}>
              <span>{taskKey.startsWith("lzh_") ? "Index" : "Token"}</span>
              <span>POS</span>
            </div>
            {rows.map((row, index) => (
              <button
                type="button"
                key={`pos-row-${index}`}
                className={`${styles.demoTableRow} ${highlightedRowIndex === index ? styles.demoTableRowActive : ""}`}
                onClick={() => onSelectRow(activeRowIndex === index ? null : index)}
                onMouseEnter={() => onHoverRow(index)}
                onMouseLeave={() => onHoverRow(null)}
              >
                <span>{String(row.token || row.index || "")}</span>
                <span>{String(row.pos || "")}</span>
              </button>
            ))}
          </div>
          {renderTokenRail(tokens, highlightedRowIndex)}
          {renderBratLikeOverlay(sourceText, buildPosAnnotations(sourceText, rows), highlightedRowIndex)}
        </>
      );
    }
  if (taskKey === "lzh_lem" && Array.isArray(result)) {
    const rows = result
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    return renderRecordRows(rows, ["sentence", "index", "lemma"], {
      interactive: true,
      selectedRowIndex: activeRowIndex,
      hoveredRowIndex,
      onSelectRow,
      onHoverRow,
    });
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
    downloadingMissingLocalModels,
    lastDownloadAttempts,
    status,
    localModelsStatus,
    provider,
    hanlpProviderActive,
    sidecarReady,
    modelReady,
    handleInstall,
    handleUpdatePreload,
    handleDownloadModel,
    handleDownloadMissingLocalModels,
    clearDownloadAttempts,
    runMethodDemo,
    runningDemoTask,
    demoResults,
  } = useNlp();

  const taskStates = status?.tasks ?? {};
  const [nerEntityOnlyView, setNerEntityOnlyView] = useState(false);
  const [demoInputs, setDemoInputs] = useState<Record<string, string>>({});
  const [activeDemoTaskKey, setActiveDemoTaskKey] = useState("tokenize");
  const [activeDemoRowIndex, setActiveDemoRowIndex] = useState<number | null>(null);
  const [hoveredDemoRowIndex, setHoveredDemoRowIndex] = useState<number | null>(null);
  const [classicalDemoInputs, setClassicalDemoInputs] = useState<Record<string, string>>({});
  const [activeClassicalDemoMethodKey, setActiveClassicalDemoMethodKey] = useState(CLASSICAL_DEMO_METHODS[0]?.key || "");
  const [activeClassicalDemoRowIndex, setActiveClassicalDemoRowIndex] = useState<number | null>(null);
  const [hoveredClassicalDemoRowIndex, setHoveredClassicalDemoRowIndex] = useState<number | null>(null);
  const updatePreloadRef = useRef(handleUpdatePreload);

  useEffect(() => {
    updatePreloadRef.current = handleUpdatePreload;
  }, [handleUpdatePreload]);

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
    if (Object.keys(classicalDemoInputs).length > 0) {
      return;
    }
    const initial = Object.fromEntries(
      CLASSICAL_DEMO_METHODS.map((item) => [item.key, item.examples[0] || ""]),
    ) as Record<string, string>;
    setClassicalDemoInputs(initial);
  }, [classicalDemoInputs]);

  useEffect(() => {
    if (!hanlpProviderActive || !sidecarReady) {
      return;
    }
    const preloadEnabled = Boolean(status?.preload?.enabled);
    const preloadScope = status?.preload?.scope || "critical";
    if (preloadEnabled && preloadScope === "all_enabled_tasks") {
      return;
    }
    void updatePreloadRef.current({
      enabled: true,
      scope: "all_enabled_tasks",
    });
  }, [hanlpProviderActive, sidecarReady, status?.preload?.enabled, status?.preload?.scope]);

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
      key: "pos_ctb",
      taskKey: "pos_ctb",
      status: {
        status: taskStates.pos_ctb?.status || (sidecarReady ? "ready" : "unavailable"),
        reasonCode:
          taskStates.pos_ctb?.reason_code ||
          (sidecarReady ? "HANLP2_TASK_API_READY" : "HANLP2_SIDECAR_UNCONFIGURED"),
        reason:
          taskStates.pos_ctb?.reason ||
          (sidecarReady ? "CTB9_POS_ELECTRA_SMALL" : t("nlpConfig.methods.defaultUnavailableReason")),
      },
    },
    {
      key: "pos_pku",
      taskKey: "pos_pku",
      status: {
        status: taskStates.pos_pku?.status || (sidecarReady ? "ready" : "unavailable"),
        reasonCode:
          taskStates.pos_pku?.reason_code ||
          (sidecarReady ? "HANLP2_TASK_API_READY" : "HANLP2_SIDECAR_UNCONFIGURED"),
        reason:
          taskStates.pos_pku?.reason ||
          (sidecarReady ? "PKU_POS_ELECTRA_SMALL" : t("nlpConfig.methods.defaultUnavailableReason")),
      },
    },
    {
      key: "pos_863",
      taskKey: "pos_863",
      status: {
        status: taskStates.pos_863?.status || (sidecarReady ? "ready" : "unavailable"),
        reasonCode:
          taskStates.pos_863?.reason_code ||
          (sidecarReady ? "HANLP2_TASK_API_READY" : "HANLP2_SIDECAR_UNCONFIGURED"),
        reason:
          taskStates.pos_863?.reason ||
          (sidecarReady ? "C863_POS_ELECTRA_SMALL" : t("nlpConfig.methods.defaultUnavailableReason")),
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
    pos_ctb: methods.find((item) => item.key === "pos_ctb")?.status || {
      status: "unavailable",
      reasonCode: "UNKNOWN",
      reason: "No status available",
    },
    pos_pku: methods.find((item) => item.key === "pos_pku")?.status || {
      status: "unavailable",
      reasonCode: "UNKNOWN",
      reason: "No status available",
    },
    pos_863: methods.find((item) => item.key === "pos_863")?.status || {
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
    lzh_tok_fine: methods.find((item) => item.key === "tokenize")?.status || {
      status: "unavailable",
      reasonCode: "UNKNOWN",
      reason: "No status available",
    },
    lzh_tok_coarse: methods.find((item) => item.key === "tokenize")?.status || {
      status: "unavailable",
      reasonCode: "UNKNOWN",
      reason: "No status available",
    },
    lzh_lem: methods.find((item) => item.key === "tokenize")?.status || {
      status: "unavailable",
      reasonCode: "UNKNOWN",
      reason: "No status available",
    },
    lzh_pos_upos: methods.find((item) => item.key === "pos_pku")?.status || {
      status: "unavailable",
      reasonCode: "UNKNOWN",
      reason: "No status available",
    },
    lzh_pos_xpos: methods.find((item) => item.key === "pos_pku")?.status || {
      status: "unavailable",
      reasonCode: "UNKNOWN",
      reason: "No status available",
    },
    lzh_pos_pku: methods.find((item) => item.key === "pos_pku")?.status || {
      status: "unavailable",
      reasonCode: "UNKNOWN",
      reason: "No status available",
    },
    lzh_dep: methods.find((item) => item.key === "dep")?.status || {
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

  const activeClassicalDemoMethod =
    CLASSICAL_DEMO_METHODS.find((item) => item.key === activeClassicalDemoMethodKey) || CLASSICAL_DEMO_METHODS[0];
  const activeClassicalDemoInput = classicalDemoInputs[activeClassicalDemoMethod?.key || ""] || "";
  const activeClassicalDemoStatus = methodStatusByTask[activeClassicalDemoMethod?.backendTaskKey || ""] || {
    status: "unavailable",
    reasonCode: "UNKNOWN",
    reason: "No status available",
  };
  const activeClassicalDemoResult =
    (demoResults[activeClassicalDemoMethod?.backendTaskKey || ""] || null) as NlpDemoMeta | null;
  const activeClassicalSelectableCount = getSelectableCount(
    activeClassicalDemoMethod?.backendTaskKey || "",
    activeClassicalDemoResult?.result,
  );
  const activeClassicalResultTokens = getTokenListFromResult(
    activeClassicalDemoMethod?.backendTaskKey || "",
    activeClassicalDemoResult?.result,
  );

  const methodDetailByTaskKey: Record<string, { key: string; taskKey?: string; status: MethodStatus } | undefined> = {
    tokenize: methods.find((item) => item.key === "tokenize"),
    ner: methods.find((item) => item.key === "nerMsra"),
    pos_ctb: methods.find((item) => item.key === "pos_ctb"),
    pos_pku: methods.find((item) => item.key === "pos_pku"),
    pos_863: methods.find((item) => item.key === "pos_863"),
    dep: methods.find((item) => item.key === "dep"),
    sdp: methods.find((item) => item.key === "sdp"),
    con: methods.find((item) => item.key === "con"),
    cor: methods.find((item) => item.key === "cor"),
  };

  const resolveMethodTaskCandidates = (taskKey: string): string[] => {
    const mapping: Record<string, string[]> = {
      tokenize: ["tokenize", "tok", "tok/fine"],
      ner: ["ner", "ner_msra"],
      pos_ctb: ["pos_ctb", "pos"],
      pos_pku: ["pos_pku", "pos"],
      pos_863: ["pos_863", "pos"],
      dep: ["dep"],
      sdp: ["sdp"],
      con: ["con"],
      lzh_tok_fine: ["lzh_tok_fine", "tok/fine", "lzh_tok"],
      lzh_tok_coarse: ["lzh_tok_coarse", "tok/coarse", "lzh_tok"],
      lzh_lem: ["lzh_lem", "lem"],
      lzh_pos_upos: ["lzh_pos_upos", "pos/upos"],
      lzh_pos_xpos: ["lzh_pos_xpos", "pos/xpos"],
      lzh_pos_pku: ["lzh_pos_pku", "pos/pku"],
      lzh_dep: ["lzh_dep", "dep"],
    };
    return mapping[taskKey] || [taskKey];
  };

  const resolveMethodModelInfo = (taskKey: string, methodStatus: MethodStatus) => {
    const taskResults = status?.preload?.task_results || {};
    const taskResult = resolveMethodTaskCandidates(taskKey)
      .map((candidate) => taskResults[candidate])
      .find((item) => Boolean(item));
    const modelId = String(taskResult?.model_id || status?.model.model_id || "").trim();
    const cachePath = String(
      status?.preload?.model_cache_path ||
      status?.sidecar.model_cache_path ||
      status?.sidecar.model_home ||
      status?.sidecar.hanlp_home ||
      "",
    ).trim();
    const reasonHint = `${methodStatus.reasonCode} ${methodStatus.reason}`.toUpperCase();
    const taskStatus = String(taskResult?.status || methodStatus.status || "").toLowerCase();
    const localItems = localModelsStatus?.items || [];
    const taskCandidates = resolveMethodTaskCandidates(taskKey).map((item) => String(item || "").toLowerCase());
    const localItem =
      localItems.find((item) => {
        const itemTaskKey = String(item.task_key || "").toLowerCase();
        const itemTaskName = String(item.task_name || "").toLowerCase();
        return taskCandidates.includes(itemTaskKey) || taskCandidates.includes(itemTaskName);
      }) ||
      (taskKey.startsWith("lzh_") || taskKey === "tokenize" ? localItems.find((item) => item.scope === "default") : undefined);
    const missing =
      (taskStatus !== "ready" &&
        /(MODEL|DOWNLOAD|MISSING|INSTALL_REQUIRED|NOT_CONFIGURED|UNAVAILABLE)/.test(reasonHint)) ||
      Boolean(localItem && localItem.local_available === false);
    return {
      modelText: String(localItem?.model_id || modelId || t("nlpConfig.notConfigured")).trim() || t("nlpConfig.notConfigured"),
      fileText: cachePath || t("nlpConfig.notConfigured"),
      missing,
    };
  };

  const pythonVersion = String(status?.sidecar?.python_version || "").trim();
  const missingLocalModelItems = (localModelsStatus?.items || []).filter((item) => !item.local_available);
  const hasMissingLocalModels =
    hanlpProviderActive &&
    Boolean(localModelsStatus?.require_local_models) &&
    missingLocalModelItems.length > 0;
  const runDemoDisabled = hasMissingLocalModels || !hanlpProviderActive || !sidecarReady;

  useEffect(() => {
    setActiveDemoRowIndex(null);
    setHoveredDemoRowIndex(null);
  }, [activeDemoMethod.backendTaskKey, activeDemoResult?.request_id]);

  useEffect(() => {
    setActiveClassicalDemoRowIndex(null);
    setHoveredClassicalDemoRowIndex(null);
  }, [activeClassicalDemoMethod?.key, activeClassicalDemoResult?.request_id]);

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

  const handleClassicalDemoResultKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (!activeClassicalDemoResult || activeClassicalSelectableCount <= 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next =
        activeClassicalDemoRowIndex === null ? 0 : (activeClassicalDemoRowIndex + 1) % activeClassicalSelectableCount;
      setActiveClassicalDemoRowIndex(next);
      setHoveredClassicalDemoRowIndex(null);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const next =
        activeClassicalDemoRowIndex === null
          ? activeClassicalSelectableCount - 1
          : (activeClassicalDemoRowIndex - 1 + activeClassicalSelectableCount) % activeClassicalSelectableCount;
      setActiveClassicalDemoRowIndex(next);
      setHoveredClassicalDemoRowIndex(null);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setActiveClassicalDemoRowIndex(null);
      setHoveredClassicalDemoRowIndex(null);
    }
  };

  const sidecarActionLabel = installing
    ? t("nlpConfig.maintenance.deploying")
    : sidecarReady
      ? t("nlpConfig.maintenance.ready")
      : loading
        ? t("nlpConfig.maintenance.loading")
        : t("nlpConfig.maintenance.deployNow");

  const sidecarActionBusy = installing || (!sidecarReady && loading);
  const runtimeAlertType: "success" | "warning" =
    hanlpProviderActive && sidecarReady && modelReady ? "success" : "warning";



  return (
    <div className={styles.nlpPage}>
      <PageHeader
        items={[
          { title: t("nav.settings") },
          { title: t("nlpConfig.title") },
        ]}
      />

      <div className={styles.content}>
        <div id="nlp-section-maintenance" className={`${styles.alertRow} ${styles.sectionAnchorOffset}`}>
          <div className={styles.alertStack}>
            <Alert
              type={runtimeAlertType}
              showIcon
              message={t("nlpConfig.infoTitle")}
              description={
                <div className={styles.maintenanceInfoBlock}>
                  <Typography.Text className={styles.maintenancePrimaryText}>
                    {t("nlpConfig.infoDescription")}
                  </Typography.Text>

                  <Typography.Text className={styles.maintenanceSecondaryText}>
                    {`${t("nlpConfig.providerMessage", { provider: provider || "hanlp" })} · ${hanlpProviderActive
                      ? t("nlpConfig.providerActive")
                      : t("nlpConfig.providerInactive")} · ${t("nlpConfig.pythonPath")} ${status?.sidecar.python_executable || t("nlpConfig.notConfigured")} · Python ${pythonVersion || t("nlpConfig.notConfigured")}`}
                  </Typography.Text>
                </div>
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

            {hasMissingLocalModels ? (
              <Alert
                type="warning"
                showIcon
                message={t("nlpConfig.maintenance.localModelPrecheckFailed")}
                description={
                  <div className={styles.maintenanceInfoBlock}>
                    <Typography.Text className={styles.maintenanceSecondaryText}>
                      {t("nlpConfig.maintenance.localModelPrecheckDesc")}
                    </Typography.Text>
                    <Typography.Text className={styles.maintenanceMutedText}>
                      {missingLocalModelItems
                        .slice(0, 8)
                        .map((item) => item.model_id)
                        .join(" · ")}
                    </Typography.Text>
                    {missingLocalModelItems.length > 8 ? (
                      <Typography.Text className={styles.maintenanceMutedText}>
                        {t("nlpConfig.maintenance.moreModels", { count: missingLocalModelItems.length - 8 })}
                      </Typography.Text>
                    ) : null}
                    <Space size={8}>
                      <Button
                        size="small"
                        type="primary"
                        loading={downloadingMissingLocalModels}
                        disabled={!sidecarReady || installing || downloadingMissingLocalModels}
                        onClick={() => {
                          void handleDownloadMissingLocalModels();
                        }}
                      >
                        {t("nlpConfig.maintenance.downloadMissingModels")}
                      </Button>
                    </Space>
                  </div>
                }
              />
            ) : null}
            {lastDownloadAttempts && lastDownloadAttempts.length > 0 ? (
              <Alert
                type="info"
                showIcon
                closable
                onClose={() => clearDownloadAttempts()}
                message={t("nlpConfig.maintenance.lastDownloadResult")}
                description={
                  <div className={styles.maintenanceInfoBlock}>
                    {lastDownloadAttempts.map((attempt) => (
                      <div key={attempt.model_id} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 4 }}>
                        <Tag color={attempt.status === "ready" ? "success" : "error"} style={{ flexShrink: 0 }}>
                          {attempt.status === "ready" ? "✓" : "✗"}
                        </Tag>
                        <span>
                          <Typography.Text code style={{ fontSize: 12 }}>{attempt.model_id}</Typography.Text>
                          {attempt.status !== "ready" ? (
                            <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                              {attempt.reason_code}: {attempt.reason}
                            </Typography.Text>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                }
              />
            ) : null}
          </div>
          <div className={styles.alertActionBlock}>
            <Button
              className={`${styles.maintenanceInstallButton} ${sidecarReady ? styles.maintenanceInstallButtonReady : ""}`}
              type="primary"
              onClick={handleInstall}
              loading={sidecarActionBusy}
              disabled={sidecarReady || !hanlpProviderActive || sidecarActionBusy}
            >
              {sidecarActionLabel}
            </Button>
          </div>
        </div>

        <div className={styles.workspaceLayout}>
          <div className={styles.primaryColumn}>
            <div id="nlp-section-demo" className={styles.sectionAnchorOffset}>
              <Card className={`${styles.card} ${styles.primaryCard}`}>
                <Typography.Title level={5} className={styles.cardTitle}>
                  通用NLP方法与DEMO
                </Typography.Title>
                <Typography.Paragraph type="secondary" className={styles.cardDescription}>
                  首屏工作区：选择任务、填入示例、运行并查看结构化结果与映射高亮。
                </Typography.Paragraph>
                <div className={styles.demoWorkbench}>
                  <div className={styles.demoMethodList}>
                    {DEMO_METHODS.map((method) => {
                      const methodStatus = methodStatusByTask[method.backendTaskKey];
                      const methodDetail = methodDetailByTaskKey[method.backendTaskKey];
                      const modelInfo = resolveMethodModelInfo(method.backendTaskKey, methodStatus);
                      const active = method.backendTaskKey === activeDemoMethod.backendTaskKey;
                      const methodName = methodDetail
                        ? t(`nlpConfig.methods.${methodDetail.key}.name`)
                        : method.title;
                      const methodDescription = methodDetail
                        ? t(`nlpConfig.methods.${methodDetail.key}.description`)
                        : method.placeholder;
                      const methodReason = methodDetail?.status.reason || methodStatus?.reason || "";
                      return (
                        <button
                          key={method.backendTaskKey}
                          type="button"
                          className={`${styles.demoMethodButton} ${active ? styles.demoMethodButtonActive : ""}`}
                          onClick={() => setActiveDemoTaskKey(method.backendTaskKey)}
                        >
                          <div className={styles.demoMethodMain}>
                            <div className={styles.demoMethodHeader}>
                              <Typography.Text strong className={styles.demoMethodTitle}>
                                {methodName}
                              </Typography.Text>
                              <Tag
                                className={styles.demoStatusTag}
                                color={resolveTagColor(methodStatus?.status || "unavailable")}
                                title={modelInfo.modelText}
                              >
                                {modelInfo.modelText}
                              </Tag>
                            </div>
                            <Typography.Text type="secondary" className={styles.demoMethodDescription}>
                              {methodDescription}
                            </Typography.Text>
                            {methodReason ? (
                              <Typography.Text type="secondary" className={styles.demoMethodReason}>
                                {methodReason}
                              </Typography.Text>
                            ) : null}
                            {methodDetail?.taskKey ? (
                              <Typography.Text type="secondary" className={styles.demoMethodTaskKey}>
                                {`${t("nlpConfig.taskKey")} ${methodDetail.taskKey}`}
                              </Typography.Text>
                            ) : null}
                            {modelInfo.missing ? (
                              <Button
                                size="small"
                                type="link"
                                className={styles.demoDownloadButton}
                                loading={downloadingModel}
                                disabled={installing || downloadingModel || !sidecarReady || !hanlpProviderActive}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  void handleDownloadModel();
                                }}
                              >
                                下载
                              </Button>
                            ) : null}
                          </div>
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
                            {t("nlpConfig.demo.example", { index: index + 1 })}
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
                        disabled={runDemoDisabled}
                        onClick={() => runMethodDemo(activeDemoMethod.backendTaskKey, activeDemoInput)}
                      >
                        {t("nlpConfig.demo.runTest")}
                      </Button>
                    </div>
                    <div className={styles.demoResultPanel}>
                      <Typography.Title level={5} className={styles.cardTitle}>
                        {t("nlpConfig.demo.resultPanel")}
                      </Typography.Title>
                      <Typography.Text type="secondary">
                        {t("nlpConfig.demo.interactionHint")}
                      </Typography.Text>
                      {!activeDemoResult ? (
                        <Typography.Paragraph type="secondary" className={styles.cardDescription}>
                          {t("nlpConfig.demo.clickRunTestHint")}
                        </Typography.Paragraph>
                      ) : (
                        <>
                          <div className={styles.demoMetaGrid}>
                            <div className={styles.demoMetaItem}><span>status</span><Tag color={resolveTagColor(activeDemoResult.status)}>{activeDemoResult.reason_code}</Tag></div>
                            <div className={styles.demoMetaItem}><span>task</span><span>{activeDemoResult.task_key}</span></div>
                            <div className={styles.demoMetaItem}><span>model</span><span>{activeDemoResult.resolved_model || t("nlpConfig.demo.empty")}</span></div>
                            <div className={styles.demoMetaItem}><span>task model</span><span>{activeDemoResult.effective_task_model_id || t("nlpConfig.demo.inherit")}</span></div>
                            <div className={styles.demoMetaItem}><span>style</span><span>{activeDemoResult.detected_style}</span></div>
                            <div className={styles.demoMetaItem}><span>score</span><span>{activeDemoResult.detection_score}</span></div>
                            <div className={styles.demoMetaItem}><span>duration</span><span>{activeDemoResult.duration_ms} ms</span></div>
                            <div className={styles.demoMetaItem}><span>{t("nlpConfig.telemetry.sidecarTotal")}</span><span>{activeDemoResult.sidecar_elapsed_ms ?? 0} ms</span></div>
                            <div className={styles.demoMetaItem}><span>{t("nlpConfig.telemetry.traceTotal")}</span><span>{activeDemoResult.sidecar_trace_elapsed_ms ?? 0} ms</span></div>
                            <div className={styles.demoMetaItem}><span>{t("nlpConfig.telemetry.executionPath")}</span><span>{activeDemoResult.sidecar_execution_path || t("nlpConfig.telemetry.unknown")}</span></div>
                            <div className={styles.demoMetaItem}><span>preload</span><span>{activeDemoResult.preload_status || "idle"}</span></div>
                          </div>
                          {activeDemoResult.sidecar_execution_detail ? (
                            <Typography.Paragraph className={styles.operationOutput}>
                              {t("nlpConfig.telemetry.executionDetail")}: {activeDemoResult.sidecar_execution_detail}
                            </Typography.Paragraph>
                          ) : null}
                          {activeDemoResult.sidecar_trace_stage_ms && Object.keys(activeDemoResult.sidecar_trace_stage_ms).length > 0 ? (
                            <Typography.Paragraph className={styles.operationOutput}>
                              {t("nlpConfig.telemetry.stageMs")}: {prettyJson(activeDemoResult.sidecar_trace_stage_ms)}
                            </Typography.Paragraph>
                          ) : null}
                          <Typography.Paragraph className={styles.operationOutput}>
                            {t("nlpConfig.demo.cachePath")}: {activeDemoResult.model_cache_path || status?.sidecar.model_cache_path || status?.sidecar.model_home || status?.sidecar.hanlp_home || t("nlpConfig.notConfigured")}
                          </Typography.Paragraph>
                          <Typography.Paragraph className={styles.operationOutput}>
                            {activeDemoResult.reason}
                          </Typography.Paragraph>
                          {activeDemoMethod.backendTaskKey === "ner" ? (
                            <Space size={8} wrap>
                              <Typography.Text type="secondary">{t("nlpConfig.demo.entityOnlyView")}</Typography.Text>
                              <Switch
                                checked={nerEntityOnlyView}
                                onChange={(checked) => setNerEntityOnlyView(checked)}
                              />
                            </Space>
                          ) : null}
                          <div
                            className={styles.demoInteractiveArea}
                            tabIndex={0}
                            onKeyDown={handleDemoResultKeyDown}
                          >
                            {renderResultByTask(
                              activeDemoMethod.backendTaskKey,
                              activeDemoResult.result,
                              activeDemoInput,
                              nerEntityOnlyView,
                              activeDemoRowIndex,
                              hoveredDemoRowIndex,
                              setActiveDemoRowIndex,
                              setHoveredDemoRowIndex,
                            )}
                          </div>
                          {activeResultTokens.length > 0 ? (
                            <Typography.Text type="secondary">
                              {t("nlpConfig.demo.currentTokenCount", { count: activeResultTokens.length })}
                            </Typography.Text>
                          ) : null}
                          <Typography.Paragraph className={styles.operationOutput}>
                            {t("nlpConfig.demo.rules")}: {(activeDemoResult.matched_rules || []).join(", ") || t("nlpConfig.demo.none")}
                          </Typography.Paragraph>
                          {activeDemoResult.pretty_print ? (
                            <>
                              <Typography.Title level={5} className={styles.cardTitle}>
                                {t("nlpConfig.demo.prettyPrint")}
                              </Typography.Title>
                              <Typography.Paragraph className={styles.operationOutput}>
                                {activeDemoResult.pretty_print}
                              </Typography.Paragraph>
                            </>
                          ) : null}
                          <Typography.Title level={5} className={styles.cardTitle}>
                            {t("nlpConfig.demo.rawOutput")}
                          </Typography.Title>
                          <Typography.Paragraph className={styles.operationOutput}>
                            {prettyJson(
                              activeDemoResult.raw_result !== undefined
                                ? activeDemoResult.raw_result
                                : activeDemoResult.result,
                            )}
                          </Typography.Paragraph>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            <div id="nlp-section-classical-demo" className={styles.sectionAnchorOffset}>
              <Card className={`${styles.card} ${styles.primaryCard}`}>
                <Typography.Title level={5} className={styles.cardTitle}>
                  古汉语NLP与DEMO
                </Typography.Title>
                <Typography.Paragraph type="secondary" className={styles.cardDescription}>
                  采用 HanLP 单一多任务模型（KYOTO_EVAHAN_TOK_LEM_POS_UDEP_LZH）统一支持古汉语分词、词性与依存分析。
                </Typography.Paragraph>
                <Typography.Paragraph type="secondary" className={styles.cardDescription}>
                  与通用区不同：本区默认按单模型路线进行测试，不区分任务级模型切换。若需粗分效果，可结合 skip tok/fine 的服务端能力。
                </Typography.Paragraph>
                <div className={styles.demoWorkbench}>
                  <div className={styles.demoMethodList}>
                    {CLASSICAL_DEMO_METHODS.map((method) => {
                      const methodStatus = methodStatusByTask[method.backendTaskKey];
                      const methodDetail = methodDetailByTaskKey[method.backendTaskKey];
                      const modelInfo = resolveMethodModelInfo(method.backendTaskKey, methodStatus);
                      const active = method.key === activeClassicalDemoMethod?.key;
                      const methodReason = methodDetail?.status.reason || methodStatus?.reason || "";
                      return (
                        <button
                          key={method.key}
                          type="button"
                          className={`${styles.demoMethodButton} ${active ? styles.demoMethodButtonActive : ""}`}
                          onClick={() => setActiveClassicalDemoMethodKey(method.key)}
                        >
                          <div className={styles.demoMethodMain}>
                            <div className={styles.demoMethodHeader}>
                              <Typography.Text strong className={styles.demoMethodTitle}>
                                {method.title}
                              </Typography.Text>
                              <Tag
                                className={styles.demoStatusTag}
                                color={resolveTagColor(methodStatus?.status || "unavailable")}
                                title={modelInfo.modelText}
                              >
                                {modelInfo.modelText}
                              </Tag>
                            </div>
                            <Typography.Text type="secondary" className={styles.demoMethodDescription}>
                              {method.placeholder}
                            </Typography.Text>
                            {methodReason ? (
                              <Typography.Text type="secondary" className={styles.demoMethodReason}>
                                {methodReason}
                              </Typography.Text>
                            ) : null}
                            <Typography.Text type="secondary" className={styles.demoMethodTaskKey}>
                              {`${t("nlpConfig.taskKey")} ${method.backendTaskKey}`}
                            </Typography.Text>
                            {modelInfo.missing ? (
                              <Button
                                size="small"
                                type="link"
                                className={styles.demoDownloadButton}
                                loading={downloadingModel}
                                disabled={installing || downloadingModel || !sidecarReady || !hanlpProviderActive}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  void handleDownloadModel();
                                }}
                              >
                                下载
                              </Button>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className={styles.demoPanel}>
                    <div className={styles.demoInputPanel}>
                      <Typography.Title level={5} className={styles.cardTitle}>
                        {activeClassicalDemoMethod?.title || t("nlpConfig.demo.classicalTask")}
                      </Typography.Title>
                      <Typography.Paragraph type="secondary" className={styles.cardDescription}>
                        {activeClassicalDemoStatus.reason}
                      </Typography.Paragraph>
                      <Space wrap size={8} className={styles.demoExamples}>
                        {(activeClassicalDemoMethod?.examples || []).map((sample, index) => (
                          <Button
                            key={`${activeClassicalDemoMethod?.key || "classical"}-${index}`}
                            size="small"
                            onClick={() =>
                              setClassicalDemoInputs((prev) => ({
                                ...prev,
                                [activeClassicalDemoMethod?.key || ""]: sample,
                              }))
                            }
                          >
                            {t("nlpConfig.demo.example", { index: index + 1 })}
                          </Button>
                        ))}
                      </Space>
                      <Input.TextArea
                        rows={6}
                        value={activeClassicalDemoInput}
                        placeholder={activeClassicalDemoMethod?.placeholder || t("nlpConfig.demo.classicalInputPlaceholder")}
                        onChange={(event) =>
                          setClassicalDemoInputs((prev) => ({
                            ...prev,
                            [activeClassicalDemoMethod?.key || ""]: event.target.value,
                          }))
                        }
                      />
                      <Button
                        type="primary"
                        loading={runningDemoTask === activeClassicalDemoMethod?.backendTaskKey}
                        disabled={runDemoDisabled}
                        onClick={() =>
                          runMethodDemo(activeClassicalDemoMethod?.backendTaskKey || "tokenize", activeClassicalDemoInput)
                        }
                      >
                        {t("nlpConfig.demo.runClassicalTest")}
                      </Button>
                    </div>
                    <div className={styles.demoResultPanel}>
                      <Typography.Title level={5} className={styles.cardTitle}>
                        {t("nlpConfig.demo.resultPanel")}
                      </Typography.Title>
                      <Typography.Text type="secondary">
                        {t("nlpConfig.demo.interactionHint")}
                      </Typography.Text>
                      {!activeClassicalDemoResult ? (
                        <Typography.Paragraph type="secondary" className={styles.cardDescription}>
                          {t("nlpConfig.demo.clickRunClassicalHint")}
                        </Typography.Paragraph>
                      ) : (
                        <>
                          <div className={styles.demoMetaGrid}>
                            <div className={styles.demoMetaItem}><span>status</span><Tag color={resolveTagColor(activeClassicalDemoResult.status)}>{activeClassicalDemoResult.reason_code}</Tag></div>
                            <div className={styles.demoMetaItem}><span>task</span><span>{activeClassicalDemoResult.task_key}</span></div>
                            <div className={styles.demoMetaItem}><span>model</span><span>{activeClassicalDemoResult.resolved_model || t("nlpConfig.demo.empty")}</span></div>
                            <div className={styles.demoMetaItem}><span>{t("nlpConfig.telemetry.mode")}</span><span>{t("nlpConfig.telemetry.classicalSingleModel")}</span></div>
                            <div className={styles.demoMetaItem}><span>style</span><span>{activeClassicalDemoResult.detected_style}</span></div>
                            <div className={styles.demoMetaItem}><span>score</span><span>{activeClassicalDemoResult.detection_score}</span></div>
                            <div className={styles.demoMetaItem}><span>duration</span><span>{activeClassicalDemoResult.duration_ms} ms</span></div>
                            <div className={styles.demoMetaItem}><span>{t("nlpConfig.telemetry.sidecarTotal")}</span><span>{activeClassicalDemoResult.sidecar_elapsed_ms ?? 0} ms</span></div>
                            <div className={styles.demoMetaItem}><span>{t("nlpConfig.telemetry.traceTotal")}</span><span>{activeClassicalDemoResult.sidecar_trace_elapsed_ms ?? 0} ms</span></div>
                            <div className={styles.demoMetaItem}><span>{t("nlpConfig.telemetry.executionPath")}</span><span>{activeClassicalDemoResult.sidecar_execution_path || t("nlpConfig.telemetry.unknown")}</span></div>
                            <div className={styles.demoMetaItem}><span>preload</span><span>{activeClassicalDemoResult.preload_status || "idle"}</span></div>
                          </div>
                          {activeClassicalDemoResult.sidecar_execution_detail ? (
                            <Typography.Paragraph className={styles.operationOutput}>
                              {t("nlpConfig.telemetry.executionDetail")}: {activeClassicalDemoResult.sidecar_execution_detail}
                            </Typography.Paragraph>
                          ) : null}
                          {activeClassicalDemoResult.sidecar_trace_stage_ms && Object.keys(activeClassicalDemoResult.sidecar_trace_stage_ms).length > 0 ? (
                            <Typography.Paragraph className={styles.operationOutput}>
                              {t("nlpConfig.telemetry.stageMs")}: {prettyJson(activeClassicalDemoResult.sidecar_trace_stage_ms)}
                            </Typography.Paragraph>
                          ) : null}
                          <Typography.Paragraph className={styles.operationOutput}>
                            {t("nlpConfig.demo.cachePath")}: {activeClassicalDemoResult.model_cache_path || status?.sidecar.model_cache_path || status?.sidecar.model_home || status?.sidecar.hanlp_home || t("nlpConfig.notConfigured")}
                          </Typography.Paragraph>
                          <Typography.Paragraph className={styles.operationOutput}>
                            {activeClassicalDemoResult.reason}
                          </Typography.Paragraph>
                          <div
                            className={styles.demoInteractiveArea}
                            tabIndex={0}
                            onKeyDown={handleClassicalDemoResultKeyDown}
                          >
                            {renderResultByTask(
                              activeClassicalDemoMethod?.backendTaskKey || "tokenize",
                              activeClassicalDemoResult.result,
                              activeClassicalDemoInput,
                              false,
                              activeClassicalDemoRowIndex,
                              hoveredClassicalDemoRowIndex,
                              setActiveClassicalDemoRowIndex,
                              setHoveredClassicalDemoRowIndex,
                            )}
                          </div>
                          {activeClassicalResultTokens.length > 0 ? (
                            <Typography.Text type="secondary">
                              {t("nlpConfig.demo.currentTokenCount", { count: activeClassicalResultTokens.length })}
                            </Typography.Text>
                          ) : null}
                          <Typography.Paragraph className={styles.operationOutput}>
                            {t("nlpConfig.demo.rules")}: {(activeClassicalDemoResult.matched_rules || []).join(", ") || t("nlpConfig.demo.none")}
                          </Typography.Paragraph>
                          {activeClassicalDemoResult.pretty_print ? (
                            <>
                              <Typography.Title level={5} className={styles.cardTitle}>
                                {t("nlpConfig.demo.prettyPrint")}
                              </Typography.Title>
                              <Typography.Paragraph className={styles.operationOutput}>
                                {activeClassicalDemoResult.pretty_print}
                              </Typography.Paragraph>
                            </>
                          ) : null}
                          <Typography.Title level={5} className={styles.cardTitle}>
                            {t("nlpConfig.demo.rawOutput")}
                          </Typography.Title>
                          <Typography.Paragraph className={styles.operationOutput}>
                            {prettyJson(
                              activeClassicalDemoResult.raw_result !== undefined
                                ? activeClassicalDemoResult.raw_result
                                : activeClassicalDemoResult.result,
                            )}
                          </Typography.Paragraph>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            </div>

          </div>

        </div>

      </div>

    </div>
  );
}

export default NlpPage;