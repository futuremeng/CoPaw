import { Empty, Tag, Typography } from "antd";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { KnowledgeSourceDocument } from "../../../api/types";
import styles from "./index.module.less";
import type { ProjectKnowledgeState } from "./useProjectKnowledgeState";

interface ProjectKnowledgeNerPanelProps {
  knowledgeState: ProjectKnowledgeState;
}

interface NerEntityRow {
  key: string;
  normalized: string;
  label: string;
  mentionCount: number;
}

function safeJsonParse(text: string): Record<string, unknown> | null {
  if (!text.trim()) {
    return null;
  }
  try {
    const payload = JSON.parse(text);
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalizeLabel(value: unknown): string {
  return String(value || "entity").trim() || "entity";
}

function normalizeName(value: unknown): string {
  return String(value || "").trim();
}

export default function ProjectKnowledgeNerPanel(props: ProjectKnowledgeNerPanelProps) {
  const { t } = useTranslation();
  const { knowledgeState } = props;

  const selectedSourceId = String(
    knowledgeState.selectedSourceId || knowledgeState.projectSourceId || "",
  ).trim();
  const sourceContent = knowledgeState.sourceContentById[selectedSourceId];
  const documents = sourceContent?.documents || [];

  const summary = useMemo(() => {
    const entityMap = new Map<string, NerEntityRow>();
    const labelMap = new Map<string, number>();
    const inputModeMap = new Map<string, number>();
    const processedArtifacts = new Set<string>();

    let readyDocuments = 0;
    let unavailableDocuments = 0;
    let mentionTotal = 0;

    for (const doc of documents) {
      const typedDoc = doc as KnowledgeSourceDocument;
      const artifactKey = String(
        typedDoc.ner_structured_path || typedDoc.ner_path || typedDoc.path || typedDoc.title || "",
      ).trim();
      if (artifactKey && processedArtifacts.has(artifactKey)) {
        continue;
      }
      if (artifactKey) {
        processedArtifacts.add(artifactKey);
      }

      const status = String(typedDoc.ner_status || "").trim().toLowerCase();
      if (status === "ready") {
        readyDocuments += 1;
      } else {
        unavailableDocuments += 1;
      }

      const mode = String(typedDoc.ner_input_mode || "").trim();
      if (mode) {
        inputModeMap.set(mode, (inputModeMap.get(mode) || 0) + 1);
      }

      const structuredPayload = safeJsonParse(String(typedDoc.ner_structured_text || ""));
      const catalog = Array.isArray(structuredPayload?.entity_catalog)
        ? (structuredPayload?.entity_catalog as Array<Record<string, unknown>>)
        : [];
      const mentions = Array.isArray(structuredPayload?.entity_mentions)
        ? (structuredPayload?.entity_mentions as Array<Record<string, unknown>>)
        : [];

      if (mentions.length > 0) {
        mentionTotal += mentions.length;
      } else {
        mentionTotal += Number(typedDoc.ner_entity_count || 0);
      }

      for (const item of catalog) {
        const normalized = normalizeName(item.normalized);
        const label = normalizeLabel(item.label);
        const mentionCount = Number(item.mention_count || 0);
        if (!normalized) {
          continue;
        }

        const key = `${label}::${normalized}`;
        const current = entityMap.get(key) || {
          key,
          normalized,
          label,
          mentionCount: 0,
        };
        current.mentionCount += mentionCount;
        entityMap.set(key, current);
        labelMap.set(label, (labelMap.get(label) || 0) + mentionCount);
      }
    }

    const topEntities = Array.from(entityMap.values())
      .sort((left, right) => {
        if (right.mentionCount !== left.mentionCount) {
          return right.mentionCount - left.mentionCount;
        }
        return left.normalized.localeCompare(right.normalized);
      })
      .slice(0, 100);

    const labelRanking = Array.from(labelMap.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count);

    const inputModeSummary = Array.from(inputModeMap.entries())
      .map(([mode, count]) => ({ mode, count }))
      .sort((left, right) => right.count - left.count);

    return {
      readyDocuments,
      unavailableDocuments,
      mentionTotal,
      uniqueEntityCount: entityMap.size,
      topEntities,
      labelRanking,
      inputModeSummary,
    };
  }, [documents]);

  return (
    <div className={styles.projectKnowledgeWorkbench}>
      <div className={styles.projectKnowledgeTabHeader}>
        <div>
          <Typography.Title level={5} className={styles.projectKnowledgeSectionTitle}>
            {t("projects.knowledgeDock.tabNer", "NER")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t(
              "projects.knowledge.nerRoleHint",
              "NER uses Interlinear sentence-normalized text as input and persists results/statistics under .knowledge/ner.",
            )}
          </Typography.Text>
        </div>
      </div>

      {documents.length === 0 ? (
        <Empty
          description={t(
            "projects.knowledge.nerEmptySource",
            "No source content loaded yet. Open Sources or trigger sync first.",
          )}
        />
      ) : (
        <>
          <div className={styles.projectKnowledgeSignalGrid}>
            <div className={styles.projectKnowledgeSignalCard}>
              <Typography.Text type="secondary">
                {t("projects.knowledge.nerReadyChunks", "Ready Documents")}
              </Typography.Text>
              <Typography.Text strong>{summary.readyDocuments}</Typography.Text>
            </div>
            <div className={styles.projectKnowledgeSignalCard}>
              <Typography.Text type="secondary">
                {t("projects.knowledge.nerUnavailableChunks", "Unavailable Documents")}
              </Typography.Text>
              <Typography.Text strong>{summary.unavailableDocuments}</Typography.Text>
            </div>
            <div className={styles.projectKnowledgeSignalCard}>
              <Typography.Text type="secondary">
                {t("projects.knowledge.nerUniqueEntities", "Unique Entities")}
              </Typography.Text>
              <Typography.Text strong>{summary.uniqueEntityCount}</Typography.Text>
            </div>
            <div className={styles.projectKnowledgeSignalCard}>
              <Typography.Text type="secondary">
                {t("projects.knowledge.nerEntityMentions", "Entity Mentions")}
              </Typography.Text>
              <Typography.Text strong>{summary.mentionTotal}</Typography.Text>
            </div>
          </div>

          <div className={styles.projectKnowledgePanelBody}>
            <Typography.Text type="secondary">
              {t("projects.knowledge.nerLabelDistribution", "Label Distribution")}
            </Typography.Text>
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {summary.labelRanking.length === 0 ? (
                <Typography.Text type="secondary">
                  {t("projects.knowledge.nerNoLabelDistribution", "No label stats yet")}
                </Typography.Text>
              ) : (
                summary.labelRanking.map((item) => (
                  <Tag key={item.label}>
                    {item.label}: {item.count}
                  </Tag>
                ))
              )}
            </div>

            <Typography.Text type="secondary" style={{ display: "block", marginTop: 12 }}>
              {t("projects.knowledge.nerInputModes", "Input Modes")}
            </Typography.Text>
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {summary.inputModeSummary.length === 0 ? (
                <Typography.Text type="secondary">
                  {t("projects.knowledge.nerNoInputModes", "No input mode stats yet")}
                </Typography.Text>
              ) : (
                summary.inputModeSummary.map((item) => (
                  <Tag key={item.mode}>
                    {item.mode}: {item.count}
                  </Tag>
                ))
              )}
            </div>

            <div style={{ marginTop: 16 }}>
              <Typography.Text type="secondary">
                {t("projects.knowledge.nerTopEntities", "Top Entities")}
              </Typography.Text>
              {summary.topEntities.length === 0 ? (
                <Empty
                  style={{ marginTop: 8 }}
                  description={t("projects.knowledge.nerNoEntities", "No NER entities yet")}
                />
              ) : (
                <div className={styles.projectKnowledgeSelectableList} style={{ marginTop: 8 }}>
                  {summary.topEntities.slice(0, 50).map((item: NerEntityRow) => (
                    <div key={item.key} className={styles.projectKnowledgeSelectableItem}>
                      <div className={styles.projectKnowledgeSelectableItemHeader}>
                        <Typography.Text strong>{item.normalized}</Typography.Text>
                        <Tag>{item.label}</Tag>
                      </div>
                      <Typography.Text type="secondary">
                        {t("projects.knowledge.nerTableMentions", "Mentions")}: {item.mentionCount}
                      </Typography.Text>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
