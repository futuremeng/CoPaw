import { memo, useEffect, useMemo, useRef } from "react";
import {
  codeBlockPlugin,
  headingsPlugin,
  imagePlugin,
  linkPlugin,
  listsPlugin,
  MDXEditor,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import "katex/dist/katex.min.css";
import renderMathInElement from "katex/contrib/auto-render";
import styles from "./index.module.less";

interface ProjectMdxReadonlyPreviewProps {
  filePath: string;
  markdown: string;
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

function ProjectMdxReadonlyPreview({ filePath, markdown }: ProjectMdxReadonlyPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const plugins = useMemo(() => ([
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    imagePlugin(),
    tablePlugin(),
    codeBlockPlugin(),
  ]), []);
  const normalizedMarkdown = useMemo(
    () => normalizeMarkdownForMdxEditor(markdown),
    [markdown],
  );

  useEffect(() => {
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
  }, [filePath, normalizedMarkdown]);

  return (
    <div className={styles.mdxPreviewPane} ref={containerRef}>
      <MDXEditor
        key={`${filePath}:${normalizedMarkdown.length}`}
        markdown={normalizedMarkdown}
        plugins={plugins}
        readOnly
      />
    </div>
  );
}

export default memo(ProjectMdxReadonlyPreview);
