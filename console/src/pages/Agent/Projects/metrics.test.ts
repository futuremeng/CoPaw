import { describe, expect, it, vi } from "vitest";
import type { AgentProjectFileInfo } from "../../../api/types/agents";
import {
  buildProjectKnowledgeCardModels,
  computeProjectFileInventorySummary,
  computeProjectKnowledgeMetrics,
  formatFileSize,
  getProjectKnowledgeFilterKeyFromMetric,
  getProjectKnowledgeQuantAssessment,
  getProjectKnowledgeQuantReason,
  getProjectKnowledgeQuantStatusLabel,
  isProjectKnowledgeFilterKey,
  isMarkdownPath,
  matchesProjectKnowledgeFilter,
  isRecentlyUpdatedFile,
  isTextPath,
  isScriptPath,
  isOtherTypePath,
} from "./metrics";

describe("project metrics", () => {
  it("classifies project files into knowledge-related buckets", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T12:00:00Z"));

    const files: AgentProjectFileInfo[] = [
      {
        filename: "guide.md",
        path: "original/guide.md",
        size: 1024,
        modified_time: "2026-04-08T12:00:00Z",
      },
      {
        filename: "notes.txt",
        path: "original/notes.txt",
        size: 512,
        modified_time: "2026-03-20T12:00:00Z",
      },
      {
        filename: "skill.md",
        path: ".skills/skill.md",
        size: 2048,
        modified_time: "2026-04-04T12:00:00Z",
      },
      {
        filename: "flow.json",
        path: ".flows/flow.json",
        size: 4096,
        modified_time: "2026-04-09T11:00:00Z",
      },
      {
        filename: "diagram.png",
        path: "intermediate/diagram.png",
        size: 8192,
        modified_time: "2026-04-09T10:00:00Z",
      },
    ];

    const metrics = computeProjectKnowledgeMetrics(files);

    expect(metrics.totalFiles).toBe(5);
    expect(metrics.markdownFiles).toBe(2);
    expect(metrics.textFiles).toBe(2);
    expect(metrics.scriptFiles).toBe(0);
    expect(metrics.otherTypeFiles).toBe(1);
    expect(metrics.markdownFiles).toBe(2);
    expect(metrics.recentlyUpdatedFiles).toBe(4);
    expect(metrics.totalFileBytes).toBe(15872);
    expect(metrics.averageFileBytes).toBeCloseTo(3174.4, 1);

    vi.useRealTimers();
  });

  it("summarizes original and derived files in one pass", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T12:00:00Z"));

    const summary = computeProjectFileInventorySummary([
      {
        filename: "brief.md",
        path: "original/brief.md",
        size: 1024,
        modified_time: "2026-04-09T11:00:00Z",
      },
      {
        filename: "outline.txt",
        path: "intermediate/outline.txt",
        size: 512,
        modified_time: "2026-04-08T11:00:00Z",
      },
      {
        filename: "draft.py",
        path: ".scripts/draft.py",
        size: 256,
        modified_time: "2026-04-07T11:00:00Z",
      },
    ]);

    expect(summary.totalFiles).toBe(3);
    expect(summary.originalFiles).toBe(1);
    expect(summary.intermediateFiles).toBe(1);
    expect(summary.artifactFiles).toBe(0);
    expect(summary.knowledgeMetrics.textFiles).toBe(1);
    expect(summary.knowledgeMetrics.scriptFiles).toBe(1);
    expect(summary.knowledgeMetrics.otherTypeFiles).toBe(0);

    vi.useRealTimers();
  });

  it("formats file sizes across byte, KB and MB ranges", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("flags low text density and stale workspaces for attention", () => {
    const metrics = computeProjectKnowledgeMetrics([
      {
        filename: "image.png",
        path: "intermediate/image.png",
        size: 1024,
        modified_time: "2026-03-01T00:00:00Z",
      },
    ]);

    expect(getProjectKnowledgeQuantAssessment("markdown", metrics)).toEqual({
      tone: "neutral",
      status: "neutral",
    });
    expect(getProjectKnowledgeQuantAssessment("text", metrics)).toEqual({
      tone: "neutral",
      status: "neutral",
    });
    expect(getProjectKnowledgeQuantReason("text", metrics)).toEqual({
      key: "textMissing",
    });
  });

  it("exposes reusable file classification helpers", () => {
    expect(isMarkdownPath("original/doc.mdx")).toBe(true);
    expect(isMarkdownPath("original/readme.txt")).toBe(false);
    expect(isTextPath("original/doc.txt")).toBe(true);
    expect(isTextPath("assets/photo.webp")).toBe(false);
    expect(isScriptPath(".scripts/run.py")).toBe(true);
    expect(isOtherTypePath("assets/photo.webp")).toBe(true);
    expect(isRecentlyUpdatedFile("2026-04-08T00:00:00Z", Date.parse("2026-04-09T00:00:00Z"))).toBe(true);
    expect(isRecentlyUpdatedFile("2026-03-20T00:00:00Z", Date.parse("2026-04-09T00:00:00Z"))).toBe(false);
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
    expect(isProjectKnowledgeFilterKey("markdown")).toBe(true);
    expect(isProjectKnowledgeFilterKey("skills")).toBe(false);
    expect(getProjectKnowledgeFilterKeyFromMetric("markdown")).toBe("markdown");
    expect(getProjectKnowledgeFilterKeyFromMetric("text")).toBe("text");
    expect(getProjectKnowledgeFilterKeyFromMetric("script")).toBe("script");
    expect(getProjectKnowledgeFilterKeyFromMetric("otherType")).toBe("otherType");
    expect(getProjectKnowledgeQuantStatusLabel("attention")).toEqual({
      i18nKey: "projects.quantStatusAttention",
      defaultLabel: "Needs attention",
    });

    const cards = buildProjectKnowledgeCardModels(computeProjectKnowledgeMetrics([
      {
        filename: "doc.md",
        path: "original/doc.md",
        size: 1024,
        modified_time: "2026-04-08T00:00:00Z",
      },
    ]));
    expect(cards).toHaveLength(7);
    expect(cards.find((card) => card.key === "markdown")?.value).toBe(1);
    expect(cards.find((card) => card.key === "markdown")?.filterKey).toBe("markdown");
    expect(cards.find((card) => card.key === "average")?.filterKey).toBeUndefined();
  });
});
