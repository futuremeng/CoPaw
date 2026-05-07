import { Column, Line, Pie } from "@ant-design/plots";
import { Card, Empty, Typography } from "antd";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { KnowledgeSourceDocument } from "../../../api/types";
import styles from "./index.module.less";
import type { ProjectKnowledgeState } from "./useProjectKnowledgeState";

interface ProjectDocumentKnowledgeVisualizationProps {
  selectedFilePath: string;
  fileContent: string;
  charStatsContent: string;
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
  const selected = normalizePath(selectedFilePath);
  if (!selected) {
    return null;
  }

  for (const doc of documents) {
    const candidates = [
      doc.path,
      doc.title,
      doc.snapshot_relative_path,
      doc.snapshot_path,
      doc.chunk_path,
      doc.ner_structured_path,
      doc.syntax_structured_path,
    ]
      .map((item) => normalizePath(String(item || "")))
      .filter(Boolean);

    if (candidates.some((item) => item === selected || item.endsWith(`/${selected}`) || selected.endsWith(`/${item}`))) {
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

export default function ProjectDocumentKnowledgeVisualization(
  props: ProjectDocumentKnowledgeVisualizationProps,
) {
  const {
    selectedFilePath,
    fileContent,
    charStatsContent,
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
      const sourceId = String(item.source_id || item.id || "").trim();
      return sourceId.length > 0;
    });
    return String(first?.source_id || first?.id || "").trim();
  }, [projectSources]);

  const selectedSourceId = String(
    preferredSourceId || projectSourceId || fallbackSourceId || "",
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
    const nerPayload = safeJsonParse(currentDocument?.ner_structured_text);
    const syntaxPayload = safeJsonParse(currentDocument?.syntax_structured_text);
    const sentenceRanges = buildSentenceRanges(fileContent, syntaxPayload);
    const sentenceWordData = parseSentenceCharStats(charStatsContent);
    const mentions = Array.isArray(nerPayload?.entity_mentions)
      ? (nerPayload?.entity_mentions as Array<Record<string, unknown>>)
      : [];
    const mappedMentions = mapMentionsToSentences(mentions, sentenceRanges);

    const entitiesBySentence = new Map<number, number>();
    const labelCounter = new Map<string, number>();

    for (const mention of mappedMentions) {
      entitiesBySentence.set(
        mention.sentenceIndex,
        (entitiesBySentence.get(mention.sentenceIndex) || 0) + 1,
      );
      labelCounter.set(mention.label, (labelCounter.get(mention.label) || 0) + 1);
    }

    if (labelCounter.size === 0) {
      const catalog = Array.isArray(nerPayload?.entity_catalog)
        ? (nerPayload?.entity_catalog as Array<Record<string, unknown>>)
        : [];
      for (const item of catalog) {
        const label = String(item.label || "entity").trim() || "entity";
        const count = Number(item.mention_count || 0);
        labelCounter.set(label, (labelCounter.get(label) || 0) + (Number.isFinite(count) ? count : 0));
      }
    }

    const sentenceEntityData = sentenceRanges.map((item) => ({
      sentence: `S${item.sentenceIndex}`,
      count: entitiesBySentence.get(item.sentenceIndex) || 0,
    }));

    const entityTypeData = Array.from(labelCounter.entries())
      .map(([type, value]) => ({ type, value }))
      .sort((left, right) => right.value - left.value);

    const relationEdges = buildRelationEdges(syntaxPayload, mappedMentions);

    return {
      sentenceWordData,
      sentenceEntityData,
      entityTypeData,
      relationEdges,
      hasNer: mentions.length > 0 || entityTypeData.length > 0,
      hasSyntax: relationEdges.length > 0,
    };
  }, [charStatsContent, currentDocument, fileContent]);

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
        title={t("projects.workbench.knowledgeSentenceChars", "L1 逐句字数分布")}
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
        title={t("projects.workbench.knowledgeNerLine", "NER 逐句实体数量曲线")}
      >
        {chartData.hasNer ? (
          <div className={styles.documentKnowledgeVizChart}>
            <Line
              data={chartData.sentenceEntityData}
              xField="sentence"
              yField="count"
              height={320}
              point={{ size: 2 }}
              smooth
              color="#5ad8a6"
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