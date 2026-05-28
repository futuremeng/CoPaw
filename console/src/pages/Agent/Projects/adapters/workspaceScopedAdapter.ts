import { buildAuthHeaders } from "../../../../api/authHeaders";
import { workspaceApi } from "../../../../api/modules/workspace";
import type { MdFileInfo } from "../../../../api/types/workspace";
import type { AgentProjectFileSummary } from "../../../../api/types/agents";
import {
  WORKSPACE_SCOPED_CAPABILITIES,
  isPathReadonly,
} from "./capabilities";
import type {
  ProjectWorkspaceAdapter,
  ProjectWorkspaceQueryInput,
  ProjectWorkspaceQueryOutput,
  ProjectWorkspaceWatchEvent,
} from "./types";

function inferContentType(path: string): "markdown" | "text" | "script" | "other" {
  const normalized = String(path || "").toLowerCase();
  if (normalized.endsWith(".md") || normalized.endsWith(".mdx") || normalized.endsWith(".markdown")) {
    return "markdown";
  }
  if (normalized.endsWith(".txt") || normalized.endsWith(".log") || normalized.endsWith(".csv")) {
    return "text";
  }
  if (
    normalized.endsWith(".py")
    || normalized.endsWith(".ts")
    || normalized.endsWith(".tsx")
    || normalized.endsWith(".js")
    || normalized.endsWith(".jsx")
    || normalized.endsWith(".json")
    || normalized.endsWith(".yaml")
    || normalized.endsWith(".yml")
    || normalized.endsWith(".sh")
    || normalized.endsWith(".sql")
  ) {
    return "script";
  }
  return "other";
}

function filterAndSort(files: MdFileInfo[], input: ProjectWorkspaceQueryInput): MdFileInfo[] {
  const search = String(input.search || "").trim().toLowerCase();
  const pathPrefix = String(input.pathPrefix || "").trim().replace(/\\/g, "/");

  let items = files.filter((item) => {
    if (pathPrefix && !item.path.startsWith(pathPrefix)) {
      return false;
    }
    if (!search) {
      return true;
    }
    const lowerPath = item.path.toLowerCase();
    const lowerName = item.filename.toLowerCase();
    return lowerPath.includes(search) || lowerName.includes(search);
  });

  const sortBy = input.sortBy ?? "path";
  const sortOrder = input.sortOrder ?? "asc";
  items = [...items].sort((left, right) => {
    let compare = 0;
    if (sortBy === "size") {
      compare = left.size - right.size;
    } else if (sortBy === "modified_time") {
      compare = left.modified_time.localeCompare(right.modified_time);
    } else {
      compare = left.path.localeCompare(right.path);
    }
    return sortOrder === "desc" ? -compare : compare;
  });

  return items;
}

function mapWorkspaceQueryOutput(files: MdFileInfo[], input: ProjectWorkspaceQueryInput): ProjectWorkspaceQueryOutput {
  const totalMatched = files.length;
  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.max(0, input.limit ?? 5000);
  const page = files.slice(offset, offset + limit);

  return {
    items: page.map((item) => ({
      filename: item.filename,
      path: item.path,
      size: item.size,
      modifiedTime: item.modified_time,
      contentType: inferContentType(item.path),
      readonly: isPathReadonly(item.path, WORKSPACE_SCOPED_CAPABILITIES.readonlyPathRules),
    })),
    summary: {
      totalMatched,
      returned: page.length,
      offset,
      limit,
      builtinCount: 0,
      ignoredCount: 0,
    },
    queryMeta: {
      search: input.search || "",
      pathPrefix: input.pathPrefix || "",
      capabilities: WORKSPACE_SCOPED_CAPABILITIES,
    },
  };
}

function buildWorkspaceFileSummary(files: MdFileInfo[]): AgentProjectFileSummary {
  const total = files.length;
  const markdown = files.filter((item) => inferContentType(item.path) === "markdown").length;
  const textLike = files.filter((item) => {
    const type = inferContentType(item.path);
    return type === "markdown" || type === "text";
  }).length;

  const recentUpdates = [...files]
    .sort((left, right) => right.modified_time.localeCompare(left.modified_time))
    .slice(0, 10)
    .map((item) => ({
      filename: item.filename,
      path: item.path,
      size: item.size,
      modified_time: item.modified_time,
    }));

  return {
    total_files: total,
    builtin_files: 0,
    visible_files: total,
    original_files: total,
    derived_files: 0,
    knowledge_candidate_files: total,
    markdown_files: markdown,
    text_like_files: textLike,
    recently_updated_files: recentUpdates.length,
    recent_updates: recentUpdates,
  };
}

