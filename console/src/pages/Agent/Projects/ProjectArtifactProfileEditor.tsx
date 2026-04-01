import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Empty, Input, Modal, Select, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ProjectArtifactItem,
  ProjectArtifactProfile,
} from "../../../api/types/agents";
import styles from "./index.module.less";

type ArtifactKindKey = keyof ProjectArtifactProfile;

const ARTIFACT_KIND_META: Array<{
  key: ArtifactKindKey;
  kind: ProjectArtifactItem["kind"];
  color: string;
  labelKey: string;
  defaultLabel: string;
}> = [
  {
    key: "skills",
    kind: "skill",
    color: "blue",
    labelKey: "projects.artifacts.skill",
    defaultLabel: "Skills",
  },
  {
    key: "scripts",
    kind: "script",
    color: "geekblue",
    labelKey: "projects.artifacts.script",
    defaultLabel: "Scripts",
  },
  {
    key: "flows",
    kind: "flow",
    color: "purple",
    labelKey: "projects.artifacts.flow",
    defaultLabel: "Flows",
  },
  {
    key: "cases",
    kind: "case",
    color: "gold",
    labelKey: "projects.artifacts.case",
    defaultLabel: "Cases",
  },
];

const STATUS_OPTIONS = ["draft", "active", "stable", "deprecated"];
const ORIGIN_OPTIONS = [
  "project-distilled",
  "market-imported",
  "manual",
  "external-reference",
];

function cloneArtifactItem(item: ProjectArtifactItem): ProjectArtifactItem {
  return {
    ...item,
    tags: [...(item.tags || [])],
    derived_from_ids: [...(item.derived_from_ids || [])],
  };
}

function cloneArtifactProfile(
  profile?: ProjectArtifactProfile,
): ProjectArtifactProfile {
  return {
    skills: (profile?.skills || []).map(cloneArtifactItem),
    scripts: (profile?.scripts || []).map(cloneArtifactItem),
    flows: (profile?.flows || []).map(cloneArtifactItem),
    cases: (profile?.cases || []).map(cloneArtifactItem),
  };
}

