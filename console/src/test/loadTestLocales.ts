import i18n, { i18nReady } from "../i18n";

// Every language the console ships, in the order `localeLoaders` declares them.
export const TEST_LOCALES = ["en", "ru", "zh", "ja", "pt-BR", "id"] as const;

// `i18n.ts` fetches a language's base dictionary on demand through its backend,
// and the backend merges the copaw overlay into that bundle before handing it to
// i18next.  A guard that reads `i18n.t(key, { lng })` therefore has to drive the
// load itself — asserting against the store as left by module import only ever
// sees the fallback language.
export async function loadTestLocales(
  languages: readonly string[] = TEST_LOCALES,
): Promise<void> {
  await i18nReady;
  await new Promise<void>((resolve, reject) => {
    i18n.loadLanguages([...languages], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
