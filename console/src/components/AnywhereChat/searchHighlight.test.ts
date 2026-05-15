import { describe, expect, it } from "vitest";
import { splitHighlightSegments } from "./searchHighlight";

describe("splitHighlightSegments", () => {
  it("returns plain segment when query is empty", () => {
    expect(splitHighlightSegments("hello", "")).toEqual([
      { text: "hello", highlighted: false },
    ]);
  });

  it("returns highlighted segments for repeated matches", () => {
    expect(splitHighlightSegments("hello world hello", "hello")).toEqual([
      { text: "hello", highlighted: true },
      { text: " world ", highlighted: false },
      { text: "hello", highlighted: true },
    ]);
  });

  it("matches case-insensitively while preserving original text", () => {
    expect(splitHighlightSegments("Hello WORLD", "world")).toEqual([
      { text: "Hello ", highlighted: false },
      { text: "WORLD", highlighted: true },
    ]);
  });

  it("returns full text plain when no match", () => {
    expect(splitHighlightSegments("abc", "xyz")).toEqual([
      { text: "abc", highlighted: false },
    ]);
  });
});
