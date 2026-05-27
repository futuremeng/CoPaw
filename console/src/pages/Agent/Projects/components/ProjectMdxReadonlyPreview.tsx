import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  DiffSourceToggleWrapper,
  codeBlockPlugin,
  diffSourcePlugin,
  headingsPlugin,
  imagePlugin,
  linkPlugin,
  listsPlugin,
  MDXEditor,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  useCellValue,
  viewMode$,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import "katex/dist/katex.min.css";
import renderMathInElement from "katex/contrib/auto-render";
import { agentsApi } from "../../../../api/modules/agents";
import {
  resolveRelativeAssetPath,
  rewriteMarkdownImageSources,
} from "../../../../utils/relativeAssetPath";
import {
  normalizeHeadingForMatch,
  PROJECT_MARKDOWN_OUTLINE_JUMP_EVENT,
  type MarkdownOutlineJumpDetail,
} from "../utils/markdownOutline";
import styles from "../index.module.less";

interface ProjectMdxReadonlyPreviewProps {
  filePath: string;
  markdown: string;
  agentId?: string;
  projectId?: string;
}

type EditorViewMode = "rich-text" | "source" | "diff";

const MDX_PREVIEW_MODE_STORAGE_KEY = "projectMdxReadonlyPreviewMode";

interface ViewModeSyncProps {
  onViewModeChange: (mode: EditorViewMode) => void;
}

function ViewModeSync({ onViewModeChange }: ViewModeSyncProps) {
  const viewMode = useCellValue(viewMode$);

  useEffect(() => {
    onViewModeChange(viewMode);
  }, [onViewModeChange, viewMode]);

  return null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeMarkdownTableCell(value: string): string {
  return normalizeWhitespace(value).replace(/\|/g, "\\|");
}

function convertHtmlTablesToMarkdown(markdown: string): string {
  if (!markdown.includes("<table")) {
    return markdown;
  }

  return markdown.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (tableBlock) => {
    const rowMatches = Array.from(tableBlock.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi));
    const rows = rowMatches
      .map((match) => {
        const cellMatches = Array.from(match[1].matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/(td|th)>/gi));
        return cellMatches.map((cell) => {
          const textContent = cell[2].replace(/<[^>]+>/g, " ");
          return escapeMarkdownTableCell(textContent);
        });
      })
      .filter((row) => row.length > 0);

    if (rows.length === 0) {
      return tableBlock;
    }

    const header = rows[0];
    const separator = header.map(() => "---");
    const body = rows.slice(1);
    const markdownRows = [header, separator, ...body]
      .map((row) => `| ${row.join(" | ")} |`)
      .join("\n");

    return `\n\n${markdownRows}\n\n`;
  });
}

function normalizeMarkdownForMdxEditor(markdown: string): string {
  // Normalize common OCR/export artifacts before handing text to MDXEditor.
  const normalized = markdown
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ");
  return convertHtmlTablesToMarkdown(normalized);
}

function ProjectMdxReadonlyPreview({
  filePath,
  markdown,
  agentId,
  projectId,
}: ProjectMdxReadonlyPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const jumpHighlightTimerRef = useRef<number | null>(null);
  const [viewMode, setViewMode] = useState<EditorViewMode>(() => {
    return "source";
  });
  const plugins = useMemo(() => ([
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    imagePlugin(),
    tablePlugin(),
    codeBlockPlugin(),
    toolbarPlugin({
      toolbarContents: () => (
        <>
          <DiffSourceToggleWrapper options={["rich-text", "source"]} SourceToolbar={<></>}>
            <></>
          </DiffSourceToggleWrapper>
          <ViewModeSync onViewModeChange={setViewMode} />
        </>
      ),
    }),
    diffSourcePlugin({ viewMode }),
  ]), [viewMode]);
  const normalizedMarkdown = useMemo(
    () => normalizeMarkdownForMdxEditor(markdown),
    [markdown],
  );
  const markdownWithResolvedImageSources = useMemo(() => {
    if (!agentId || !projectId) {
      return normalizedMarkdown;
    }

    return rewriteMarkdownImageSources(normalizedMarkdown, (src) => {
      const resolvedPath = resolveRelativeAssetPath(filePath, src);
      if (!resolvedPath) {
        return null;
      }
      return agentsApi.getProjectBinaryFileUrl(agentId, projectId, resolvedPath);
    });
  }, [agentId, filePath, normalizedMarkdown, projectId]);

  useEffect(() => {
    if (viewMode !== "rich-text") {
      return;
    }

    const root = containerRef.current?.querySelector("[role='textbox'][aria-label='editable markdown']");
    if (!(root instanceof HTMLElement)) {
      return;
    }

    renderMathInElement(root, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
      strict: "ignore",
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
    });
  }, [filePath, normalizedMarkdown, viewMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(MDX_PREVIEW_MODE_STORAGE_KEY, viewMode === "source" ? "source" : "rich-text");
  }, [viewMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let cancelled = false;

    const findHeadingElement = (targetHeading: string): HTMLElement | null => {
      const root = containerRef.current;
      if (!root) {
        return null;
      }
      const headings = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6")) as HTMLElement[];
      if (headings.length === 0) {
        return null;
      }
      const normalizedTarget = normalizeHeadingForMatch(targetHeading);
      if (!normalizedTarget) {
        return null;
      }

      return headings.find((node) => normalizeHeadingForMatch(node.textContent || "") === normalizedTarget)
        || headings.find((node) => normalizeHeadingForMatch(node.textContent || "").includes(normalizedTarget))
        || null;
    };

    const jumpToHeading = (targetHeading: string, retryCount = 0) => {
      if (cancelled) {
        return;
      }
      const targetNode = findHeadingElement(targetHeading);
      if (!targetNode) {
        if (retryCount < 10) {
          window.setTimeout(() => jumpToHeading(targetHeading, retryCount + 1), 80);
        }
        return;
      }

      targetNode.scrollIntoView({ behavior: "smooth", block: "start" });
      targetNode.classList.add(styles.mdxOutlineJumpTarget);
      if (jumpHighlightTimerRef.current !== null) {
        window.clearTimeout(jumpHighlightTimerRef.current);
      }
      jumpHighlightTimerRef.current = window.setTimeout(() => {
        targetNode.classList.remove(styles.mdxOutlineJumpTarget);
        jumpHighlightTimerRef.current = null;
      }, 1200);
    };

    const onJump = (event: Event) => {
      const detail = (event as CustomEvent<MarkdownOutlineJumpDetail>).detail;
      if (!detail || detail.filePath !== filePath) {
        return;
      }
      if (viewMode !== "rich-text") {
        setViewMode("rich-text");
      }
      jumpToHeading(detail.headingText);
    };

    window.addEventListener(PROJECT_MARKDOWN_OUTLINE_JUMP_EVENT, onJump as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener(PROJECT_MARKDOWN_OUTLINE_JUMP_EVENT, onJump as EventListener);
      if (jumpHighlightTimerRef.current !== null) {
        window.clearTimeout(jumpHighlightTimerRef.current);
        jumpHighlightTimerRef.current = null;
      }
    };
  }, [filePath, viewMode]);

  return (
    <div className={styles.mdxPreviewPane} ref={containerRef}>
      <MDXEditor
        key={`${filePath}:${markdownWithResolvedImageSources.length}`}
        markdown={markdownWithResolvedImageSources}
        plugins={plugins}
        readOnly
      />
    </div>
  );
}

export default memo(ProjectMdxReadonlyPreview);
