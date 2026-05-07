import fs from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ProjectMdxReadonlyPreview from "./ProjectMdxReadonlyPreview";

const problematicFilePath = "/Users/futuremeng/.copaw/workspaces/default/projects/project-2ZHU4d/aacid__duxiu_files__20240613T213851Z__kTftdqCUQCBG3XMeXyoaPz_260317_002144.md";

describe("ProjectMdxReadonlyPreview problematic markdown", () => {
  it("renders the selected project markdown file", async () => {
    const markdown = fs.readFileSync(problematicFilePath, "utf8");

    render(
      <ProjectMdxReadonlyPreview
        filePath={problematicFilePath}
        markdown={markdown}
      />,
    );

    const editor = await screen.findByRole("textbox", { name: "editable markdown" });
    expect(editor.textContent?.length || 0).toBeGreaterThan(1000);
    expect(editor.textContent).toContain("钒钛概论");
    expect(editor.textContent).toContain("矿区");
  });
});
