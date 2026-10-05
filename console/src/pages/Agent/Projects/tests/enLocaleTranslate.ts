import { registerCopawTranslations } from "../../../../locales/copaw/register";
import baseEn from "../../../../locales/en.json";

type TranslationMap = Record<string, unknown>;

type TranslateFn = (
  key: string,
  maybeFallbackOrOptions?: string | Record<string, unknown>,
  maybeOptions?: Record<string, unknown>,
) => string;

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

// Production builds the English tree from base en.json plus the copaw overlays,
// and register.ts is the only owner of the overlay order, so the double collects
// the overlay through it instead of re-listing the groups.
type ResourceCollector = {
  addResourceBundle: (
    ...args: Parameters<
      Parameters<typeof registerCopawTranslations>[0]["addResourceBundle"]
    >
  ) => void;
};

let overlayEn: TranslationMap = {};
const collector: ResourceCollector = {
  addResourceBundle: (lng, _ns, resources) => {
    if (lng === "en") {
      overlayEn = mergeTranslations(overlayEn, resources as TranslationMap);
    }
  },
};

registerCopawTranslations(
  collector as unknown as Parameters<typeof registerCopawTranslations>[0],
);

const enBundle = mergeTranslations(baseEn as TranslationMap, overlayEn);

function lookupEnValue(key: string): string | undefined {
  let cursor: unknown = enBundle;
  for (const segment of key.split(".")) {
    if (!cursor || typeof cursor !== "object" || !(segment in cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

function interpolate(
  template: string,
  options: Record<string, unknown> | undefined,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    String(options?.[name] ?? ""),
  );
}

// Mirrors the runtime the tests are meant to reproduce: default language is "en",
// the bundle value wins over an inline default, and a missing key yields the raw
// key so a locale gap fails loudly instead of silently.
export const t: TranslateFn = (key, maybeFallbackOrOptions, maybeOptions) => {
  const inlineFallback =
    typeof maybeFallbackOrOptions === "string"
      ? maybeFallbackOrOptions
      : undefined;
  const options = (
    typeof maybeFallbackOrOptions === "object"
      ? maybeFallbackOrOptions
      : maybeOptions
  ) as Record<string, unknown> | undefined;
  return interpolate(lookupEnValue(key) ?? inlineFallback ?? key, options);
};
