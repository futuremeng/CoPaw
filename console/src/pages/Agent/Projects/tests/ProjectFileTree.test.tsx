import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentProjectFileInfo,
  AgentProjectFileSummary,
  AgentProjectFileTreeNode,
  AgentProjectSummary,
} from "../../../../api/types/agents";
import ProjectFileTree from "../components/ProjectFileTree";
import type { ProjectFileFilterKey } from "../utils/filtering";
import type { ProjectStageKey } from "../utils/projectLayoutPrefs";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      maybeFallbackOrOptions?: string | { label?: string },
      maybeOptions?: { label?: string },
    ) => {
      const fallback = typeof maybeFallbackOrOptions === "string" ? maybeFallbackOrOptions : undefined;
      const options = typeof maybeFallbackOrOptions === "object"
        ? maybeFallbackOrOptions
        : maybeOptions;

      if (options?.label && typeof fallback === "string") {
        return fallback.replace("{{label}}", options.label);
      }

      if (typeof fallback === "string") {
        return fallback;
      }

      return key;
    },
  }),
}));

function buildProjectSummary(): AgentProjectSummary {
  return {
    id: "proj-1",
    name: "Project One",
    description: "demo",
    status: "active",
    workspace_dir: "workspace",
    data_dir: "data",
    metadata_file: "project.json",
    tags: [],
    artifact_distill_mode: "file_scan",
    artifact_profile: {
      skills: [],
      scripts: [],
      flows: [],
      cases: [],
    },
    project_auto_knowledge_sink: true,
    created_time: "2026-04-01T00:00:00Z",
    updated_time: "2026-04-09T00:00:00Z",
  };
}

function buildFile(path: string): AgentProjectFileInfo {
  return {
    filename: path.split("/").filter(Boolean).pop() || path,
    path,
    size: 10,
    modified_time: "2026-04-09T00:00:00Z",
  };
}

function buildFileSummary(
  overrides?: Partial<AgentProjectFileSummary>,
): AgentProjectFileSummary {
  return {
    total_files: 2,
    builtin_files: 0,
    visible_files: 2,
    original_files: 2,
    derived_files: 0,
    knowledge_candidate_files: 2,
    markdown_files: 1,
    text_like_files: 2,
    recently_updated_files: 0,
    ...overrides,
  };
}

function buildTreeNode(
  path: string,
  overrides?: Partial<AgentProjectFileTreeNode>,
): AgentProjectFileTreeNode {
  return {
    filename: path.split("/").filter(Boolean).pop() || path,
    path,
    size: 0,
    modified_time: "2026-04-09T00:00:00Z",
    is_directory: true,
    child_count: 1,
    descendant_file_count: 1,
    direct_file_count: 1,
    has_child_directories: false,
    ...overrides,
  };
}

function buildLeafNode(path: string): AgentProjectFileTreeNode {
  return buildTreeNode(path, {
    is_directory: false,
    child_count: 0,
    descendant_file_count: 0,
    direct_file_count: 0,
    has_child_directories: false,
  });
}

function renderTree(
  projectFiles: AgentProjectFileInfo[],
  options?: {
    activeStage?: ProjectStageKey;
    initialFilter?: ProjectFileFilterKey | "";
    initialTreeDisplayMode?: "filter" | "highlight";
    projectFileSummary?: AgentProjectFileSummary | null;
    selectedFilePath?: string;
    expandedKeys?: string[];
    projectTreeNodes?: AgentProjectFileTreeNode[];
    onLoadProjectTreeChildren?: (path: string) => Promise<AgentProjectFileTreeNode[]>;
  },
) {
  function TestHarness() {
    const [selectedMetricFilter, setSelectedMetricFilter] = useState<ProjectFileFilterKey | "">(
      options?.initialFilter ?? "",
    );
    const [treeDisplayMode, setTreeDisplayMode] = useState<"filter" | "highlight">(
      options?.initialTreeDisplayMode ?? "filter",
    );

    return (
      <ProjectFileTree
        activeStage={options?.activeStage ?? "source"}
        selectedProject={buildProjectSummary()}
        selectedMetricFilter={selectedMetricFilter}
        onMetricFilterChange={setSelectedMetricFilter}
        treeDisplayMode={treeDisplayMode}
        onTreeDisplayModeChange={setTreeDisplayMode}
        projectFiles={projectFiles}
        projectFileSummary={options?.projectFileSummary ?? null}
        projectTreeNodes={options?.projectTreeNodes ?? []}
        priorityFilePaths={[]}
        selectedFilePath={options?.selectedFilePath ?? ""}
        expandedKeys={options?.expandedKeys}
        selectedAttachPaths={[]}
        onUploadFiles={vi.fn()}
        onSelectFileFromTree={vi.fn()}
        onAttachArtifactToChat={vi.fn()}
        onExpandedKeysChange={options?.expandedKeys ? vi.fn() : undefined}
        onLoadProjectTreeChildren={options?.onLoadProjectTreeChildren}
      />
    );
  }

  render(<TestHarness />);
}

