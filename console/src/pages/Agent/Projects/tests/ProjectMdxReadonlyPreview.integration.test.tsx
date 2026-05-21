import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { renderMathInElementMock } = vi.hoisted(() => ({
  renderMathInElementMock: vi.fn(),
}));

vi.mock("katex/contrib/auto-render", () => ({
  default: renderMathInElementMock,
}));

import ProjectMdxReadonlyPreview from "../components/ProjectMdxReadonlyPreview";

describe("ProjectMdxReadonlyPreview integration", () => {
  it("renders markdown content through MDXEditor", async () => {
    render(
      <ProjectMdxReadonlyPreview
        filePath="docs/readme.md"
        markdown={"# Hello\n\nThis is **markdown**."}
      />,
    );

    const editor = await screen.findByRole("textbox");
    expect(screen.getByRole("radio", { name: "Source mode" }).getAttribute("aria-checked")).toBe("true");
    expect(editor.textContent).toContain("This is");
    expect(editor.textContent).toContain("Hello");
    expect(editor.textContent).toContain("markdown");
  });

  it("renders markdown with image and normalizes BOM/CRLF", async () => {
    render(
      <ProjectMdxReadonlyPreview
        filePath="docs/with-image.md"
        markdown={"\uFEFF# Title\r\n\r\n![](images/example.png)\r\n\r\nParagraph."}
      />,
    );

    const editor = await screen.findByRole("textbox");
    expect(screen.getByRole("radio", { name: "Source mode" }).getAttribute("aria-checked")).toBe("true");
    expect(editor.textContent).toContain("Title");
    expect(editor.textContent).toContain("Paragraph");
    expect(editor.textContent?.length || 0).toBeGreaterThan(0);
  });

  it("renders inline and block math formulas", async () => {
    renderMathInElementMock.mockClear();

    render(
      <ProjectMdxReadonlyPreview
        filePath="docs/with-math.md"
        markdown={"Formula: $\\mathrm{TiO_2}$\\n\\n$$E = mc^2$$"}
      />,
    );

    await screen.findByRole("textbox");
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Source mode" }).getAttribute("aria-checked")).toBe("true");
    });
    expect(renderMathInElementMock).not.toHaveBeenCalled();
  });
});
