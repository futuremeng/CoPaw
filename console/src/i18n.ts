import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ru from "./locales/ru.json";
import zh from "./locales/zh.json";
import ja from "./locales/ja.json";
import ptBR from "./locales/pt-BR.json";
import id from "./locales/id.json";
import copawProjectsEn from "./locales/copaw/projects/en.json";
import copawProjectsRu from "./locales/copaw/projects/ru.json";
import copawProjectsZh from "./locales/copaw/projects/zh.json";
import copawProjectsJa from "./locales/copaw/projects/ja.json";
import copawProjectsPtBR from "./locales/copaw/projects/pt-BR.json";
import copawProjectsId from "./locales/copaw/projects/id.json";
import copawPipelinesEn from "./locales/copaw/pipelines/en.json";
import copawPipelinesRu from "./locales/copaw/pipelines/ru.json";
import copawPipelinesZh from "./locales/copaw/pipelines/zh.json";
import copawPipelinesJa from "./locales/copaw/pipelines/ja.json";
import copawPipelinesPtBR from "./locales/copaw/pipelines/pt-BR.json";
import copawPipelinesId from "./locales/copaw/pipelines/id.json";
import copawRpaEn from "./locales/copaw/rpa/en.json";
import copawRpaRu from "./locales/copaw/rpa/ru.json";
import copawRpaZh from "./locales/copaw/rpa/zh.json";
import copawRpaJa from "./locales/copaw/rpa/ja.json";
import copawRpaPtBR from "./locales/copaw/rpa/pt-BR.json";
import copawRpaId from "./locales/copaw/rpa/id.json";

type TranslationMap = Record<string, unknown>;

function isPlainObject(value: unknown): value is TranslationMap {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeTranslations(target: TranslationMap, source: TranslationMap): TranslationMap {
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

function buildLanguageResource(...parts: TranslationMap[]): TranslationMap {
  return parts.reduce<TranslationMap>((acc, part) => mergeTranslations(acc, part), {});
}

const resources = {
  en: {
    translation: buildLanguageResource(
      en,
      copawProjectsEn,
      copawPipelinesEn,
      copawRpaEn,
    ),
  },
  ru: {
    translation: buildLanguageResource(
      ru,
      copawProjectsRu,
      copawPipelinesRu,
      copawRpaRu,
    ),
  },
  zh: {
    translation: buildLanguageResource(
      zh,
      copawProjectsZh,
      copawPipelinesZh,
      copawRpaZh,
    ),
  },
  ja: {
    translation: buildLanguageResource(
      ja,
      copawProjectsJa,
      copawPipelinesJa,
      copawRpaJa,
    ),
  },
  "pt-BR": {
    translation: buildLanguageResource(
      ptBR,
      copawProjectsPtBR,
      copawPipelinesPtBR,
      copawRpaPtBR,
    ),
  },
  id: {
    translation: buildLanguageResource(
      id,
      copawProjectsId,
      copawPipelinesId,
      copawRpaId,
    ),
  },
};

function resolveInitialLanguage(): string {
  if (typeof window === "undefined") {
    return "en";
  }

  try {
    return window.localStorage.getItem("language") || "en";
  } catch {
    return "en";
  }
}

i18n.use(initReactI18next).init({
  resources,
  lng: resolveInitialLanguage(),
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
