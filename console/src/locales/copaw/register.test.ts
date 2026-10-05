import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import i18n from "../../i18n";

const LANGS = ["en", "ru", "zh", "ja", "pt-BR", "id"] as const;

type TranslationMap = Record<string, unknown>;

const readJson = (rel: string): TranslationMap =>
  JSON.parse(
    readFileSync(resolve(process.cwd(), rel), "utf8"),
  ) as TranslationMap;

const isPlainObject = (value: unknown): value is TranslationMap =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function merge(target: TranslationMap, source: TranslationMap): TranslationMap {
  const next: TranslationMap = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const existing = next[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      next[key] = merge(existing, value);
      continue;
    }
    next[key] = value;
  }
  return next;
}

const overlayDirs = readdirSync(resolve(process.cwd(), "src/locales/copaw"), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const expectedBundle = (lng: string): TranslationMap => {
  // A group may ship only some languages (the copaw overlay is an en/zh
  // deliverable; the rest fall back through i18n.ts `fallbackLng`), so the
  // expected bundle skips the same missing files the split gate skips.
  const overlayOrder = [
    "projects",
    "pipelines",
    "rpa",
    "workbench",
    "knowledge",
  ].filter((dir) => overlayDirs.includes(dir));
  return [
    readJson(`src/locales/${lng}.json`),
    ...overlayOrder
      .map((dir) => `src/locales/copaw/${dir}/${lng}.json`)
      .filter((rel) => existsSync(resolve(process.cwd(), rel)))
      .map((rel) => readJson(rel)),
  ].reduce(merge, {});
};

// Copaw's own copy must never live inside an upstream-owned locale file: it is
// the single biggest per-sync conflict surface in the console.
describe("upstream locale files stay free of copaw-owned keys", () => {
  it.each(LANGS)("%s has no copaw-owned keys", (lng) => {
    const bundle = readJson(`src/locales/${lng}.json`);
    expect(bundle).not.toHaveProperty("nlpConfig");
    expect(bundle.nav ?? {}).not.toHaveProperty("projects");
    expect(bundle.nav ?? {}).not.toHaveProperty("pipelines");
    expect(bundle.nav ?? {}).not.toHaveProperty("knowledge");
    expect(bundle.nav ?? {}).not.toHaveProperty("nlp");
    expect(bundle.projects ?? {}).not.toHaveProperty("workspacePath");
    expect(bundle.agentConfig ?? {}).not.toHaveProperty("knowledgeEnabled");
  });
});

describe("copaw overlay registers into the upstream translation namespace", () => {
  it.each(LANGS)("%s registers exactly the pre-move merged bundle", (lng) => {
    expect(i18n.getResourceBundle(lng, "translation")).toEqual(
      expectedBundle(lng),
    );
  });

  it.each(LANGS)("%s resolves moved keys at their old paths", (lng) => {
    expect(i18n.t("nav.projects", { lng })).not.toBe("nav.projects");
    expect(i18n.t("nlpConfig.title", { lng })).not.toBe("nlpConfig.title");
    expect(i18n.t("projects.workspacePath", { lng })).not.toBe(
      "projects.workspacePath",
    );
    expect(i18n.t("agentConfig.knowledgeEnabled", { lng })).not.toBe(
      "agentConfig.knowledgeEnabled",
    );
  });

  it("keeps upstream-owned keys resolvable next to the overlay", () => {
    expect(i18n.t("nav.plugins", { lng: "en" })).not.toBe("nav.plugins");
    expect(
      i18n.t("copaw.projects.knowledge.runtimeStatusIdle", { lng: "en" }),
    ).not.toBe("copaw.projects.knowledge.runtimeStatusIdle");
  });
});
