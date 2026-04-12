import { Alert, Button, Empty, Input, Select, Typography } from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./index.module.less";
import type { ProjectKnowledgeState } from "./useProjectKnowledgeState";

interface ProjectKnowledgeRelationsPanelProps {
  knowledgeState: ProjectKnowledgeState;
  onRunSuggestedQuery?: (query: string) => void;
}

export default function ProjectKnowledgeRelationsPanel(
  props: ProjectKnowledgeRelationsPanelProps,
) {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState("");
  const [predicateFilter, setPredicateFilter] = useState("");

  const predicateOptions = useMemo(
    () => Array.from(new Set(props.knowledgeState.relationRecords.map((item) => item.predicate))).sort(),
    [props.knowledgeState.relationRecords],
  );

  const filteredRecords = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return props.knowledgeState.relationRecords.filter((item) => {
      if (predicateFilter && item.predicate !== predicateFilter) {
        return false;
      }
      if (!normalizedKeyword) {
        return true;
      }
      return [
        item.subject,
        item.predicate,
        item.object,
        item.document_title,
        item.document_path,
      ].some((part) => part.toLowerCase().includes(normalizedKeyword));
    });
  }, [keyword, predicateFilter, props.knowledgeState.relationRecords]);

  const relationSummary = useMemo(() => ({
    relations: props.knowledgeState.relationRecords.length,
    entities: new Set(props.knowledgeState.relationRecords.flatMap((item) => [item.subject, item.object])).size,
    predicates: predicateOptions.length,
    sources: new Set(props.knowledgeState.relationRecords.map((item) => item.source_id)).size,
  }), [predicateOptions.length, props.knowledgeState.relationRecords]);

  return (
    <div className={styles.projectKnowledgeWorkbench}>
      <div className={styles.projectKnowledgeTabHeader}>
        <div>
          <Typography.Title level={5} className={styles.projectKnowledgeSectionTitle}>
            {t("projects.knowledgeDock.tabRelations", "Relations")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {props.knowledgeState.graphQueryText
              ? props.knowledgeState.graphQueryText
              : t("projects.knowledge.relationsHint", "Inspect extracted subject-predicate-object relations.")}
          </Typography.Text>
        </div>
        <div className={styles.projectKnowledgeTabActions}>
          <Button
            size="small"
            onClick={() => {
              void props.knowledgeState.runGraphQuery(
                props.knowledgeState.graphQueryText || props.knowledgeState.suggestedQuery,
              );
            }}
            loading={props.knowledgeState.graphLoading}
          >
            {t("projects.knowledge.actionRefreshSignals", "Refresh")}
          </Button>
          {!props.knowledgeState.relationRecords.length ? (
            <Button
              size="small"
              type="primary"
              onClick={() => props.onRunSuggestedQuery?.(props.knowledgeState.suggestedQuery)}
            >
              {t("projects.knowledge.actionRunSuggestedQuery")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className={styles.projectKnowledgeSignalGrid}>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalRelations")}</Typography.Text>
          <Typography.Text strong>{relationSummary.relations}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.entities", "Entities")}</Typography.Text>
          <Typography.Text strong>{relationSummary.entities}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.predicates", "Relation Types")}</Typography.Text>
          <Typography.Text strong>{relationSummary.predicates}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.sources", "Sources")}</Typography.Text>
          <Typography.Text strong>{relationSummary.sources}</Typography.Text>
        </div>
      </div>

      {props.knowledgeState.graphError ? (
        <Alert type="error" showIcon message={props.knowledgeState.graphError} />
      ) : null}

      <div className={styles.projectKnowledgeControls}>
        <Input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={t("projects.knowledge.relationSearchPlaceholder", "Search entities, relations, or document paths")}
          allowClear
        />
        <Select
          value={predicateFilter || undefined}
          allowClear
          size="small"
          placeholder={t("projects.knowledge.relationTypeFilter", "Filter by relation type")}
          options={predicateOptions.map((item) => ({ label: item, value: item }))}
          onChange={(value) => setPredicateFilter(String(value || ""))}
          style={{ width: 220 }}
        />
      </div>

      <div className={styles.projectKnowledgePanelBody}>
        {props.knowledgeState.graphLoading && !props.knowledgeState.graphResult ? (
          <div className={styles.projectKnowledgeEmpty}><Empty description={t("common.loading", "Loading")} /></div>
        ) : filteredRecords.length ? (
          <div className={styles.projectKnowledgeRelationList}>
            {filteredRecords.map((record, index) => (
              <div key={`${record.subject}-${record.predicate}-${record.object}-${index}`} className={styles.projectKnowledgeRelationCard}>
                <div className={styles.projectKnowledgeRelationMain}>
                  <Typography.Text strong>{record.subject}</Typography.Text>
                  <Typography.Text type="secondary">{record.predicate}</Typography.Text>
                  <Typography.Text>{record.object}</Typography.Text>
                </div>
                <div className={styles.projectKnowledgeMetaLine}>
                  <span>{record.document_title || record.document_path || record.source_id}</span>
                  <span>{record.source_type}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.projectKnowledgeEmpty}>
            <Empty description={t("projects.knowledge.emptyResult")} />
          </div>
        )}
      </div>
    </div>
  );
}
