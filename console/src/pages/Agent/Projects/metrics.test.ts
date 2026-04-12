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
  isKnowledgeCandidatePath,
  isMarkdownPath,
  matchesProjectKnowledgeFilter,
  isRecentlyUpdatedFile,
  isTextLikePath,
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
        path: "skills/skill.md",
        size: 2048,
        modified_time: "2026-04-04T12:00:00Z",
      },
      {
        filename: "flow.json",
        path: "flows/flow.json",
        size: 4096,
        modified_time: "2026-04-09T11:00:00Z",
      },
      {
        filename: "diagram.png",
        path: "data/diagram.png",
        size: 8192,
        modified_time: "2026-04-09T10:00:00Z",
      },
    ];

    const metrics = computeProjectKnowledgeMetrics(files);

    expect(metrics.totalFiles).toBe(5);
    expect(metrics.knowledgeCandidateFiles).toBe(4);
    expect(metrics.markdownFiles).toBe(2);
    expect(metrics.textLikeFiles).toBe(4);
    expect(metrics.artifactFiles).toBe(2);
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
        path: "data/outline.txt",
        size: 512,
        modified_time: "2026-04-08T11:00:00Z",
      },
      {
        filename: "draft.py",
        path: "scripts/draft.py",
        size: 256,
        modified_time: "2026-04-07T11:00:00Z",
      },
    ]);

    expect(summary.totalFiles).toBe(3);
    expect(summary.originalFiles).toBe(1);
    expect(summary.derivedFiles).toBe(1);
    expect(summary.knowledgeMetrics.knowledgeCandidateFiles).toBe(2);
    expect(summary.knowledgeMetrics.textLikeFiles).toBe(3);
    expect(summary.knowledgeMetrics.artifactFiles).toBe(1);

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
        path: "data/image.png",
        size: 1024,
        modified_time: "2026-03-01T00:00:00Z",
      },
    ]);

    expect(getProjectKnowledgeQuantAssessment("knowledgeCandidates", metrics)).toEqual({
      tone: "warning",
      status: "attention",
    });
    expect(getProjectKnowledgeQuantAssessment("textLike", metrics)).toEqual({
      tone: "warning",
      status: "attention",
    });
    expect(getProjectKnowledgeQuantAssessment("recent", metrics)).toEqual({
      tone: "warning",
      status: "attention",
    });
    expect(getProjectKnowledgeQuantReason("knowledgeCandidates", metrics)).toEqual({
      key: "knowledgeCandidateLow",
    });
    expect(getProjectKnowledgeQuantReason("recent", metrics)).toEqual({
      key: "recentUpdatesLow",
    });
  });

  it("exposes reusable file classification helpers", () => {
    expect(isKnowledgeCandidatePath("original/doc.md")).toBe(true);
    expect(isKnowledgeCandidatePath("data/image.png")).toBe(false);
    expect(isMarkdownPath("original/doc.mdx")).toBe(true);
    expect(isMarkdownPath("original/readme.txt")).toBe(false);
    expect(isTextLikePath("scripts/run.py")).toBe(true);
    expect(isTextLikePath("assets/photo.webp")).toBe(false);
    expect(isRecentlyUpdatedFile("2026-04-08T00:00:00Z", Date.parse("2026-04-09T00:00:00Z"))).toBe(true);
    expect(isRecentlyUpdatedFile("2026-03-20T00:00:00Z", Date.parse("2026-04-09T00:00:00Z"))).toBe(false);
    expect(matchesProjectKnowledgeFilter("knowledgeCandidates", {
      path: "original/doc.md",
      modified_time: "2026-04-08T00:00:00Z",
    })).toBe(true);
    expect(matchesProjectKnowledgeFilter("markdown", {
      path: "original/doc.txt",
      modified_time: "2026-04-08T00:00:00Z",
    })).toBe(false);
    expect(matchesProjectKnowledgeFilter("textLike", {
      path: "scripts/run.py",
      modified_time: "2026-04-08T00:00:00Z",
    })).toBe(true);
    expect(matchesProjectKnowledgeFilter("recent", {
      path: "original/doc.md",
      modified_time: "2026-03-20T00:00:00Z",
    }, Date.parse("2026-04-09T00:00:00Z"))).toBe(false);
    expect(isProjectKnowledgeFilterKey("markdown")).toBe(true);
    expect(isProjectKnowledgeFilterKey("skills")).toBe(false);
    expect(getProjectKnowledgeFilterKeyFromMetric("knowledgeCandidates")).toBe("knowledgeCandidates");
    expect(getProjectKnowledgeFilterKeyFromMetric("markdown")).toBe("markdown");
    expect(getProjectKnowledgeFilterKeyFromMetric("textLike")).toBe("textLike");
    expect(getProjectKnowledgeFilterKeyFromMetric("recent")).toBe("recent");
    expect(getProjectKnowledgeFilterKeyFromMetric("artifact")).toBeUndefined();
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
    expect(cards).toHaveLength(8);
    expect(cards.find((card) => card.key === "knowledgeCandidates")?.value).toBe(1);
    expect(cards.find((card) => card.key === "knowledgeCandidates")?.filterKey).toBe("knowledgeCandidates");
    expect(cards.find((card) => card.key === "average")?.filterKey).toBeUndefined();
  });
});
