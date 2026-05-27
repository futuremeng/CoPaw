import { Column, Pie } from "@ant-design/plots";
import { Button, Card, Empty, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { KnowledgeSourceDocument } from "../../../../api/types";
import styles from "../index.module.less";
import type { ProjectKnowledgeState } from "../hooks/useProjectKnowledgeState";
import {
  parseMarkdownOutline,
  PROJECT_MARKDOWN_OUTLINE_JUMP_EVENT,
  isMarkdownDocumentPath,
  type MarkdownOutlineJumpDetail,
} from "../utils/markdownOutline";

interface ProjectDocumentKnowledgeVisualizationProps {
  selectedFilePath: string;
  fileContent: string;
  charStatsContent: string;
  nerStructuredContent: string;
  knowledgeState: ProjectKnowledgeState;
}

interface SentenceRange {
  sentenceIndex: number;
  sentenceText: string;
  start: number;
  end: number;
}

interface MentionDatum {
  sentenceIndex: number;
  label: string;
  surface: string;
}

interface RelationEdgeDatum {
  edge: string;
  relation: string;
  count: number;
}

interface NerTopEntityDatum {
  entity: string;
  count: number;
}

interface TemporalNodeDatum {
  id: string;
  label: string;
  type: string;
  count: number;
  sentenceIndex: number;
  x: number;
  y: number;
  radius: number;
}

interface TemporalEdgeDatum {
  sourceId: string;
  targetId: string;
  weight: number;
}

const requestedSourceIds = new Set<string>();

function normalizePath(value: string): string {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\//, "")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

function safeJsonParse(value: unknown): Record<string, unknown> | null {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalizeSentenceIndex(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function parseSentenceCharStats(charStatsContent: string): Array<{ sentence: string; chars: number }> {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(String(charStatsContent || ""));
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((item) => {
      const row = item as Record<string, unknown>;
      const lineNo = normalizeSentenceIndex(row.line_no ?? row.sentence_index ?? row.line_index);
      const charCount = Number(row.char_count ?? row.chars ?? row.charCount ?? 0);
      if (!lineNo || !Number.isFinite(charCount)) {
        return null;
      }
      return {
        sentence: `S${lineNo}`,
        chars: Math.max(0, Math.floor(charCount)),
      };
    })
    .filter((item): item is { sentence: string; chars: number } => Boolean(item));
}

function resolveCurrentDocument(
  documents: KnowledgeSourceDocument[],
  selectedFilePath: string,
): KnowledgeSourceDocument | null {
  const normalizedBaseName = (value: string): string => {
    const text = normalizePath(value);
    if (!text) {
      return "";
    }
    const base = text.split("/").pop() || text;
    return base.replace(/\.[^/.]+$/g, "").toLowerCase();
  };

  const normalizedStem = (value: string): string => {
    const base = normalizedBaseName(value);
    if (!base) {
      return "";
    }
    return base
      .replace(/\.snapshot_[^/.]+$/i, "")
      .replace(/\.__[a-f0-9]{8,}$/i, "")
      .toLowerCase();
  };

  const selected = normalizePath(selectedFilePath);
  if (!selected) {
    return null;
  }
  const selectedBase = normalizedBaseName(selectedFilePath);
  const selectedStem = normalizedStem(selectedFilePath);

  for (const doc of documents) {
    const rawDoc = doc as unknown as Record<string, unknown>;
    const candidates = [
      doc.path,
      doc.title,
      doc.snapshot_relative_path,
      doc.snapshot_path,
      doc.chunk_path,
      doc.ner_structured_path,
      doc.syntax_structured_path,
      String(rawDoc.document_path || ""),
      String(rawDoc.source_path || ""),
      String(rawDoc.original_path || ""),
      String(rawDoc.relative_path || ""),
      String(rawDoc.file_path || ""),
    ]
      .map((item) => normalizePath(String(item || "")))
      .filter(Boolean);

    if (
      candidates.some(
        (item) =>
          item === selected ||
          item.endsWith(`/${selected}`) ||
          selected.endsWith(`/${item}`),
      )
    ) {
      return doc;
    }

    if (
      selectedStem &&
      candidates.some((item) => {
        const itemBase = normalizedBaseName(item);
        const itemStem = normalizedStem(item);
        return (
          itemBase === selectedBase ||
          itemStem === selectedStem ||
          itemBase.startsWith(`${selectedStem}.snapshot_`) ||
          item.includes(`/${selectedStem}.snapshot_`)
        );
      })
    ) {
      return doc;
    }
  }
  return null;
}

function buildSentenceRanges(fileContent: string, syntaxPayload: Record<string, unknown> | null): SentenceRange[] {
  const rawSentences = Array.isArray(syntaxPayload?.sentences)
    ? (syntaxPayload?.sentences as Array<Record<string, unknown>>)
    : [];
  const normalizedContent = String(fileContent || "");

  if (rawSentences.length === 0) {
    const lines = normalizedContent.split(/\r?\n/);
    let cursor = 0;
    return lines.map((line, index) => {
      const start = cursor;
      const end = start + line.length;
      cursor = end + 1;
      return {
        sentenceIndex: index + 1,
        sentenceText: line,
        start,
        end,
      };
    });
  }

  const ranges: SentenceRange[] = [];
  let cursor = 0;

  for (const [index, sentence] of rawSentences.entries()) {
    const sentenceIndex = normalizeSentenceIndex(sentence.sentence_index) || index + 1;
    const sentenceText = String(sentence.sentence_text || sentence.text || "");
    if (!sentenceText) {
      ranges.push({
        sentenceIndex,
        sentenceText: "",
        start: cursor,
        end: cursor,
      });
      continue;
    }

    const located = normalizedContent.indexOf(sentenceText, cursor);
    if (located >= 0) {
      const start = located;
      const end = located + sentenceText.length;
      ranges.push({ sentenceIndex, sentenceText, start, end });
      cursor = end;
    } else {
      const start = cursor;
      const end = start + sentenceText.length;
      ranges.push({ sentenceIndex, sentenceText, start, end });
      cursor = end;
    }
  }

  return ranges;
}

function mapMentionsToSentences(
  mentions: Array<Record<string, unknown>>,
  sentenceRanges: SentenceRange[],
): MentionDatum[] {
  const sentenceByIndex = new Map(sentenceRanges.map((item) => [item.sentenceIndex, item]));

  return mentions
    .map((mention) => {
      const label = String(mention.label || mention.type || "entity").trim() || "entity";
      const surface = String(mention.surface || mention.text || mention.entity || "").trim();
      let sentenceIndex = normalizeSentenceIndex(
        mention.sentence_index ?? mention.line_no ?? mention.line_index,
      );

      if (!sentenceIndex) {
        const start = Number(mention.start);
        if (Number.isFinite(start)) {
          const found = sentenceRanges.find((item) => start >= item.start && start <= item.end);
          sentenceIndex = found?.sentenceIndex || 0;
        }
      }

      if (!sentenceIndex && surface) {
        const found = sentenceRanges.find((item) => item.sentenceText.includes(surface));
        sentenceIndex = found?.sentenceIndex || 0;
      }

      if (!sentenceIndex && sentenceRanges.length > 0) {
        sentenceIndex = sentenceRanges[0].sentenceIndex;
      }

      if (!sentenceByIndex.has(sentenceIndex)) {
        return null;
      }

      return {
        sentenceIndex,
        label,
        surface,
      };
    })
    .filter((item): item is MentionDatum => Boolean(item));
}

function buildRelationEdges(
  syntaxPayload: Record<string, unknown> | null,
  mappedMentions: MentionDatum[],
): RelationEdgeDatum[] {
  const rawSentences = Array.isArray(syntaxPayload?.sentences)
    ? (syntaxPayload?.sentences as Array<Record<string, unknown>>)
    : [];
  const edgeCounter = new Map<string, RelationEdgeDatum>();

  const insertEdge = (left: string, relation: string, right: string) => {
    const source = String(left || "").trim();
    const rel = String(relation || "rel").trim() || "rel";
    const target = String(right || "").trim();
    if (!source || !target) {
      return;
    }
    const edge = `${source} -> ${rel} -> ${target}`;
    const current = edgeCounter.get(edge) || {
      edge,
      relation: rel,
      count: 0,
    };
    current.count += 1;
    edgeCounter.set(edge, current);
  };

  let hasDependency = false;

  for (const sentence of rawSentences) {
    const tokens = Array.isArray(sentence.tokens)
      ? (sentence.tokens as Array<Record<string, unknown>>)
      : [];
    const tokenTextByIndex = new Map<number, string>();
    for (const token of tokens) {
      const tokenIndex = normalizeSentenceIndex(token.token_index ?? token.index ?? token.id);
      if (tokenIndex > 0) {
        tokenTextByIndex.set(tokenIndex, String(token.text || token.surface || "").trim());
      }
    }

    const dependencies = Array.isArray(sentence.dependencies)
      ? (sentence.dependencies as Array<Record<string, unknown>>)
      : [];

    if (dependencies.length > 0) {
      hasDependency = true;
    }

    for (const dep of dependencies) {
      const relation = String(dep.relation || dep.predicate || dep.task_key || "dep");
      const dependentIndex = normalizeSentenceIndex(dep.dependent_index ?? dep.dep_index ?? dep.source_index);
      const headIndex = normalizeSentenceIndex(dep.head_index ?? dep.target_index ?? dep.object_index);
      const source = String(dep.dependent || tokenTextByIndex.get(dependentIndex) || "");
      const target = String(dep.head || dep.object || tokenTextByIndex.get(headIndex) || "");
      insertEdge(source, relation, target);
    }
  }

  if (!hasDependency) {
    const mentionBySentence = new Map<number, Set<string>>();
    for (const mention of mappedMentions) {
      const bucket = mentionBySentence.get(mention.sentenceIndex) || new Set<string>();
      const token = mention.surface || `${mention.label}:${mention.sentenceIndex}`;
      if (token) {
        bucket.add(token);
      }
      mentionBySentence.set(mention.sentenceIndex, bucket);
    }

    for (const entities of mentionBySentence.values()) {
      const values = Array.from(entities).filter(Boolean).slice(0, 12);
      for (let i = 0; i < values.length; i += 1) {
        for (let j = i + 1; j < values.length; j += 1) {
          insertEdge(values[i], "cooccur", values[j]);
        }
      }
    }
  }

  return Array.from(edgeCounter.values())
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.edge.localeCompare(right.edge);
    })
    .slice(0, 20);
}

function colorFromLabel(label: string): string {
  const palette = [
    "#1677ff",
    "#13c2c2",
    "#52c41a",
    "#fa8c16",
    "#eb2f96",
    "#722ed1",
    "#2f54eb",
    "#faad14",
  ];
  const text = String(label || "entity");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

function buildTemporalSpiralGraph(
  mappedMentions: MentionDatum[],
): {
  nodes: TemporalNodeDatum[];
  edges: TemporalEdgeDatum[];
} {
  const mentionBySentence = new Map<number, Array<{ surface: string; label: string }>>();
  const nodeCounter = new Map<string, { label: string; type: string; count: number; firstSentence: number }>();
  const edgeCounter = new Map<string, TemporalEdgeDatum>();

  for (const mention of mappedMentions) {
    const surface = String(mention.surface || "").trim();
    const label = String(mention.label || "entity").trim() || "entity";
    if (!surface) {
      continue;
    }
    const sentenceIndex = normalizeSentenceIndex(mention.sentenceIndex);
    if (!sentenceIndex) {
      continue;
    }

    const bucket = mentionBySentence.get(sentenceIndex) || [];
    bucket.push({ surface, label });
    mentionBySentence.set(sentenceIndex, bucket);

    const current = nodeCounter.get(surface) || {
      label: surface,
      type: label,
      count: 0,
      firstSentence: sentenceIndex,
    };
    current.count += 1;
    current.firstSentence = Math.min(current.firstSentence, sentenceIndex);
    nodeCounter.set(surface, current);
  }

  for (const entries of mentionBySentence.values()) {
    const unique = new Set(entries.map((item) => item.surface));
    const values = Array.from(unique).slice(0, 14);
    for (let i = 0; i < values.length; i += 1) {
      for (let j = i + 1; j < values.length; j += 1) {
        const left = values[i];
        const right = values[j];
        const sourceId = left.localeCompare(right) <= 0 ? left : right;
        const targetId = left.localeCompare(right) <= 0 ? right : left;
        const key = `${sourceId}||${targetId}`;
        const edge = edgeCounter.get(key) || { sourceId, targetId, weight: 0 };
        edge.weight += 1;
        edgeCounter.set(key, edge);
      }
    }
  }

  const rawNodes = Array.from(nodeCounter.entries())
    .map(([id, value]) => ({ id, ...value }))
    .sort((left, right) => {
      if (left.firstSentence !== right.firstSentence) {
        return left.firstSentence - right.firstSentence;
      }
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.id.localeCompare(right.id);
    })
    .slice(0, 140);

  if (rawNodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const maxCount = rawNodes.reduce((max, item) => Math.max(max, item.count), 1);
  const centerX = 320;
  const centerY = 180;
  const startRadius = 24;
  const endRadius = 160;
  const turns = 6;
  const nodeCount = rawNodes.length;

  const nodes: TemporalNodeDatum[] = rawNodes.map((item, index) => {
    const progress = nodeCount > 1 ? index / (nodeCount - 1) : 0;
    const theta = progress * turns * Math.PI * 2;
    const spiralRadius = startRadius + (endRadius - startRadius) * progress;
    const radius = 3 + 11 * Math.sqrt(item.count / maxCount);
    return {
      id: item.id,
      label: item.label,
      type: item.type,
      count: item.count,
      sentenceIndex: item.firstSentence,
      x: centerX + Math.cos(theta) * spiralRadius,
      y: centerY + Math.sin(theta) * spiralRadius,
      radius,
    };
  });

  const nodeIds = new Set(nodes.map((item) => item.id));
  const edges = Array.from(edgeCounter.values())
    .filter((item) => nodeIds.has(item.sourceId) && nodeIds.has(item.targetId))
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 260);

  return { nodes, edges };
}

export default function ProjectDocumentKnowledgeVisualization(
  props: ProjectDocumentKnowledgeVisualizationProps,
) {
  const {
    selectedFilePath,
    fileContent,
    charStatsContent,
    nerStructuredContent,
    knowledgeState,
  } = props;
  const { t } = useTranslation();
  const {
    selectedSourceId: preferredSourceId,
    projectSourceId,
    projectSources,
    sourceContentById,
    sourceContentLoadingById,
    loadSourceContent,
  } = knowledgeState;

  const fallbackSourceId = useMemo(() => {
    const first = projectSources.find((item) => {
      const sourceId = String(item.id || "").trim();
      return sourceId.length > 0;
    });
    return String(first?.id || "").trim();
  }, [projectSources]);

  const mappedProjectSourceId = useMemo(() => {
    const normalized = String(projectSourceId || "").trim();
    if (!normalized) {
      return "";
    }
    return projectSources.some((item) => String(item.id || "").trim() === normalized)
      ? normalized
      : "";
  }, [projectSourceId, projectSources]);

  const selectedSourceId = String(
    preferredSourceId || mappedProjectSourceId || fallbackSourceId || "",
  ).trim();

  useEffect(() => {
    if (!selectedSourceId) {
      return;
    }
    if (sourceContentById[selectedSourceId]) {
      return;
    }
    if (sourceContentLoadingById[selectedSourceId]) {
      return;
    }
    if (requestedSourceIds.has(selectedSourceId)) {
      return;
    }
    requestedSourceIds.add(selectedSourceId);
    void loadSourceContent(selectedSourceId).catch(() => {});
  }, [
    loadSourceContent,
    selectedSourceId,
    sourceContentById,
    sourceContentLoadingById,
  ]);

  const mergedDocuments = useMemo(() => {
    const bucket: KnowledgeSourceDocument[] = [];
    const visited = new Set<string>();

    for (const content of Object.values(sourceContentById)) {
      const docs = content?.documents || [];
      for (const doc of docs) {
        const docKey = normalizePath(String(doc.path || doc.title || ""));
        if (docKey && visited.has(docKey)) {
          continue;
        }
        if (docKey) {
          visited.add(docKey);
        }
        bucket.push(doc);
      }
    }

    return bucket;
  }, [sourceContentById]);

  const currentDocument = useMemo(
    () => resolveCurrentDocument(sourceContentById[selectedSourceId]?.documents || mergedDocuments, selectedFilePath),
    [mergedDocuments, selectedFilePath, selectedSourceId, sourceContentById],
  );

  const chartData = useMemo(() => {
    const nerPayload =
      safeJsonParse(currentDocument?.ner_structured_text)
      || safeJsonParse(nerStructuredContent);
    const syntaxPayload = safeJsonParse(currentDocument?.syntax_structured_text);
    const sentenceRanges = buildSentenceRanges(fileContent, syntaxPayload);
    const sentenceWordData = parseSentenceCharStats(charStatsContent);
    const mentions = Array.isArray(nerPayload?.entity_mentions)
      ? (nerPayload?.entity_mentions as Array<Record<string, unknown>>)
      : [];
    const mappedMentions = mapMentionsToSentences(mentions, sentenceRanges);

    const entitiesBySentence = new Map<number, number>();
    const labelCounter = new Map<string, number>();
    const topEntityCounter = new Map<string, number>();

    for (const mention of mappedMentions) {
      entitiesBySentence.set(
        mention.sentenceIndex,
        (entitiesBySentence.get(mention.sentenceIndex) || 0) + 1,
      );
      labelCounter.set(mention.label, (labelCounter.get(mention.label) || 0) + 1);
      if (mention.surface) {
        topEntityCounter.set(mention.surface, (topEntityCounter.get(mention.surface) || 0) + 1);
      }
    }

    let mentionTotal = mappedMentions.length;

    if (labelCounter.size === 0) {
      const catalog = Array.isArray(nerPayload?.entity_catalog)
        ? (nerPayload?.entity_catalog as Array<Record<string, unknown>>)
        : [];
      for (const item of catalog) {
        const label = String(item.label || "entity").trim() || "entity";
        const count = Number(item.mention_count || 0);
        const mentionCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
        labelCounter.set(label, (labelCounter.get(label) || 0) + mentionCount);
        const entity = String(item.normalized || item.surface || item.text || "").trim();
        if (entity) {
          topEntityCounter.set(entity, (topEntityCounter.get(entity) || 0) + mentionCount);
        }
        mentionTotal += mentionCount;
      }
    }

    const sentenceEntityData = sentenceRanges.map((item) => ({
      sentence: `S${item.sentenceIndex}`,
      count: entitiesBySentence.get(item.sentenceIndex) || 0,
    }));

    const entityTypeData = Array.from(labelCounter.entries())
      .map(([type, value]) => ({ type, value }))
      .sort((left, right) => right.value - left.value);

    const topEntityData: NerTopEntityDatum[] = Array.from(topEntityCounter.entries())
      .map(([entity, count]) => ({ entity, count }))
      .filter((item) => item.count > 0)
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return left.entity.localeCompare(right.entity);
      })
      .slice(0, 20);

    const relationEdges = buildRelationEdges(syntaxPayload, mappedMentions);
    const temporalSpiral = buildTemporalSpiralGraph(mappedMentions);

    const sentenceTotal = sentenceWordData.length || sentenceRanges.length || 0;
    const entityTotal = topEntityCounter.size;
    const avgMentionsPerSentence = sentenceTotal > 0 ? mentionTotal / sentenceTotal : 0;

    return {
      sentenceWordData,
      sentenceEntityData,
      topEntityData,
      entityTypeData,
      relationEdges,
      temporalSpiral,
      hasNer: topEntityData.length > 0 || entityTypeData.length > 0,
      nerSummary: {
        entityTotal,
        mentionTotal,
        sentenceTotal,
        avgMentionsPerSentence,
      },
      hasSyntax: relationEdges.length > 0,
    };
  }, [charStatsContent, currentDocument, fileContent, nerStructuredContent]);
  const isMarkdownDocument = isMarkdownDocumentPath(selectedFilePath);
  const outlineItems = useMemo(() => {
    if (!isMarkdownDocument) {
      return [];
    }
    return parseMarkdownOutline(fileContent);
  }, [fileContent, isMarkdownDocument]);
  const [collapsedOutlineIds, setCollapsedOutlineIds] = useState<Set<string>>(new Set());

  const outlineItemsWithChildren = useMemo(() => {
    return outlineItems.map((item, index) => {
      const next = outlineItems[index + 1];
      return {
        ...item,
        hasChildren: Boolean(next && next.level > item.level),
      };
    });
  }, [outlineItems]);

  const visibleOutlineItems = useMemo(() => {
    const visible: Array<(typeof outlineItemsWithChildren)[number]> = [];
    const hiddenUnderLevelStack: number[] = [];

    for (const item of outlineItemsWithChildren) {
      while (
        hiddenUnderLevelStack.length > 0
        && item.level <= hiddenUnderLevelStack[hiddenUnderLevelStack.length - 1]
      ) {
        hiddenUnderLevelStack.pop();
      }

      if (hiddenUnderLevelStack.length > 0) {
        continue;
      }

      visible.push(item);
      if (collapsedOutlineIds.has(item.id) && item.hasChildren) {
        hiddenUnderLevelStack.push(item.level);
      }
    }

    return visible;
  }, [collapsedOutlineIds, outlineItemsWithChildren]);

  if (!selectedFilePath) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t("projects.selectFile", "Select a file to preview")}
      />
    );
  }

  return (
    <div className={styles.documentKnowledgeVizWrap}>
      {!currentDocument && (
        <Typography.Text type="secondary" className={styles.documentKnowledgeVizHint}>
          {t(
            "projects.workbench.knowledgeCurrentDocMissing",
            "Current file has no matched knowledge document yet. Showing lightweight sentence stats only.",
          )}
        </Typography.Text>
      )}

      <Card
        size="small"
        className={styles.documentKnowledgeVizCard}
        title={t("projects.workbench.knowledgeMarkdownOutline", "Markdown 大纲导航")}
      >
        {isMarkdownDocument ? (
          outlineItems.length > 0 ? (
            <div className={styles.documentOutlineList}>
                {visibleOutlineItems.map((item) => {
                  const isCollapsed = collapsedOutlineIds.has(item.id);
                  return (
                <div
                  key={item.id}
                    className={`${styles.documentOutlineItem} ${styles[`documentOutlineLevel${Math.max(1, Math.min(item.level, 6))}`]}`}
                >
                    {item.hasChildren ? (
                      <Button
                        type="text"
                        size="small"
                        className={styles.documentOutlineToggle}
                        aria-label={isCollapsed
                          ? t("projects.workbench.knowledgeOutlineExpand", "Expand")
                          : t("projects.workbench.knowledgeOutlineCollapse", "Collapse")}
                        onClick={() => {
                          setCollapsedOutlineIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.id)) {
                              next.delete(item.id);
                            } else {
                              next.add(item.id);
                            }
                            return next;
                          });
                        }}
                      >
                        {isCollapsed ? "▸" : "▾"}
                      </Button>
                    ) : (
                      <span className={styles.documentOutlineTogglePlaceholder} aria-hidden="true" />
                    )}
                    <span
                      className={`${styles.documentOutlinePrefix} ${styles[`documentOutlinePrefixLevel${Math.max(1, Math.min(item.level, 6))}`]}`}
                      aria-hidden="true"
                    >
                      {item.level <= 2 ? "◆" : "•"}
                    </span>
                  <Button
                    type="link"
                    className={styles.documentOutlineButton}
                    onClick={() => {
                      if (typeof window === "undefined") {
                        return;
                      }
                      const detail: MarkdownOutlineJumpDetail = {
                        filePath: selectedFilePath,
                        headingId: item.id,
                        headingText: item.text,
                        line: item.line,
                      };
                      window.dispatchEvent(
                        new CustomEvent<MarkdownOutlineJumpDetail>(
                          PROJECT_MARKDOWN_OUTLINE_JUMP_EVENT,
                          { detail },
                        ),
                      );
                    }}
                  >
                    {item.text}
                  </Button>
                  <Typography.Text type="secondary" className={styles.documentOutlineLine}>
                      {`H${item.level} · L${item.line}`}
                  </Typography.Text>
                </div>
                  );
                })}
            </div>
          ) : (
            <div className={styles.documentKnowledgeVizEmpty}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t(
                  "projects.workbench.knowledgeMarkdownOutlineEmpty",
                  "No markdown headings found in this document",
                )}
              />
            </div>
          )
        ) : (
          <div className={styles.documentKnowledgeVizEmpty}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t(
                "projects.workbench.knowledgeMarkdownOutlineNotMarkdown",
                "Outline navigation is available for Markdown files",
              )}
            />
          </div>
        )}
      </Card>

      <Card
        size="small"
        className={styles.documentKnowledgeVizCard}
        title={t("projects.workbench.knowledgeSentenceChars", "逐句字数分布")}
      >
        {chartData.sentenceWordData.length > 0 ? (
          <div className={styles.documentKnowledgeVizChart}>
            <Column
              data={chartData.sentenceWordData}
              xField="sentence"
              yField="chars"
              color="#5b8ff9"
              height={320}
              padding="auto"
              axis={{
                x: false,
                y: false,
              }}
            />
          </div>
        ) : (
          <div className={styles.documentKnowledgeVizEmpty}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t(
                "projects.workbench.knowledgeCharStatsMissing",
                "Waiting for .char-stats.json artifact",
              )}
            />
          </div>
        )}
      </Card>

      <Card
        size="small"
        className={styles.documentKnowledgeVizCard}
        title={t("projects.workbench.knowledgeNerTopEntities", "NER Top 实体词频（Top 20）")}
        extra={
          <Typography.Text type="secondary" className={styles.documentKnowledgeVizHintInline}>
            {t(
              "projects.workbench.knowledgeNerSummary",
              "Entities: {{entityTotal}} · Mentions: {{mentionTotal}} · Avg/sentence: {{avg}}",
              {
                entityTotal: chartData.nerSummary.entityTotal,
                mentionTotal: chartData.nerSummary.mentionTotal,
                avg: chartData.nerSummary.avgMentionsPerSentence.toFixed(2),
              },
            )}
          </Typography.Text>
        }
      >
        {chartData.topEntityData.length > 0 ? (
          <div className={styles.documentKnowledgeVizChart}>
            <Column
              data={chartData.topEntityData}
              xField="entity"
              yField="count"
              height={320}
              color="#36cfc9"
              padding="auto"
              axis={{
                x: false,
                y: false,
              }}
            />
          </div>
        ) : (
          <div className={styles.documentKnowledgeVizEmpty}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("projects.workbench.knowledgeNerEmpty", "No NER entities for this document")}
            />
          </div>
        )}
      </Card>

      <Card
        size="small"
        className={styles.documentKnowledgeVizCard}
        title={t("projects.workbench.knowledgeNerPie", "NER 实体类型占比")}
      >
        {chartData.entityTypeData.length > 0 ? (
          <div className={styles.documentKnowledgeVizChart}>
            <Pie
              data={chartData.entityTypeData}
              angleField="value"
              colorField="type"
              height={340}
              padding="auto"
              label={{
                text: "type",
                style: { fontSize: 11 },
              }}
              legend={{ position: "bottom" }}
              tooltip={{
                items: [
                  (datum: { type: string; value: number }) => ({
                    name: datum.type,
                    value: datum.value,
                  }),
                ],
              }}
            />
          </div>
        ) : (
          <div className={styles.documentKnowledgeVizEmpty}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("projects.workbench.knowledgeNerTypeEmpty", "No entity type distribution yet")}
            />
          </div>
        )}
      </Card>

      <Card
        size="small"
        className={styles.documentKnowledgeVizCard}
        title={t("projects.workbench.knowledgeTemporalSpiral", "NER 准时序螺旋共现图（原始计数）")}
        extra={
          <Typography.Text type="secondary" className={styles.documentKnowledgeVizHintInline}>
            {t(
              "projects.workbench.knowledgeTemporalSpiralHint",
              "Time base: sentence_index (quasi-time), Weight: raw count (non-normalized)",
            )}
          </Typography.Text>
        }
      >
        {chartData.temporalSpiral.nodes.length > 0 ? (
          <div className={styles.documentKnowledgeVizChart}>
            <svg viewBox="0 0 640 360" width="100%" height="100%" role="img" aria-label="Temporal spiral co-occurrence map">
              <g>
                {chartData.temporalSpiral.edges.map((edge) => {
                  const source = chartData.temporalSpiral.nodes.find((item) => item.id === edge.sourceId);
                  const target = chartData.temporalSpiral.nodes.find((item) => item.id === edge.targetId);
                  if (!source || !target) {
                    return null;
                  }
                  const strokeWidth = Math.max(0.6, Math.min(4.4, edge.weight * 0.55));
                  const opacity = Math.max(0.12, Math.min(0.55, 0.08 + edge.weight * 0.04));
                  return (
                    <line
                      key={`${edge.sourceId}-${edge.targetId}`}
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      stroke="#8c8c8c"
                      strokeOpacity={opacity}
                      strokeWidth={strokeWidth}
                    >
                      <title>{`${edge.sourceId} ↔ ${edge.targetId} : ${edge.weight}`}</title>
                    </line>
                  );
                })}
              </g>

              <g>
                {chartData.temporalSpiral.nodes.map((node) => (
                  <circle
                    key={node.id}
                    cx={node.x}
                    cy={node.y}
                    r={node.radius}
                    fill={colorFromLabel(node.type)}
                    fillOpacity={0.86}
                    stroke="#ffffff"
                    strokeWidth={1}
                  >
                    <title>{`${node.label} | type=${node.type} | count=${node.count} | S${node.sentenceIndex}`}</title>
                  </circle>
                ))}
              </g>
            </svg>
          </div>
        ) : (
          <div className={styles.documentKnowledgeVizEmpty}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t(
                "projects.workbench.knowledgeTemporalSpiralEmpty",
                "No sentence-level mentions, temporal co-occurrence cannot be built",
              )}
            />
          </div>
        )}
      </Card>

      <Card
        size="small"
        className={styles.documentKnowledgeVizCard}
        title={t("projects.workbench.knowledgeSyntaxRelation", "Syntax 关系聚合图（Top 20）")}
        extra={
          <Typography.Text type="secondary" className={styles.documentKnowledgeVizHintInline}>
            {chartData.hasSyntax
              ? t("projects.workbench.knowledgeSyntaxModeCooccur", "Fallback mode: cooccur when dependencies are unavailable")
              : t("projects.workbench.knowledgeSyntaxEmptyHint", "No syntax relation data")}
          </Typography.Text>
        }
      >
        {chartData.relationEdges.length > 0 ? (
          <div className={styles.documentKnowledgeVizChart}>
            <Column
              data={chartData.relationEdges}
              xField="edge"
              yField="count"
              colorField="relation"
              height={340}
              padding="auto"
              axis={{
                x: false,
                y: false,
              }}
              legend={{ position: "top" }}
            />
          </div>
        ) : (
          <div className={styles.documentKnowledgeVizEmpty}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("projects.workbench.knowledgeSyntaxEmpty", "No syntax relations for this document")}
            />
          </div>
        )}
      </Card>
    </div>
  );
}