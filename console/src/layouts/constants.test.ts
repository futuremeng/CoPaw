import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RELEASE_CHANNEL,
  githubUrl,
  releasesUrl,
} from "../generated/releaseChannel";
import {
  PYPI_URL,
  GITHUB_URL,
  ONE_HOUR_MS,
  getWebsiteLang,
  getDocsUrl,
  getFaqUrl,
  getReleaseNotesUrl,
  isStableVersion,
  compareVersions,
  UPDATE_MD,
} from "./constants";

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

  it("queries the release feed under our own project name, never upstream's", () => {
    expect(PYPI_URL).toBe(
      `https://pypi.org/pypi/${factSource.pypi_project}/json`,
    );
    expect(PYPI_URL).not.toContain("pypi/qwenpaw/");
  });
});

/**
 * Tests for layouts/constants.
 *
 * Covers:
 * - URL constants
 * - ONE_HOUR_MS value
 * - getWebsiteLang()
 * - getDocsUrl(), getFaqUrl(), getReleaseNotesUrl()
 * - isStableVersion()
 * - compareVersions()
 * - UPDATE_MD structure
 */

describe("URL constants", () => {
  it("GITHUB_URL points at the CoPaw repository", () => {
    expect(GITHUB_URL).toContain("github.com");
    expect(GITHUB_URL).toContain(factSource.github_repository);
  });
});

describe("ONE_HOUR_MS", () => {
  it("equals 3600000 ms", () => {
    expect(ONE_HOUR_MS).toBe(60 * 60 * 1000);
  });
});

describe("getWebsiteLang", () => {
  it.each([
    ["zh", "zh"],
    ["zh-CN", "zh"],
    ["zh-TW", "zh"],
    ["en", "en"],
    ["en-US", "en"],
    ["ja", "en"],
    ["ru", "en"],
  ])("returns %s for input %s", (input, expected) => {
    expect(getWebsiteLang(input)).toBe(expected);
  });
});

describe("getDocsUrl", () => {
  it("includes lang param", () => {
    const url = getDocsUrl("zh");
    expect(url).toContain("lang=zh");
    expect(url).toContain("/docs/intro");
  });
});

describe("getFaqUrl", () => {
  it("includes lang param", () => {
    const url = getFaqUrl("en");
    expect(url).toContain("lang=en");
    expect(url).toContain("/docs/faq");
  });
});

describe("getReleaseNotesUrl", () => {
  it("includes lang param", () => {
    const url = getReleaseNotesUrl("zh");
    expect(url).toContain("lang=zh");
    expect(url).toContain("/release-notes");
  });
});

describe("isStableVersion", () => {
  it.each([
    ["1.0.0", true],
    ["2.3.4", true],
    ["1.0.0.post1", true],
    ["1.0.0a1", false],
    ["1.0.0beta2", false],
    ["2.0rc1", false],
    ["3.0.0dev1", false],
    ["1.0.0c3", false],
  ])("isStableVersion(%s) → %s", (version, expected) => {
    expect(isStableVersion(version)).toBe(expected);
  });
});

describe("compareVersions", () => {
  it.each([
    ["1.0.0", "2.0.0", -1],
    ["2.0.0", "1.0.0", 1],
    ["1.0.0", "1.0.0", 0],
    ["1.0.0", "1.0.1", -1],
    ["1.0.1", "1.0.0", 1],
    ["1.0.0a1", "1.0.0", -1],
    ["1.0.0", "1.0.0a1", 1],
    ["1.0.0b1", "1.0.0", -1],
    ["1.0.0rc1", "1.0.0", -1],
    ["1.0.0a1", "1.0.0b1", -1],
    ["1.0.0b1", "1.0.0rc1", -1],
    ["1.0.0", "1.0.0.post1", -1],
    ["1.0.0.post1", "1.0.0.post2", -1],
  ] as [string, string, number][])(
    "compareVersions(%s, %s) → %s",
    (a, b, expected) => {
      const result = compareVersions(a, b);
      expect(Math.sign(result)).toBe(expected);
    },
  );
});

describe("UPDATE_MD", () => {
  it("has entries for zh, ru and en", () => {
    expect(UPDATE_MD).toHaveProperty("zh");
    expect(UPDATE_MD).toHaveProperty("ru");
    expect(UPDATE_MD).toHaveProperty("en");
  });

  it("each entry is a non-empty string", () => {
    for (const [, md] of Object.entries(UPDATE_MD)) {
      expect(typeof md).toBe("string");
      expect(md.length).toBeGreaterThan(0);
    }
  });
});
