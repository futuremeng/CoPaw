import type i18n from "i18next";
import copawProjectsEn from "./projects/en.json";
import copawProjectsRu from "./projects/ru.json";
import copawProjectsZh from "./projects/zh.json";
import copawProjectsJa from "./projects/ja.json";
import copawProjectsPtBR from "./projects/pt-BR.json";
import copawProjectsId from "./projects/id.json";
import copawPipelinesEn from "./pipelines/en.json";
import copawPipelinesRu from "./pipelines/ru.json";
import copawPipelinesZh from "./pipelines/zh.json";
import copawPipelinesJa from "./pipelines/ja.json";
import copawPipelinesPtBR from "./pipelines/pt-BR.json";
import copawPipelinesId from "./pipelines/id.json";
import copawRpaEn from "./rpa/en.json";
import copawRpaRu from "./rpa/ru.json";
import copawRpaZh from "./rpa/zh.json";
import copawRpaJa from "./rpa/ja.json";
import copawRpaPtBR from "./rpa/pt-BR.json";
import copawRpaId from "./rpa/id.json";
import workbenchEn from "./workbench/en.json";
import workbenchRu from "./workbench/ru.json";
import workbenchZh from "./workbench/zh.json";
import workbenchJa from "./workbench/ja.json";
import workbenchPtBR from "./workbench/pt-BR.json";
import workbenchId from "./workbench/id.json";
import copawKnowledgeEn from "./knowledge/en.json";
import copawKnowledgeZh from "./knowledge/zh.json";
// Conflict-surface knife 72: copy the fork's own console pages read, restored
// from the fork's dropped dictionaries (or supplied from an upstream v2 / inline
// donor).  Same en/zh-only deliverable as the knowledge group above.
import agentEn from "./agent/en.json";
import agentZh from "./agent/zh.json";
import agentConfigEn from "./agentConfig/en.json";
import agentConfigZh from "./agentConfig/zh.json";
import approvalEn from "./approval/en.json";
import approvalZh from "./approval/zh.json";
import chatEn from "./chat/en.json";
import chatZh from "./chat/zh.json";
import commonEn from "./common/en.json";
import commonZh from "./common/zh.json";
import mcpEn from "./mcp/en.json";
import mcpZh from "./mcp/zh.json";
import modelsEn from "./models/en.json";
import modelsZh from "./models/zh.json";
import skillsEn from "./skills/en.json";
import skillsZh from "./skills/zh.json";

type TranslationMap = Record<string, unknown>;

function isPlainObject(value: unknown): value is TranslationMap {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeTranslations(
  target: TranslationMap,
  source: TranslationMap,
): TranslationMap {
  const next: TranslationMap = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const existing = next[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      next[key] = mergeTranslations(existing, value);
      continue;
    }
    next[key] = value;
  }
  return next;
}

// Later files win, matching the order copaw overlays were merged in before.
function buildOverlay(...parts: TranslationMap[]): TranslationMap {
  return parts.reduce<TranslationMap>(
    (acc, part) => mergeTranslations(acc, part),
    {},
  );
}

const copawOverlays: Record<string, TranslationMap> = {
  // The knowledge and knife-72 groups are en/zh deliverables: the other four
  // languages reach them through i18n.ts `fallbackLng`, same as the
  // projects/pipelines/rpa dictionaries did before conflict-surface knife 71
  // re-supplied the knowledge copy.
  en: buildOverlay(
    copawProjectsEn,
    copawPipelinesEn,
    copawRpaEn,
    workbenchEn,
    copawKnowledgeEn,
    agentEn,
    agentConfigEn,
    approvalEn,
    chatEn,
    commonEn,
    mcpEn,
    modelsEn,
    skillsEn,
  ),
  ru: buildOverlay(copawProjectsRu, copawPipelinesRu, copawRpaRu, workbenchRu),
  zh: buildOverlay(
    copawProjectsZh,
    copawPipelinesZh,
    copawRpaZh,
    workbenchZh,
    copawKnowledgeZh,
    agentZh,
    agentConfigZh,
    approvalZh,
    chatZh,
    commonZh,
    mcpZh,
    modelsZh,
    skillsZh,
  ),
  ja: buildOverlay(copawProjectsJa, copawPipelinesJa, copawRpaJa, workbenchJa),
  "pt-BR": buildOverlay(
    copawProjectsPtBR,
    copawPipelinesPtBR,
    copawRpaPtBR,
    workbenchPtBR,
  ),
  id: buildOverlay(copawProjectsId, copawPipelinesId, copawRpaId, workbenchId),
};

export function registerCopawTranslations(
  instance: Pick<typeof i18n, "addResourceBundle">,
): void {
  for (const [lng, translation] of Object.entries(copawOverlays)) {
    instance.addResourceBundle(lng, "translation", translation, true, true);
  }
}