function splitPath(path: string): string[] {
  return path.replace(/\\/g, "/").split("/").filter(Boolean);
}

function buildTreeNodes(files: MdFileInfo[], dirPath = "") {
  const normalizedDir = String(dirPath || "").replace(/\\/g, "/").replace(/^\//, "").replace(/\/$/, "");
  const bucket = new Map<string, { isDir: boolean; size: number; modifiedTime: string }>();

  for (const file of files) {
    const parts = splitPath(file.path);
    const baseParts = normalizedDir ? splitPath(normalizedDir) : [];
    if (baseParts.length > parts.length) {
      continue;
    }
    const withinDir = baseParts.every((part, index) => parts[index] === part);
    if (!withinDir) {
      continue;
    }
    const relative = parts.slice(baseParts.length);
    if (relative.length === 0) {
      continue;
    }
    const child = relative[0];
    const childPath = normalizedDir ? `${normalizedDir}/${child}` : child;
    if (relative.length > 1) {
      if (!bucket.has(childPath)) {
        bucket.set(childPath, {
          isDir: true,
          size: 0,
          modifiedTime: file.modified_time,
        });
      }
      continue;
    }
    bucket.set(childPath, {
      isDir: false,
      size: file.size,
      modifiedTime: file.modified_time,
    });
  }

  return [...bucket.entries()]
    .sort(([leftPath, left], [rightPath, right]) => {
      if (left.isDir !== right.isDir) {
        return left.isDir ? -1 : 1;
      }
      return leftPath.localeCompare(rightPath);
    })
    .map(([path, item]) => ({
      filename: splitPath(path).slice(-1)[0] || path,
      path,
      size: item.size,
      modified_time: item.modifiedTime,
      is_directory: item.isDir,
      child_count: 0,
      descendant_file_count: 0,
      direct_file_count: 0,
      has_child_directories: false,
    }));
}

function watchWorkspaceFiles(subscriber: (events: ProjectWorkspaceWatchEvent[]) => void): () => void {
  const controller = new AbortController();
  const url = workspaceApi.getWatchUrl();

  const run = async () => {
    let retryDelayMs = 1000;

    while (!controller.signal.aborted) {
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: buildAuthHeaders(),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          retryDelayMs = Math.min(retryDelayMs * 2, 30000);
          continue;
        }

        retryDelayMs = 1000;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data:")) {
              continue;
            }
            const raw = line.slice(5).trim();
            if (!raw) {
              continue;
            }
            try {
              const payload = JSON.parse(raw) as {
                type: string;
                events?: Array<{ change: "added" | "modified" | "deleted"; path: string }>;
              };
              if (payload.type !== "file_change" || !Array.isArray(payload.events)) {
                continue;
              }
              subscriber(
                payload.events.map((event) => ({
                  change: event.change,
                  path: event.path,
                  source: "workspace",
                })),
              );
            } catch {
              // Ignore malformed frames from the watch stream.
            }
          }
        }
      } catch {
        if (controller.signal.aborted) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        retryDelayMs = Math.min(retryDelayMs * 2, 30000);
      }
    }
  };

  void run();
  return () => controller.abort();
}

export function createWorkspaceScopedAdapter(): ProjectWorkspaceAdapter {
  return {
    getScope: () => "workspace",
    getCapabilities: () => WORKSPACE_SCOPED_CAPABILITIES,
    queryFiles: async (input) => {
      const files = await workspaceApi.listCodeFiles();
      const filtered = filterAndSort(files, input);
      return mapWorkspaceQueryOutput(filtered, input);
    },
    getFileSummary: async () => {
      const files = await workspaceApi.listCodeFiles();
      return buildWorkspaceFileSummary(files);
    },
    listTree: async (dirPath = "") => {
      const files = await workspaceApi.listCodeFiles();
      return buildTreeNodes(files, dirPath);
    },
    readText: async (path) => {
      const payload = await workspaceApi.loadCodeFile(path);
      return { content: payload.content || "" };
    },
    writeText: async (path, content) => {
      const payload = await workspaceApi.saveCodeFile(path, content);
      return {
        path: payload.path,
        size: payload.size,
      };
    },
    getBinaryUrl: (path) => workspaceApi.getBinaryFileUrl(path),
    mkdir: async () => {
      throw new Error("Workspace scoped adapter does not support directory operations yet.");
    },
    move: async () => {
      throw new Error("Workspace scoped adapter does not support path move operations yet.");
    },
    remove: async () => {
      throw new Error("Workspace scoped adapter does not support delete operations yet.");
    },
    upload: async (file) => {
      await workspaceApi.uploadFile(file);
    },
    watch: (subscriber) => watchWorkspaceFiles(subscriber),
  };
}
