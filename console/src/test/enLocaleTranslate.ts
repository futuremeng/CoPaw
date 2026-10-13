import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  copawOverlayGroupFiles,
  mergeCopawOverlay,
} from "../locales/copaw/register";
import baseEn from "../locales/en.json";

type TranslationMap = Record<string, unknown>;

type TranslateFn = (
  key: string,
  maybeFallbackOrOptions?: string | Record<string, unknown>,
  maybeOptions?: Record<string, unknown>,
) => string;

// This double reads the overlay group files off disk, so it stays out of
// `src/pages/**`, where utils/lazyWithRetry.ts's `import.meta.glob` would ship it
// into the browser build.
//
// Production hands i18next the base en.json with the copaw overlay merged over
// it, and register.ts owns both the group order and that merge.  There the
// overlay arrives through a per-language dynamic import, so the double reads the
// same group files from disk rather than awaiting the loader.
const enBundle = mergeCopawOverlay(
  baseEn as TranslationMap,
  copawOverlayGroupFiles("en").map(
    (file) =>
      JSON.parse(
        readFileSync(resolve(process.cwd(), "src/locales/copaw", file), "utf8"),
      ) as TranslationMap,
  ),
);

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
