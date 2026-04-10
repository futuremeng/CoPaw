import { describe, expect, it } from "vitest";
import {
  appendUniqueContextLine,
  buildPathContextLine,
  PATH_CONTEXT_PREFIX,
} from "./pathContext";

describe("pathContext helpers", () => {
  it("builds path context line with shared prefix", () => {
    expect(buildPathContextLine("a -> b")).toBe(`${PATH_CONTEXT_PREFIX} a -> b`);
  });

  it("appends context line to empty query", () => {
    expect(appendUniqueContextLine("", "Path context: a -> b")).toBe(
      "Path context: a -> b",
    );
  });

  it("does not append duplicated context line", () => {
    const initial = "Find related entities\nPath context: a -> b";
    const updated = appendUniqueContextLine(initial, "Path context: a -> b");
    expect(updated).toBe(initial);
  });
});