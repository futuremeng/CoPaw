interface ComposeSelectedFilesPayloadParams {
  selectedAttachPaths: string[];
  projectFiles: Array<{ path: string; size: number }>;
  fetchContentByPath: (path: string) => Promise<string>;
}

interface ComposeContentBySizeParams {
  path: string;
  fileName: string;
  size: number;
  content: string;
}

const INLINE_FULL_MAX_BYTES = 32 * 1024;
const INLINE_TRUNCATE_MAX_BYTES = 256 * 1024;
const INLINE_TRUNCATE_HEAD_CHARS = 8000;
const INLINE_TRUNCATE_TAIL_CHARS = 4000;
const INLINE_TOTAL_CHAR_BUDGET = 20000;

function inferMimeTypeByPath(path: string): string {
  const normalized = path.toLowerCase();
  if (
    normalized.endsWith(".md") ||
    normalized.endsWith(".markdown") ||
    normalized.endsWith(".mdx")
  ) {
    return "text/markdown";
  }
  if (normalized.endsWith(".txt")) {
    return "text/plain";
  }
  if (normalized.endsWith(".json")) {
    return "application/json";
  }
  return "text/plain";
}

function buildAttachContentBySize(params: ComposeContentBySizeParams): string {
  const { path, fileName, size, content } = params;
  if (size <= INLINE_FULL_MAX_BYTES) {
    return content;
  }

  if (size <= INLINE_TRUNCATE_MAX_BYTES) {
    const head = content.slice(0, INLINE_TRUNCATE_HEAD_CHARS);
    const tail = content.slice(-INLINE_TRUNCATE_TAIL_CHARS);
    return [
      "[Truncated file for context window control]",
      `file: ${fileName}`,
      `path: ${path}`,
      `size: ${size} bytes`,
      "--- HEAD ---",
      head,
      "--- TAIL ---",
      tail,
    ].join("\n");
  }

  return [
    "[Large file metadata only to avoid context overflow]",
    `file: ${fileName}`,
    `path: ${path}`,
    `size: ${size} bytes`,
    "note: use this file name/path as reference and request focused extraction if needed.",
  ].join("\n");
}

export async function composeSelectedFilesPayload({
  selectedAttachPaths,
  projectFiles,
  fetchContentByPath,
}: ComposeSelectedFilesPayloadParams): Promise<
  Array<{ fileName: string; content: string; mimeType?: string }>
> {
  const filesPayload: Array<{ fileName: string; content: string; mimeType?: string }> = [];
  let remainingChars = INLINE_TOTAL_CHAR_BUDGET;

  for (const path of selectedAttachPaths) {
    const fileInfo = projectFiles.find((file) => file.path === path);
    const fileName = path.split("/").pop() || "project-file.txt";
    const size = fileInfo?.size || 0;

    if (remainingChars <= 0) {
      filesPayload.push({
        fileName,
        content: buildAttachContentBySize({ path, fileName, size, content: "" }),
        mimeType: "text/plain",
      });
      continue;
    }

    if (size > INLINE_TRUNCATE_MAX_BYTES) {
      filesPayload.push({
        fileName,
        content: buildAttachContentBySize({ path, fileName, size, content: "" }),
        mimeType: "text/plain",
      });
      remainingChars = Math.max(0, remainingChars - 300);
      continue;
    }

    const rawContent = await fetchContentByPath(path);
    const prepared = buildAttachContentBySize({ path, fileName, size, content: rawContent });
    const finalContent =
      prepared.length <= remainingChars
        ? prepared
        : `${prepared.slice(0, Math.max(800, remainingChars))}\n\n[Trimmed by total context budget]`;
    filesPayload.push({
      fileName,
      content: finalContent,
      mimeType: inferMimeTypeByPath(path),
    });
    remainingChars = Math.max(0, remainingChars - finalContent.length);
  }

  return filesPayload;
}
