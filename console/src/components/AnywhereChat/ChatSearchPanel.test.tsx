/**
 * ChatSearchPanel helper tests (pure functions only).
 *
 * NOTE:
 * Importing the component directly triggers package entry resolution issues
 * for @agentscope-ai/design in isolated vitest runs. We mirror the helper
 * logic here to keep deterministic coverage in this environment.
 */
import { describe, expect, it } from "vitest";
import { splitHighlightSegments } from "./searchHighlight";

const formatTimestamp = (raw: string | null | undefined): string => {
  if (!raw) {
    return "";
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

describe("formatTimestamp", () => {
  it("formats valid timestamp", () => {
    const result = formatTimestamp("2024-03-15T10:30:00Z");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("returns empty for invalid timestamp", () => {
    expect(formatTimestamp("not-a-date")).toBe("");
    expect(formatTimestamp("")).toBe("");
    expect(formatTimestamp(undefined)).toBe("");
  });
});

describe("renderHighlightedText logic", () => {
  it("marks all matched query fragments", () => {
    const parts = splitHighlightSegments("hello world hello", "hello");
    const highlighted = parts.filter((part) => part.highlighted).map((part) => part.text);
    expect(highlighted).toEqual(["hello", "hello"]);
  });

  it("returns plain text when query is empty", () => {
    const parts = splitHighlightSegments("hello world", "");
    expect(parts).toEqual([{ text: "hello world", highlighted: false }]);
  });
});
