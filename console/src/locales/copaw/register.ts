import type { BackendModule } from "i18next";

type TranslationMap = Record<string, unknown>;
type OverlayModule = { default: TranslationMap };

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

// Later groups win, matching the order the copaw overlays were merged in before.
export function mergeCopawOverlay(
  base: TranslationMap,
  parts: readonly TranslationMap[],
): TranslationMap {
  return parts.reduce(mergeTranslations, base);
}

// Which groups make up the overlay, in the order they win over each other.  The
// conflict-surface knives own this list: knife 76 dropped the verbatim-English
// ja/ru/pt-BR/id carriers from pipelines and rpa, knife 79 kept ja and ru in the
// knowledge group for the one real translation they carry
// (`knowledge.quantReason`), and the knife-72 groups are en/zh deliverables that
// the other four languages reach through i18n.ts `fallbackLng`.  A group with no
// file for a language is skipped rather than padded with English, so this single
// order describes every language.
export const copawOverlayGroups = [
  "projects",
  "pipelines",
  "rpa",
  "workbench",
  "knowledge",
  "agent",
  "agentConfig",
  "approval",
  "chat",
  "common",
  "mcp",
  "models",
  "skills",
] as const;

const copawOverlayModules = import.meta.glob<OverlayModule>("./*/*.json");

// The overlay is fetched per language, in the group files it actually ships:
// statically imported JSON is concatenated into the entry chunk, so every
// visitor would download all six languages to read one.
export function copawOverlayGroupFiles(language: string): string[] {
  return copawOverlayGroups
    .map((group) => `${group}/${language}.json`)
    .filter((file) => `./${file}` in copawOverlayModules);
}

async function loadCopawOverlayParts(
  language: string,
): Promise<TranslationMap[]> {
  const modules = await Promise.all(
    copawOverlayGroups.map(
      (group) => copawOverlayModules[`./${group}/${language}.json`]?.(),
    ),
  );
  return modules
    .filter(isModuleWithTranslation)
    .map((module) => module.default);
}

function isModuleWithTranslation(
  value: OverlayModule | undefined,
): value is OverlayModule {
  return value !== undefined && isPlainObject(value.default);
}

// The console's locale backend merges the overlay into the bundle it hands
// i18next, so the store never holds a language without its fork copy.  Merging
// later -- on i18next's `loaded` event -- lands after the `languageChanged`
// event react-i18next listens to (its `bindI18n` default), so a language switch
// would render one frame of fallback-language copy and then sit there.
//
// i18next fetches a language only while the store has no bundle for it
// (`BackendConnector.queueLoad` checks `store.hasResourceBundle`), so the merge
// stays per language: adding every overlay up front would mark all six
// `translation` bundles as loaded and the base dictionaries would never load.
export function copawOverlayBackend(backend: BackendModule): BackendModule {
  return {
    ...backend,
    read: (language, namespace, callback) => {
      backend.read(language, namespace, (readError, resources) => {
        if (!isPlainObject(resources)) {
          callback(readError, resources);
          return;
        }
        // i18next has to be answered either way: a rejected overlay chunk left
        // the load hanging, and an unresolved `changeLanguage` never settles.
        void loadCopawOverlayParts(language)
          .then((parts) =>
            callback(readError, mergeCopawOverlay(resources, parts)),
          )
          .catch((error: unknown) => {
            console.error(
              `Failed to load the copaw overlay for "${language}":`,
              error,
            );
            callback(readError, resources);
          });
      });
    },
  };
}
