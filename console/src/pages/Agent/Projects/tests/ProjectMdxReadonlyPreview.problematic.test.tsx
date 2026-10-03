import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ProjectMdxReadonlyPreview from "../components/ProjectMdxReadonlyPreview";

const HEADING = "# 钒钛概论\n\n";
const PARAGRAPH = "矿区保有资源储量统计表见下，示例矿区保有资源储量 11.91 亿吨。\n\n";
const HTML_TABLE =
  "<table><tr><td>矿区</td><td>保有资源储量(亿吨)</td></tr><tr><td>示例矿区</td><td>11.91</td></tr></table>\n\n";

function buildProblematicMarkdown(): string {
  let markdown = HEADING;
  for (let index = 0; index < 40; index += 1) {
    markdown += PARAGRAPH;
    if (index % 10 === 9) {
      markdown += HTML_TABLE;
    }
  }
  return markdown;
}

describe("ProjectMdxReadonlyPreview problematic markdown", () => {
  it("renders the selected project markdown file", async () => {
    const markdown = buildProblematicMarkdown();

    render(
      <ProjectMdxReadonlyPreview
        filePath="sample-document.md"
        markdown={markdown}
      />,
    );

    // The preview opens in source mode; the Lexical content editable only mounts in rich-text mode.
    fireEvent.click(screen.getByRole("radio", { name: "Rich text" }));

    const editor = await screen.findByRole("textbox", { name: "editable markdown" });
    expect(editor.textContent?.length || 0).toBeGreaterThan(1000);
    expect(editor.textContent).toContain("钒钛概论");
    expect(editor.textContent).toContain("矿区");
  });
});
