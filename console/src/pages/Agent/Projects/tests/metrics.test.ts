import { describe, expect, it } from "vitest";
import type { AgentProjectFileInfo } from "../../../../api/types/agents";
import {
  formatFileSize,
  isMarkdownPath,
  isScriptPath,
  isTextPath,
  matchesProjectKnowledgeFilter,
} from "../utils/metrics";

describe("project metrics", () => {
  it("prefers backend content_type labels over path extensions", () => {
    const files: AgentProjectFileInfo[] = [
      {
        filename: "readme.bin",
        path: "output/readme.bin",
        size: 128,
        modified_time: "2026-04-09T11:00:00Z",
        content_type: "markdown",
      },
      {
        filename: "notes.unknown",
        path: "random/notes.unknown",
        size: 64,
        modified_time: "2026-04-09T10:00:00Z",
        content_type: "text",
      },
      {
        filename: "data.raw",
        path: "random/data.raw",
        size: 256,
        modified_time: "2026-04-09T09:00:00Z",
        content_type: "other",
      },
    ];

    expect(matchesProjectKnowledgeFilter("markdown", files[0])).toBe(true);
    expect(matchesProjectKnowledgeFilter("text", files[1])).toBe(true);
    expect(matchesProjectKnowledgeFilter("otherType", files[2])).toBe(true);
  });

  it("formats file sizes across byte, KB and MB ranges", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("exposes reusable file classification helpers", () => {
    expect(isMarkdownPath("original/doc.mdx")).toBe(true);
    expect(isMarkdownPath("original/readme.txt")).toBe(false);
    expect(isTextPath("original/doc.txt")).toBe(true);
    expect(isTextPath("assets/photo.webp")).toBe(false);
    expect(isScriptPath(".scripts/run.py")).toBe(true);
    expect(matchesProjectKnowledgeFilter("markdown", {
      path: "original/doc.txt",
      modified_time: "2026-04-08T00:00:00Z",
    })).toBe(false);
    expect(matchesProjectKnowledgeFilter("text", {
      path: "original/doc.txt",
      modified_time: "2026-04-08T00:00:00Z",
    })).toBe(true);
    expect(matchesProjectKnowledgeFilter("script", {
      path: ".scripts/run.py",
      modified_time: "2026-04-08T00:00:00Z",
    })).toBe(true);
    expect(matchesProjectKnowledgeFilter("otherType", {
      path: "assets/photo.webp",
      modified_time: "2026-03-20T00:00:00Z",
    })).toBe(true);
  });
});
