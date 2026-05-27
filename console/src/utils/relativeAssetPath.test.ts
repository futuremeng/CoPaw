import { describe, expect, it } from "vitest";
import {
  resolveRelativeAssetPath,
  rewriteMarkdownImageSources,
} from "./relativeAssetPath";

describe("resolveRelativeAssetPath", () => {
  it("resolves sibling and parent relative paths", () => {
    expect(resolveRelativeAssetPath("docs/a/file.md", "./img.png")).toBe("docs/a/img.png");
    expect(resolveRelativeAssetPath("docs/a/file.md", "../img.png")).toBe("docs/img.png");
  });

  it("keeps query/hash and rejects escaping root", () => {
    expect(resolveRelativeAssetPath("docs/a/file.md", "./img.png?raw=1#part")).toBe(
      "docs/a/img.png?raw=1#part",
    );
    expect(resolveRelativeAssetPath("docs/a/file.md", "../../../img.png")).toBeNull();
  });

  it("does not resolve external or anchor urls", () => {
    expect(resolveRelativeAssetPath("docs/a/file.md", "https://example.com/x.png")).toBeNull();
    expect(resolveRelativeAssetPath("docs/a/file.md", "#section")).toBeNull();
  });
});

describe("rewriteMarkdownImageSources", () => {
  it("rewrites markdown and html image sources", () => {
    const source = [
      "![one](./a.png)",
      "<img src=\"../b.png\" alt=\"b\" />",
      "![remote](https://example.com/c.png)",
    ].join("\n");

    const output = rewriteMarkdownImageSources(source, (src) => {
      if (src.startsWith("http")) return null;
      return `resolved/${src}`;
    });

    expect(output).toContain("![one](resolved/./a.png)");
    expect(output).toContain('<img src="resolved/../b.png" alt="b" />');
    expect(output).toContain("![remote](https://example.com/c.png)");
  });
});