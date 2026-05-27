export interface MarkdownOutlineItem {
  id: string;
  level: number;
  text: string;
  line: number;
}

export interface MarkdownOutlineJumpDetail {
  filePath: string;
  headingId: string;
  headingText: string;
  line: number;
}

export const PROJECT_MARKDOWN_OUTLINE_JUMP_EVENT = "copaw:project-markdown-outline-jump";

const MARKDOWN_FILE_RE = /\.(md|markdown|mdx)$/i;

export function isMarkdownDocumentPath(filePath: string): boolean {
  return MARKDOWN_FILE_RE.test(String(filePath || ""));
}

function cleanHeadingText(value: string): string {
  const noTrailingHash = value.replace(/\s+#+\s*$/g, "");
  return noTrailingHash
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]/g, "")
    .trim();
}

function slugifyHeading(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "section";
}

export function parseMarkdownOutline(markdown: string, maxItems = 120): MarkdownOutlineItem[] {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const items: MarkdownOutlineItem[] = [];
  const idCounter = new Map<string, number>();
  let activeFenceChar = "";

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!activeFenceChar) {
        activeFenceChar = marker;
      } else if (activeFenceChar === marker) {
        activeFenceChar = "";
      }
      continue;
    }
    if (activeFenceChar) {
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (!headingMatch) {
      continue;
    }

    const level = headingMatch[1].length;
    const text = cleanHeadingText(headingMatch[2]);
    if (!text) {
      continue;
    }

    const baseId = slugifyHeading(text);
    const count = (idCounter.get(baseId) || 0) + 1;
    idCounter.set(baseId, count);

    items.push({
      id: count > 1 ? `${baseId}-${count}` : baseId,
      level,
      text,
      line: i + 1,
    });

    if (items.length >= maxItems) {
      break;
    }
  }

  return items;
}

export function normalizeHeadingForMatch(value: string): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}