describe("ProjectFileTree interactions", () => {
  it("filters files by keyword and shows keyword empty state", async () => {
    const user = userEvent.setup();
    renderTree([buildFile("data/README.md"), buildFile("original/guide.md")]);

    await user.type(screen.getByPlaceholderText("Filter files"), "missing-keyword");

    expect(screen.getByText("No files match the current keyword")).toBeDefined();

    await user.clear(screen.getByPlaceholderText("Filter files"));
    await user.type(screen.getByPlaceholderText("Filter files"), "readme");

    expect(screen.getByText("README.md")).toBeDefined();
    expect(screen.queryByText("guide.md")).toBeNull();
  });

  it("does not clear controlled tree filter input while typing", async () => {
    const user = userEvent.setup();

    function ControlledTreeFilterHarness() {
      const [query, setQuery] = useState("");

      return (
        <ProjectFileTree
          activeStage="source"
          selectedMetricFilter=""
          treeDisplayMode="filter"
          onTreeDisplayModeChange={vi.fn()}
          selectedProject={buildProjectSummary()}
          projectFiles={[buildFile("data/README.md")]}
          projectTreeNodes={[]}
          priorityFilePaths={[]}
          selectedFilePath=""
          selectedAttachPaths={[]}
          treeFilterQuery={query}
          onTreeFilterQueryChange={setQuery}
          onUploadFiles={vi.fn()}
          onSelectFileFromTree={vi.fn()}
          onAttachArtifactToChat={vi.fn()}
        />
      );
    }

    render(<ControlledTreeFilterHarness />);

    const input = screen.getByPlaceholderText("Filter files") as HTMLInputElement;
    await user.type(input, "readme");

    expect(input.value).toBe("readme");
  });

  it("keeps built-in files searchable without an active filter", async () => {
    const user = userEvent.setup();
    renderTree([buildFile(".agent/AGENTS.md"), buildFile("original/guide.md")]);

    await user.type(screen.getByPlaceholderText("Filter files"), "agents");

    expect(screen.getByText("AGENTS.md")).toBeDefined();
    expect(screen.queryByText("guide.md")).toBeNull();
  });

  it("loads expanded lazy directories automatically", async () => {
    const onLoadProjectTreeChildren = vi.fn(async () => [buildLeafNode("original/guide.md")]);

    renderTree([], {
      expandedKeys: ["original"],
      projectTreeNodes: [buildTreeNode("original")],
      onLoadProjectTreeChildren,
    });

    await waitFor(() => {
      expect(onLoadProjectTreeChildren).toHaveBeenCalledWith("original");
    });

    expect(await screen.findByText("guide.md")).toBeDefined();
  });

  it("shows only built-in root directories when the builtin filter is active", async () => {
    const onLoadProjectTreeChildren = vi.fn(async () => [buildLeafNode(".agent/AGENTS.md")]);

    renderTree(
      [
        buildFile(".agent/AGENTS.md"),
        buildFile(".env"),
        buildFile(".cursor/config.json"),
        buildFile("original/guide.md"),
      ],
      {
        activeStage: "builtin",
        initialFilter: "builtin",
        expandedKeys: [".agent"],
        projectTreeNodes: [
          buildTreeNode(".agent"),
          buildTreeNode(".cursor"),
          buildLeafNode(".env"),
          buildTreeNode("original"),
        ],
        onLoadProjectTreeChildren,
      },
    );

    await waitFor(() => {
      expect(onLoadProjectTreeChildren).toHaveBeenCalledWith(".agent");
    });

    expect(await screen.findByText("AGENTS.md")).toBeDefined();
    expect(screen.getByText(".cursor")).toBeDefined();
    expect(screen.queryByText(".env")).toBeNull();
    expect(screen.queryByText("original")).toBeNull();
  });

  it("renders built-in root directories in lazy tree mode", () => {
    renderTree([], {
      projectTreeNodes: [buildTreeNode(".agent"), buildTreeNode("original")],
    });

    expect(screen.getByText(".agent")).toBeDefined();
    expect(screen.getByText("original")).toBeDefined();
  });

  it("shows direct file count with plus when a directory still has child directories", () => {
    renderTree([], {
      projectTreeNodes: [
        buildTreeNode("original", {
          child_count: 2,
          descendant_file_count: 1,
          direct_file_count: 1,
          has_child_directories: true,
        }),
      ],
    });

    expect(screen.getByText("original")).toBeDefined();
    expect(screen.getByText("1+")).toBeDefined();
  });

  it("keeps loaded lazy children when root tree nodes refresh", async () => {
    const onLoadProjectTreeChildren = vi.fn(async () => [buildLeafNode("original/guide.md")]);

    function RefreshHarness() {
      const [projectTreeNodes, setProjectTreeNodes] = useState<AgentProjectFileTreeNode[]>([
        buildTreeNode("original"),
      ]);

      return (
        <>
          <button
            type="button"
            onClick={() => {
              setProjectTreeNodes([
                buildTreeNode("original", { modified_time: "2026-04-09T00:01:00Z" }),
              ]);
            }}
          >
            refresh root
          </button>
          <ProjectFileTree
            activeStage="source"
            selectedMetricFilter=""
            treeDisplayMode="filter"
            onTreeDisplayModeChange={vi.fn()}
            selectedProject={buildProjectSummary()}
            projectFiles={[]}
            projectTreeNodes={projectTreeNodes}
            priorityFilePaths={[]}
            selectedFilePath=""
            expandedKeys={["original"]}
            selectedAttachPaths={[]}
            onUploadFiles={vi.fn()}
            onExpandedKeysChange={vi.fn()}
            onSelectFileFromTree={vi.fn()}
            onAttachArtifactToChat={vi.fn()}
            onLoadProjectTreeChildren={onLoadProjectTreeChildren}
          />
        </>
      );
    }

    const user = userEvent.setup();
    render(<RefreshHarness />);

    expect(await screen.findByText("guide.md")).toBeDefined();
    expect(onLoadProjectTreeChildren).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "refresh root" }));

    expect(await screen.findByText("guide.md")).toBeDefined();
    expect(onLoadProjectTreeChildren).toHaveBeenCalledTimes(1);
  });

  it("filters the tree with a file-type chip and clears it on the second click", async () => {
    const user = userEvent.setup();
    const onLoadProjectTreeChildren = vi.fn(async () => [
      buildLeafNode("original/README.md"),
      buildLeafNode("original/diagram.png"),
    ]);

    renderTree(
      [buildFile("original/README.md"), buildFile("original/diagram.png")],
      {
        expandedKeys: ["original"],
        projectTreeNodes: [buildTreeNode("original", { child_count: 2 })],
        projectFileSummary: buildFileSummary({ markdown_files: 1, other_type_files: 1 }),
        onLoadProjectTreeChildren,
      },
    );

    const markdownChip = screen.getByRole("button", { name: /Markdown/ });
    const otherTypeChip = screen.getByRole("button", { name: /其他类型/ });
    expect(markdownChip.getAttribute("aria-pressed")).toBe("false");
    expect(otherTypeChip.getAttribute("aria-pressed")).toBe("false");

    expect(await screen.findByText("README.md")).toBeDefined();
    expect(screen.getByText("diagram.png")).toBeDefined();

    await user.click(markdownChip);

    expect(markdownChip.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("README.md")).toBeDefined();
    expect(screen.queryByText("diagram.png")).toBeNull();

    await user.click(markdownChip);

    expect(markdownChip.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("diagram.png")).toBeDefined();
  });
});
