import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("ProjectDetailPage architecture guard", () => {
  it("does not call agentsApi directly in page layer", () => {
    const targetFile = path.resolve(
      __dirname,
      "..",
      "ProjectDetailPage.tsx",
    );
    const source = fs.readFileSync(targetFile, "utf8");

    expect(source).not.toContain("agentsApi.");
  });

  it("uses hooks barrel exports for facade imports", () => {
    const targetFile = path.resolve(
      __dirname,
      "..",
      "ProjectDetailPage.tsx",
    );
    const source = fs.readFileSync(targetFile, "utf8");

    expect(source).toContain('from "./hooks"');
    expect(source).not.toContain('from "./hooks/useProjectWorkspaceFacade"');
    expect(source).not.toContain('from "./hooks/useProjectPipelineFacade"');
    expect(source).not.toContain('from "./hooks/useProjectAgentFacade"');
  });

  it("does not import low-level workspace or agents API modules directly", () => {
    const targetFile = path.resolve(
      __dirname,
      "..",
      "ProjectDetailPage.tsx",
    );
    const source = fs.readFileSync(targetFile, "utf8");

    expect(source).not.toContain('from "../../../api/modules/agents"');
    expect(source).not.toContain('from "../../../api/modules/workspace"');
  });
});
