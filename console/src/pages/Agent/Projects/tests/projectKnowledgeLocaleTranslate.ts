import zhProjectLocale from "../../../../locales/copaw/projects/zh.json";

type TranslateFn = (
  key: string,
  maybeFallbackOrOptions?: string | Record<string, unknown>,
  maybeOptions?: Record<string, unknown>,
) => string;

function lookupLocaleValue(key: string): string | undefined {
  let cursor: unknown = zhProjectLocale;
  for (const segment of key.split(".")) {
    if (!cursor || typeof cursor !== "object" || !(segment in cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

function interpolate(template: string, options: Record<string, unknown> | undefined): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ""));
}

// Mirrors i18next resolution: bundle value wins, inline fallback is the default,
// and a missing key yields the raw key so a locale gap fails loudly instead of silently.
export const t: TranslateFn = (key, maybeFallbackOrOptions, maybeOptions) => {
  const inlineFallback = typeof maybeFallbackOrOptions === "string" ? maybeFallbackOrOptions : undefined;
  const options = (typeof maybeFallbackOrOptions === "object"
    ? maybeFallbackOrOptions
    : maybeOptions) as Record<string, unknown> | undefined;
  return interpolate(lookupLocaleValue(key) ?? inlineFallback ?? key, options);
};
