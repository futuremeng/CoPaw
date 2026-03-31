import { Empty } from "antd";
import { useTranslation } from "react-i18next";
import type { ProjectPipelineRunDetail } from "../../../api/types/agents";
import styles from "./index.module.less";

interface ProjectEvidencePanelProps {
  runDetail: ProjectPipelineRunDetail | null;
}

export default function ProjectEvidencePanel({
  runDetail,
}: ProjectEvidencePanelProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.previewBody}>
      {!runDetail ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("projects.pipeline.noRun", "No run")}
        />
      ) : (
        <div className={styles.metricPanel}>
          {runDetail.steps.map((step) => (
            <div key={step.id} className={styles.metricBlock}>
              <div className={styles.itemTitle}>{step.name}</div>
              {step.evidence.length === 0 ? (
                <div className={styles.itemMeta}>No evidence</div>
              ) : (
                step.evidence.map((item) => (
                  <div key={`${step.id}-${item}`} className={styles.itemMeta}>
                    {item}
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}