import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ProjectMdxReadonlyPreview from "../components/ProjectMdxReadonlyPreview";

describe("ProjectMdxReadonlyPreview raw html table", () => {
  it("renders markdown containing a raw html table", async () => {
    const markdown = `# Title\n\nBefore table.\n\n<table><tr><td>矿区</td><td>保有资源储量(亿吨)</td></tr><tr><td>攀枝花矿区</td><td>11.91</td></tr></table>\n\nAfter table.`;
    render(<ProjectMdxReadonlyPreview filePath="table-case.md" markdown={markdown} />);
    const editor = await screen.findByRole("textbox", { name: "editable markdown" });
    expect(editor.textContent?.length || 0).toBeGreaterThan(0);
  });
});
