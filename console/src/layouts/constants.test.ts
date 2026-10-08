import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RELEASE_CHANNEL,
  githubUrl,
  releasesUrl,
} from "../generated/releaseChannel";
import { GITHUB_URL, UPDATE_MD } from "./constants";

// vitest's jsdom pool gives a non-file import.meta.url, so the fact source is
// located from the console working directory the way register.test.ts does.
const factSource = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../src/copaw/release_channel.json"),
    "utf-8",
  ),
);

describe("CoPaw release channel wiring", () => {
  it("mirrors the fact source field for field", () => {
    expect(RELEASE_CHANNEL).toEqual(factSource);
  });

  it("derives both repository URLs from the repository field", () => {
    expect(githubUrl).toBe(
      `https://github.com/${factSource.github_repository}`,
    );
    expect(releasesUrl).toBe(`${githubUrl}/releases`);
    expect(GITHUB_URL).toBe(githubUrl);
  });

  it("names only CoPaw's own releases page in every shipped guide", () => {
    const languages = Object.keys(UPDATE_MD);
    expect(languages.length).toBeGreaterThan(0);
    for (const language of languages) {
      expect(UPDATE_MD[language]).toContain(releasesUrl);
      expect(UPDATE_MD[language]).not.toContain("agentscope-ai/QwenPaw");
    }
  });

  it("never promises a PyPI channel the fact source marks pending", () => {
    for (const language of Object.keys(UPDATE_MD)) {
      expect(UPDATE_MD[language]).not.toMatch(/pip install copaw/);
      expect(UPDATE_MD[language]).not.toMatch(/uv pip install copaw/);
    }
  });
});