function slugifyArtifactId(raw: string, fallback: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function createEmptyArtifactItem(
  kind: ProjectArtifactItem["kind"],
  index: number,
): ProjectArtifactItem {
  return {
    id: `${kind}-${index + 1}`,
    name: "",
    kind,
    status: "draft",
    version: "",
    tags: [],
    origin: "project-distilled",
    derived_from_ids: [],
    distillation_note: "",
    market_source_id: null,
    market_item_id: null,
  };
}

function normalizeArtifactProfile(
  profile: ProjectArtifactProfile,
): ProjectArtifactProfile {
  const normalized: ProjectArtifactProfile = {
    skills: [],
    scripts: [],
    flows: [],
    cases: [],
  };

  for (const meta of ARTIFACT_KIND_META) {
    const seen = new Set<string>();
    const items: ProjectArtifactItem[] = [];
    profile[meta.key].forEach((item, index) => {
        const name = item.name.trim();
        if (!name) {
          return;
        }
        const id = slugifyArtifactId(item.id || name, `${meta.kind}-${index + 1}`);
        const dedupedId = seen.has(id) ? `${id}-${index + 1}` : id;
        seen.add(dedupedId);
        items.push({
          ...item,
          id: dedupedId,
          name,
          kind: meta.kind,
          status: item.status || "draft",
          version: item.version.trim(),
          tags: (item.tags || []).filter(Boolean),
          origin: item.origin || "project-distilled",
          derived_from_ids: (item.derived_from_ids || [])
            .map((value) => value.trim())
            .filter(Boolean),
          distillation_note: item.distillation_note.trim(),
          market_source_id: item.market_source_id || null,
          market_item_id: item.market_item_id || null,
        });
      });
    normalized[meta.key] = items;
  }

  return normalized;
}

interface ProjectArtifactProfileEditorProps {
  value?: ProjectArtifactProfile;
  saving: boolean;
  promotingSkillId?: string;
  onSave: (profile: ProjectArtifactProfile) => Promise<void>;
  onPromoteSkill: (item: ProjectArtifactItem) => Promise<void>;
}

export default function ProjectArtifactProfileEditor({
  value,
  saving,
  promotingSkillId,
  onSave,
  onPromoteSkill,
}: ProjectArtifactProfileEditorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ProjectArtifactProfile>(() =>
    cloneArtifactProfile(value),
  );

  useEffect(() => {
    if (!open) {
      setDraft(cloneArtifactProfile(value));
    }
  }, [open, value]);

  const hasArtifacts = useMemo(
    () => ARTIFACT_KIND_META.some((meta) => (value?.[meta.key] || []).length > 0),
    [value],
  );

  const updateItem = (
    kind: ArtifactKindKey,
    index: number,
    patch: Partial<ProjectArtifactItem>,
  ) => {
    setDraft((prev) => ({
      ...prev,
      [kind]: prev[kind].map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }));
  };

  const addItem = (kind: ArtifactKindKey, itemKind: ProjectArtifactItem["kind"]) => {
    setDraft((prev) => ({
      ...prev,
      [kind]: [...prev[kind], createEmptyArtifactItem(itemKind, prev[kind].length)],
    }));
  };

  const removeItem = (kind: ArtifactKindKey, index: number) => {
    setDraft((prev) => ({
      ...prev,
      [kind]: prev[kind].filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const handleSave = async () => {
    await onSave(normalizeArtifactProfile(draft));
    setOpen(false);
  };

  return (
    <>
      <div className={styles.artifactSummaryBlock}>
        {hasArtifacts ? (
          <div className={styles.artifactSummaryGroups}>
            {ARTIFACT_KIND_META.map((meta) => {
              const items = value?.[meta.key] || [];
              if (items.length === 0) {
                return null;
              }
              return (
                <div key={meta.key} className={styles.artifactSummaryGroup}>
                  <div className={styles.artifactSummaryTitle}>
                    {t(meta.labelKey, meta.defaultLabel)}
                  </div>
                  <div className={styles.overviewTags}>
                    {items.map((item) => (
                      <Tag key={`${meta.key}-${item.id}`} color={meta.color}>
                        {item.name}
                      </Tag>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t(
              "projects.artifacts.empty",
              "No product artifacts yet",
            )}
          />
        )}

        <Button size="small" onClick={() => setOpen(true)}>
          {t("projects.artifacts.manage", "Manage Artifacts")}
        </Button>
      </div>

      <Modal
        title={t("projects.artifacts.manage", "Manage Artifacts")}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void handleSave()}
        confirmLoading={saving}
        okText={t("common.save", "Save")}
        cancelText={t("common.cancel", "Cancel")}
        width={860}
      >
        <div className={styles.artifactEditorModalBody}>
          {ARTIFACT_KIND_META.map((meta) => (
            <div key={meta.key} className={styles.artifactEditorSection}>
              <div className={styles.artifactEditorSectionHeader}>
                <div className={styles.subSectionTitle}>
                  {t(meta.labelKey, meta.defaultLabel)}
                </div>
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => addItem(meta.key, meta.kind)}
                >
                  {t("projects.artifacts.add", "Add")}
                </Button>
              </div>

              {(draft[meta.key] || []).length === 0 ? (
                <div className={styles.artifactEditorEmpty}>
                  {t("projects.artifacts.emptyCategory", "No entries")}
                </div>
              ) : (
                <div className={styles.artifactEditorList}>
                  {draft[meta.key].map((item, index) => (
                    <div
                      key={`${meta.key}-${item.id}-${index}`}
                      className={styles.artifactEditorRow}
                    >
                      <div className={styles.artifactEditorPrimaryGrid}>
                        <Input
                          value={item.name}
                          placeholder={t(
                            "projects.artifacts.fields.name",
                            "Name",
                          )}
                          onChange={(event) =>
                            updateItem(meta.key, index, {
                              name: event.target.value,
                              id: slugifyArtifactId(
                                event.target.value,
                                `${meta.kind}-${index + 1}`,
                              ),
                            })
                          }
                        />
                        <Input
                          value={item.version}
                          placeholder={t(
                            "projects.artifacts.fields.version",
                            "Version",
                          )}
                          onChange={(event) =>
                            updateItem(meta.key, index, {
                              version: event.target.value,
                            })
                          }
                        />
                        <Select
                          value={item.status}
                          options={STATUS_OPTIONS.map((status) => ({
                            value: status,
                            label: status,
                          }))}
                          onChange={(status) =>
                            updateItem(meta.key, index, { status })
                          }
                        />
                        <Button
                          danger
                          type="text"
                          icon={<DeleteOutlined />}
                          onClick={() => removeItem(meta.key, index)}
                        />
                      </div>

                      <div className={styles.artifactEditorMetadataGrid}>
                        <Select
                          value={item.origin}
                          options={ORIGIN_OPTIONS.map((origin) => ({
                            value: origin,
                            label: t(
                              `projects.artifacts.origins.${origin}`,
                              origin,
                            ),
                          }))}
                          onChange={(origin) =>
                            updateItem(meta.key, index, { origin })
                          }
                        />
                        <Input
                          value={item.derived_from_ids.join(", ")}
                          placeholder={t(
                            "projects.artifacts.fields.derivedFromIds",
                            "Derived from IDs",
                          )}
                          onChange={(event) =>
                            updateItem(meta.key, index, {
                              derived_from_ids: event.target.value
                                .split(",")
                                .map((value) => value.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                      </div>

                      <Input.TextArea
                        value={item.distillation_note}
                        rows={2}
                        placeholder={t(
                          "projects.artifacts.fields.distillationNote",
                          "Distillation note",
                        )}
                        onChange={(event) =>
                          updateItem(meta.key, index, {
                            distillation_note: event.target.value,
                          })
                        }
                      />

                      {meta.kind === "skill" ? (
                        <div className={styles.artifactEditorActions}>
                          <Button
                            size="small"
                            loading={promotingSkillId === item.id}
                            disabled={
                              !item.id ||
                              saving ||
                              (item.status || "").toLowerCase() !== "stable"
                            }
                            onClick={() => void onPromoteSkill(item)}
                          >
                            {t("projects.artifacts.promote", "Promote to Agent")}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}