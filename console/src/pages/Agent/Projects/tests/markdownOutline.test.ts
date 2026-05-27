import { describe, expect, it } from "vitest";
import {
  isMarkdownDocumentPath,
  normalizeHeadingForMatch,
  parseMarkdownOutline,
} from "../utils/markdownOutline";

describe("parseMarkdownOutline", () => {
  it("extracts headings and tracks nesting levels", () => {
    const markdown = [
      "# Title",
      "text",
      "## Section A",
      "### Item",
      "## Section A",
    ].join("\n");

    const outline = parseMarkdownOutline(markdown);
    expect(outline.map((item) => item.text)).toEqual([
      "Title",
      "Section A",
      "Item",
      "Section A",
    ]);
    expect(outline.map((item) => item.level)).toEqual([1, 2, 3, 2]);
    expect(outline[1].id).toBe("section-a");
    expect(outline[3].id).toBe("section-a-2");
  });

  it("ignores headings inside fenced code blocks", () => {
    const markdown = [
      "# Real",
      "```md",
      "## Fake",
      "```",
      "## Also Real",
    ].join("\n");

    const outline = parseMarkdownOutline(markdown);
    expect(outline.map((item) => item.text)).toEqual(["Real", "Also Real"]);
  });
});

describe("markdown outline helpers", () => {
  it("detects markdown file paths", () => {
    expect(isMarkdownDocumentPath("docs/readme.md")).toBe(true);
    expect(isMarkdownDocumentPath("docs/a.MDX")).toBe(true);
    expect(isMarkdownDocumentPath("docs/a.txt")).toBe(false);
  });

  it("normalizes heading text for matching", () => {
    expect(normalizeHeadingForMatch("  A   B  ")).toBe("a b");
  });
});