import {
  CodeOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FileMarkdownOutlined,
  FileOutlined,
  FilePdfOutlined,
  FilePptOutlined,
  FileTextOutlined,
  FileWordOutlined,
  FolderOpenOutlined,
  MinusOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { Button, Card, Empty, Segmented, Spin, Tree, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type {
  AgentProjectFileInfo,
  AgentProjectFileSummary,
  AgentProjectFileTreeNode,
  AgentProjectSummary,
} from "../../../api/types/agents";
import {
  buildProjectKnowledgeCardModels,
  computeProjectFileInventorySummary,
  getProjectKnowledgeQuantStatusLabel,
  isProjectKnowledgeFilterKey,
  matchesProjectKnowledgeFilter,
} from "./metrics";
import type { ProjectFileInventorySummary } from "./metrics";
import {
  toggleProjectFileFilter,
  type FileMetricFilterKey,
  type ProjectFileFilterKey,
} from "./filtering";
import type { ProjectStageKey } from "./projectLayoutPrefs";
import { isBuiltInProjectFile } from "./builtInFiles";
import styles from "./index.module.less";

const { Text } = Typography;

interface ProjectOverviewCardProps {
  activeStage: ProjectStageKey;
  selectedMetricFilter: ProjectFileFilterKey | "";
  onMetricFilterChange: (next: ProjectFileFilterKey | "") => void;
  treeDisplayMode: TreeDisplayMode;
  onTreeDisplayModeChange: (next: TreeDisplayMode) => void;
  treeOnly?: boolean;
  selectedProject?: AgentProjectSummary;
  projectFileCount: number;
  pipelineTemplateCount: number;
  pipelineRunCount: number;
  projectWorkspaceSummary: string;
  projectFiles: AgentProjectFileInfo[];
  projectFileSummary?: AgentProjectFileSummary | null;
  projectVisibleSummary?: ProjectFileInventorySummary;
  projectTreeNodes?: AgentProjectFileTreeNode[];
  projectTreeLoading?: boolean;
  priorityFilePaths: string[];
  selectedFilePath: string;
  selectedAttachPaths: string[];
  onUploadFiles: () => void;
  onSelectFileFromTree: (path: string) => void;
  onAttachArtifactToChat: (path: string) => void;
  onLoadProjectTreeChildren?: (path: string) => Promise<AgentProjectFileTreeNode[]>;
}

interface TreeNode {
  key: string;
  title: ReactNode;
  children?: TreeNode[];
  isLeaf?: boolean;
}

type TreeDisplayMode = "filter" | "highlight";

interface LazyTreeItem extends AgentProjectFileTreeNode {
  loaded: boolean;
  children?: LazyTreeItem[];
}

function formatUpdatedDateParts(updatedTime?: string): { day: string; month: string } {
  if (!updatedTime) {
    return { day: "-", month: "" };
  }

  const datePart = updatedTime.split("T")[0] || updatedTime;
  const parts = datePart.split("-");
  if (parts.length >= 3) {
    const month = parts[1] || "";
    const day = parts[2] || "";
    if (day) {
      return { day, month };
    }
  }

  return { day: updatedTime.slice(5, 10), month: "" };
}

function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function isOriginalInputFile(path: string): boolean {
  const normalized = normalizeProjectPath(path);
  return normalized === "original" || normalized.startsWith("original/");
}

function isPathInStandardDir(path: string, dir: "original" | "intermediate" | "output"): boolean {
  const normalized = normalizeProjectPath(path);
  return normalized === dir || normalized.startsWith(`${dir}/`);
}

function isIntermediateFile(path: string): boolean {
  const normalized = normalizeProjectPath(path);
  return (
    isPathInStandardDir(path, "intermediate")
    || normalized.startsWith("data/")
    || normalized.startsWith("metadata/")
    || normalized.startsWith("cross-book/")
    || normalized.startsWith("term-candidates/")
    || normalized.startsWith("review/")
  );
}

function isArtifactFile(path: string): boolean {
  return isPathInStandardDir(path, "output");
}

function isAgentProjectFile(path: string): boolean {
  return normalizeProjectPath(path).startsWith(".agent/");
}

function isSkillProjectFile(path: string): boolean {
  return normalizeProjectPath(path).startsWith(".skills/");
}

function isFlowProjectFile(path: string): boolean {
  const segments = normalizeProjectPath(path).split("/").filter(Boolean);
  return segments.length >= 4 && segments[0] === "pipelines" && segments[2] === "pipeline";
}

function isCaseProjectFile(path: string): boolean {
  const segments = normalizeProjectPath(path).split("/").filter(Boolean);
  return segments.length >= 4 && segments[0] === "pipelines" && segments[2] === "runs";
}

function isStandardTreeRootDir(dir: string): boolean {
  return ["original", "intermediate", "output", "pipelines", "data", "metadata"].includes(dir);
}

function getFileNodeIcon(fileName: string, isDirectory: boolean): ReactNode {
  if (isDirectory) {
    return <FolderOpenOutlined className={styles.treeNodeIconFolder} />;
  }

  const normalized = fileName.toLowerCase();
  const extension = normalized.includes(".") ? normalized.split(".").pop() || "" : "";

  if (["md", "mdx"].includes(extension)) {
    return <FileMarkdownOutlined className={styles.treeNodeIconFile} />;
  }
  if (["txt", "rtf", "csv"].includes(extension)) {
    return <FileTextOutlined className={styles.treeNodeIconFile} />;
  }
  if (["pdf"].includes(extension)) {
    return <FilePdfOutlined className={styles.treeNodeIconFile} />;
  }
  if (["doc", "docx"].includes(extension)) {
    return <FileWordOutlined className={styles.treeNodeIconFile} />;
  }
  if (["xls", "xlsx"].includes(extension)) {
    return <FileExcelOutlined className={styles.treeNodeIconFile} />;
  }
  if (["ppt", "pptx"].includes(extension)) {
    return <FilePptOutlined className={styles.treeNodeIconFile} />;
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) {
    return <FileImageOutlined className={styles.treeNodeIconFile} />;
  }
  if (["json", "yaml", "yml", "xml", "html", "htm", "css", "less", "scss", "js", "jsx", "ts", "tsx", "py", "sh"].includes(extension)) {
    return <CodeOutlined className={styles.treeNodeIconFile} />;
  }

  return <FileOutlined className={styles.treeNodeIconFile} />;
}

function renderNodeIcon(fileName: string, isDirectory: boolean, isPriority: boolean): ReactNode {
  const icon = getFileNodeIcon(fileName, isDirectory);
  if (isDirectory) {
    return icon;
  }

  return (
    <span className={isPriority ? styles.priorityFileIcon : styles.treeNodeIconWrap}>
      {icon}
    </span>
  );
}

function buildFileTree(
  paths: string[],
  priorityFileSet: Set<string>,
  selectedAttachSet: Set<string>,
  highlightedFileSet: Set<string>,
  onAttachArtifactToChat: (path: string) => void,
  attachTitle: string,
  detachTitle: string,
): TreeNode[] {
  type RawNode = {
    key: string;
    title: string;
    children: Record<string, RawNode>;
  };

  const root: Record<string, RawNode> = {};
  const collapseStandardRoot =
    paths.length > 0
    && (() => {
      const firstParts = paths
        .map((path) => path.split("/").filter(Boolean))
        .filter((parts) => parts.length > 1)
        .map((parts) => parts[0]);
      if (firstParts.length !== paths.length) {
        return false;
      }
      const rootDir = firstParts[0];
      return firstParts.every((part) => part === rootDir) && isStandardTreeRootDir(rootDir);
    })();

  for (const path of paths) {
    const originalParts = path.split("/").filter(Boolean);
    const displayParts = collapseStandardRoot ? originalParts.slice(1) : originalParts;
    let current = root;
    let originalPrefix = collapseStandardRoot ? originalParts[0] : "";
    for (let index = 0; index < displayParts.length; index += 1) {
      const part = displayParts[index];
      const originalPart = originalParts[collapseStandardRoot ? index + 1 : index];
      originalPrefix = originalPrefix ? `${originalPrefix}/${originalPart}` : originalPart;
      if (!current[part]) {
        current[part] = { key: originalPrefix, title: part, children: {} };
      }
      current = current[part].children;
    }
  }

  const toTreeNodes = (record: Record<string, RawNode>): TreeNode[] =>
    Object.values(record)
      .sort((a, b) => {
        const aHasChildren = Object.keys(a.children).length > 0;
        const bHasChildren = Object.keys(b.children).length > 0;
        if (aHasChildren !== bHasChildren) {
          return aHasChildren ? -1 : 1;
        }
        return a.title.localeCompare(b.title);
      })
      .map((node) => {
        const children = toTreeNodes(node.children);
        const isDirectory = children.length > 0;
        const isPriority = !isDirectory && priorityFileSet.has(node.key);
        const isAttached = !isDirectory && selectedAttachSet.has(node.key);
        const isHighlighted = !isDirectory && highlightedFileSet.has(node.key);
        return {
          key: node.key,
          title: (
            <span className={styles.treeNodeRow}>
              <span
                className={
                  isDirectory ? styles.compactTreeFolderLabel : styles.compactTreeLeafLabel
                }
              >
                {renderNodeIcon(node.title, isDirectory, isPriority)}
                <span
                  className={isHighlighted
                    ? `${styles.treeNodeText} ${styles.treeNodeTextHighlighted}`
                    : styles.treeNodeText}
                >
                  {node.title}
                </span>
              </span>
              {!isDirectory ? (
                <span className={styles.treeNodeActions}>
                  <Button
                    size="small"
                    type="text"
                    icon={isAttached ? <MinusOutlined /> : <PlusOutlined />}
                    className={styles.attachActionButton}
                    title={isAttached ? detachTitle : attachTitle}
                    aria-label={isAttached ? detachTitle : attachTitle}
                    onClick={(event) => {
                      event.stopPropagation();
                      onAttachArtifactToChat(node.key);
                    }}
                  />
                </span>
              ) : null}
            </span>
          ),
          isLeaf: !isDirectory,
          children: isDirectory ? children : undefined,
        };
      });

  return toTreeNodes(root);
}

function collectDirectoryKeys(nodes: TreeNode[]): string[] {
  const keys: string[] = [];
  const walk = (items: TreeNode[]) => {
    for (const item of items) {
      if (item.children && item.children.length > 0) {
        keys.push(item.key);
        walk(item.children);
      }
    }
  };
  walk(nodes);
  return keys;
}

function toLazyTreeItems(nodes: AgentProjectFileTreeNode[]): LazyTreeItem[] {
  return nodes.map((item) => ({
    ...item,
    loaded: !item.is_directory || item.child_count <= 0,
    children: undefined,
  }));
}

function updateLazyTreeChildren(
  items: LazyTreeItem[],
  targetPath: string,
  children: LazyTreeItem[],
): LazyTreeItem[] {
  return items.map((item) => {
    if (item.path === targetPath) {
      return {
        ...item,
        loaded: true,
        children,
      };
    }
    if (!item.children || item.children.length === 0) {
      return item;
    }
    return {
      ...item,
      children: updateLazyTreeChildren(item.children, targetPath, children),
    };
  });
}

function findLazyTreeItem(
  items: LazyTreeItem[],
  targetPath: string,
): LazyTreeItem | null {
  for (const item of items) {
    if (item.path === targetPath) {
      return item;
    }
    if (item.children && item.children.length > 0) {
      const nested = findLazyTreeItem(item.children, targetPath);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function buildLazyTreeNodes(
  items: LazyTreeItem[],
  priorityFileSet: Set<string>,
  selectedAttachSet: Set<string>,
  highlightedFileSet: Set<string>,
  onAttachArtifactToChat: (path: string) => void,
  attachTitle: string,
  detachTitle: string,
): TreeNode[] {
  return items.map((item) => {
    const isPriority = !item.is_directory && priorityFileSet.has(item.path);
    const isAttached = !item.is_directory && selectedAttachSet.has(item.path);
    const isHighlighted = !item.is_directory && highlightedFileSet.has(item.path);
    const directoryCountLabel = item.is_directory && item.descendant_file_count > 0
      ? String(item.descendant_file_count)
      : "";
    const childNodes = item.children
      ? buildLazyTreeNodes(
          item.children,
          priorityFileSet,
          selectedAttachSet,
          highlightedFileSet,
          onAttachArtifactToChat,
          attachTitle,
          detachTitle,
        )
      : undefined;

    return {
      key: item.path,
      title: (
        <span className={styles.treeNodeRow}>
          <span
            className={
              item.is_directory ? styles.compactTreeFolderLabel : styles.compactTreeLeafLabel
            }
          >
            {renderNodeIcon(item.filename, item.is_directory, isPriority)}
            <span
              className={isHighlighted
                ? `${styles.treeNodeText} ${styles.treeNodeTextHighlighted}`
                : styles.treeNodeText}
            >
              {item.filename}
            </span>
            {directoryCountLabel ? (
              <span className={styles.treeNodeMetaCount}>{directoryCountLabel}</span>
            ) : null}
          </span>
          {!item.is_directory ? (
            <span className={styles.treeNodeActions}>
              <Button
                size="small"
                type="text"
                icon={isAttached ? <MinusOutlined /> : <PlusOutlined />}
                className={styles.attachActionButton}
                title={isAttached ? detachTitle : attachTitle}
                aria-label={isAttached ? detachTitle : attachTitle}
                onClick={(event) => {
                  event.stopPropagation();
                  onAttachArtifactToChat(item.path);
                }}
              />
            </span>
          ) : null}
        </span>
      ),
      isLeaf: !item.is_directory,
      children: childNodes,
    };
  });
}

function getProjectTreeRootDirectoryFileCount(
  nodes: AgentProjectFileTreeNode[] | undefined,
  dirName: string,
): number | null {
  const normalizedDirName = normalizeProjectPath(dirName);
  const matched = (nodes || []).find(
    (item) => item.is_directory && normalizeProjectPath(item.path) === normalizedDirName,
  );
  if (!matched) {
    return null;
  }
  return matched.descendant_file_count;
}

export default function ProjectOverviewCard({
  activeStage,
  selectedMetricFilter,
  onMetricFilterChange,
  treeDisplayMode,
  onTreeDisplayModeChange,
  treeOnly = false,
  selectedProject,
  projectFileCount: _projectFileCount,
  pipelineTemplateCount: _pipelineTemplateCount,
  pipelineRunCount,
  projectWorkspaceSummary,
  projectFiles,
  projectFileSummary,
  projectVisibleSummary,
  projectTreeNodes,
  projectTreeLoading = false,
  priorityFilePaths,
  selectedFilePath,
  selectedAttachPaths,
  onUploadFiles,
  onSelectFileFromTree,
  onAttachArtifactToChat,
  onLoadProjectTreeChildren,
}: ProjectOverviewCardProps) {
  void _projectFileCount;
  void _pipelineTemplateCount;
  const { t } = useTranslation();
  const [workspaceSummaryExpanded, setWorkspaceSummaryExpanded] = useState(false);
  const [treeTransitioning, setTreeTransitioning] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [lazyTreeItems, setLazyTreeItems] = useState<LazyTreeItem[]>([]);
  const treeExpandedInitializedRef = useRef(false);
  const updatedDateParts = formatUpdatedDateParts(selectedProject?.updated_time);

  const builtInFiles = useMemo(
    () => projectFiles.filter((item) => isBuiltInProjectFile(item.path)),
    [projectFiles],
  );
  const nonBuiltInFiles = useMemo(
    () => projectFiles.filter((item) => !isBuiltInProjectFile(item.path)),
    [projectFiles],
  );
  const stageScopedFiles =
    activeStage === "builtin" || selectedMetricFilter === "builtin"
      ? builtInFiles
      : nonBuiltInFiles;
  const attachTitle = t("projects.chat.addAttachment", "Add to chat attachments");
  const detachTitle = t("projects.chat.removeAttachment", "Remove from chat attachments");
  const priorityFileSet = useMemo(() => new Set(priorityFilePaths), [priorityFilePaths]);
  const selectedAttachSet = useMemo(() => new Set(selectedAttachPaths), [selectedAttachPaths]);
  const treeRootDirCounts = useMemo(
    () => ({
      original: getProjectTreeRootDirectoryFileCount(projectTreeNodes, "original"),
      intermediate: getProjectTreeRootDirectoryFileCount(projectTreeNodes, "intermediate"),
      output: getProjectTreeRootDirectoryFileCount(projectTreeNodes, "output"),
      pipelines: getProjectTreeRootDirectoryFileCount(projectTreeNodes, "pipelines"),
    }),
    [projectTreeNodes],
  );
  const nonBuiltInSummary = useMemo(
    () => projectVisibleSummary ?? computeProjectFileInventorySummary(nonBuiltInFiles),
    [nonBuiltInFiles, projectVisibleSummary],
  );
  const filteredFiles = stageScopedFiles.filter((item) => {
    const normalizedPath = normalizeProjectPath(item.path);
    switch (selectedMetricFilter) {
      case "original":
        return isOriginalInputFile(normalizedPath);
      case "intermediate":
        return isIntermediateFile(normalizedPath);
      case "artifact":
        return isArtifactFile(normalizedPath);
      case "agent":
        return isAgentProjectFile(normalizedPath);
      case "skill":
        return isSkillProjectFile(normalizedPath);
      case "flow":
        return isFlowProjectFile(normalizedPath);
      case "case":
        return isCaseProjectFile(normalizedPath);
      case "builtin":
        return isBuiltInProjectFile(item.path);
      case "markdown":
        return matchesProjectKnowledgeFilter("markdown", item);
      case "text":
        return matchesProjectKnowledgeFilter("text", item);
      case "script":
        return matchesProjectKnowledgeFilter("script", item);
      case "otherType":
        return matchesProjectKnowledgeFilter("otherType", item);
      default:
        return true;
    }
  });
  const filteredFilePaths = filteredFiles.map((item) => item.path);
  const highlightedFilePaths = useMemo(
    () => (selectedMetricFilter ? filteredFilePaths : []),
    [filteredFilePaths, selectedMetricFilter],
  );
  const treeFiles = treeDisplayMode === "highlight"
    ? (selectedMetricFilter === "builtin" ? projectFiles : stageScopedFiles)
    : filteredFiles;
  const treeFilePaths = treeFiles.map((item) => item.path);
  const highlightedFileSet = useMemo(
    () => new Set(treeDisplayMode === "highlight" ? highlightedFilePaths : []),
    [highlightedFilePaths, treeDisplayMode],
  );
  const projectKnowledgeMetrics = nonBuiltInSummary.knowledgeMetrics;
  const effectiveKnowledgeMetrics = useMemo(
    () => ({
      ...projectKnowledgeMetrics,
      totalFiles: projectFileSummary?.visible_files ?? projectKnowledgeMetrics.totalFiles,
      markdownFiles: projectFileSummary?.markdown_files ?? projectKnowledgeMetrics.markdownFiles,
      textFiles: projectFileSummary?.text_files ?? projectKnowledgeMetrics.textFiles,
      scriptFiles: projectFileSummary?.script_files ?? projectKnowledgeMetrics.scriptFiles,
      otherTypeFiles: projectFileSummary?.other_type_files ?? projectKnowledgeMetrics.otherTypeFiles,
      recentlyUpdatedFiles:
        projectFileSummary?.recently_updated_files ?? projectKnowledgeMetrics.recentlyUpdatedFiles,
    }),
    [
      projectFileSummary?.markdown_files,
      projectFileSummary?.other_type_files,
      projectFileSummary?.recently_updated_files,
      projectFileSummary?.script_files,
      projectFileSummary?.text_files,
      projectFileSummary?.visible_files,
      projectKnowledgeMetrics,
    ],
  );
  const treeData = buildFileTree(
    treeFilePaths,
    priorityFileSet,
    selectedAttachSet,
    highlightedFileSet,
    onAttachArtifactToChat,
    attachTitle,
    detachTitle,
  );
  const hasActiveFilter = Boolean(selectedMetricFilter);
  const knowledgeFilterActive = Boolean(
    selectedMetricFilter && isProjectKnowledgeFilterKey(selectedMetricFilter),
  );
  const useLazyTreeMode = Boolean(
    treeOnly
    && treeDisplayMode === "filter"
    && (!selectedMetricFilter
      || ["original", "intermediate", "artifact", "agent", "skill", "flow", "case", "builtin"].includes(selectedMetricFilter)),
  );

  useEffect(() => {
    if (!treeOnly) {
      return;
    }
    setLazyTreeItems(toLazyTreeItems(projectTreeNodes || []));
  }, [projectTreeNodes, treeOnly]);

  const visibleLazyTreeItems = useMemo(() => {
    if (!useLazyTreeMode) {
      return [] as LazyTreeItem[];
    }
    if (!selectedMetricFilter) {
      return lazyTreeItems;
    }
    return lazyTreeItems.filter((item) => {
      const normalizedPath = normalizeProjectPath(item.path);
      switch (selectedMetricFilter) {
        case "original":
          return normalizedPath === "original" || normalizedPath.startsWith("original/");
        case "intermediate":
          return normalizedPath === "intermediate" || normalizedPath.startsWith("intermediate/");
        case "artifact":
          return normalizedPath === "output" || normalizedPath.startsWith("output/");
        case "agent":
          return normalizedPath === ".agent" || normalizedPath.startsWith(".agent/");
        case "skill":
          return normalizedPath === ".skills" || normalizedPath.startsWith(".skills/");
        case "flow":
          return normalizedPath === "pipelines" || normalizedPath.startsWith("pipelines/");
        case "case":
          return normalizedPath === "pipelines" || normalizedPath.startsWith("pipelines/");
        case "builtin":
          return isBuiltInProjectFile(item.path);
        default:
          return true;
      }
    });
  }, [lazyTreeItems, selectedMetricFilter, useLazyTreeMode]);

  const lazyTreeData = useMemo(
    () => buildLazyTreeNodes(
      visibleLazyTreeItems,
      priorityFileSet,
      selectedAttachSet,
      highlightedFileSet,
      onAttachArtifactToChat,
      attachTitle,
      detachTitle,
    ),
    [
      attachTitle,
      detachTitle,
      highlightedFileSet,
      onAttachArtifactToChat,
      priorityFileSet,
      selectedAttachSet,
      visibleLazyTreeItems,
    ],
  );

  useEffect(() => {
    treeExpandedInitializedRef.current = false;
    setExpandedKeys([]);
  }, [selectedProject?.id, useLazyTreeMode]);

  useEffect(() => {
    if (treeExpandedInitializedRef.current) {
      return;
    }
    const nextTreeData = useLazyTreeMode ? lazyTreeData : treeData;
    if (nextTreeData.length === 0) {
      return;
    }
    if (useLazyTreeMode) {
      setExpandedKeys(
        nextTreeData.length === 1 && !nextTreeData[0].isLeaf
          ? [String(nextTreeData[0].key)]
          : [],
      );
    } else {
      setExpandedKeys(collectDirectoryKeys(nextTreeData));
    }
    treeExpandedInitializedRef.current = true;
  }, [lazyTreeData, treeData, useLazyTreeMode]);

  useEffect(() => {
    if (treeDisplayMode !== "filter") {
      return;
    }
    if (!selectedMetricFilter) {
      return;
    }
    if (filteredFilePaths.length === 0) {
      return;
    }
    if (!selectedFilePath || !filteredFilePaths.includes(selectedFilePath)) {
      onSelectFileFromTree(filteredFilePaths[0]);
    }
  }, [filteredFilePaths, onSelectFileFromTree, selectedFilePath, selectedMetricFilter, treeDisplayMode]);

  useEffect(() => {
    setTreeTransitioning(true);
    const timer = window.setTimeout(() => {
      setTreeTransitioning(false);
    }, 220);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeStage, selectedMetricFilter]);

  const metricCards: Array<{ key: FileMetricFilterKey; label: string; value: number }> = [
    {
      key: "original",
      label: t("projects.filesOriginal", "Original Files"),
      value: projectFileSummary?.original_files ?? treeRootDirCounts.original ?? nonBuiltInSummary.originalFiles,
    },
    {
      key: "intermediate",
      label: t("projects.filesIntermediate", "Intermediate Files"),
      value: projectFileSummary?.intermediate_files ?? treeRootDirCounts.intermediate ?? nonBuiltInSummary.intermediateFiles,
    },
    {
      key: "artifact",
      label: t("projects.filesArtifact", "Artifact Files"),
      value: projectFileSummary?.artifact_files ?? treeRootDirCounts.output ?? nonBuiltInSummary.artifactFiles,
    },
    {
      key: "agent",
      label: t("projects.filesAgent", "智能体"),
      value: projectFileSummary?.agent_files ?? projectFiles.filter((item) => isAgentProjectFile(item.path)).length,
    },
    {
      key: "skill",
      label: t("projects.filesSkill", "技能"),
      value: projectFileSummary?.skill_files ?? projectFiles.filter((item) => isSkillProjectFile(item.path)).length,
    },
    {
      key: "flow",
      label: t("projects.filesFlow", "流程"),
      value: projectFileSummary?.flow_files ?? projectFiles.filter((item) => isFlowProjectFile(item.path)).length,
    },
    {
      key: "case",
      label: t("projects.filesCase", "案例"),
      value: projectFileSummary?.case_files ?? projectFiles.filter((item) => isCaseProjectFile(item.path)).length,
    },
  ];

  const knowledgeMetricCards = buildProjectKnowledgeCardModels(effectiveKnowledgeMetrics).map((item) => ({
    ...item,
    label: t(item.labelI18nKey, item.defaultLabel),
  }));

  if (treeOnly) {
    const stageTitle =
      activeStage === "knowledge"
        ? t("projects.stage.fileTypes", "文件类型")
        : activeStage === "output"
          ? t("projects.stage.projectFiles", "项目文件")
          : activeStage === "builtin"
            ? t("projects.stage.builtin", "Built-in")
            : t("projects.stage.source", "Source");

    return (
      <Card
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        }}
        title={<span className={styles.sectionTitle}>{t("projects.workspaceSummaryFiles", "Workspace Files")}</span>}
        styles={{
          body: {
            padding: 12,
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
          },
        }}
        extra={<Text type="secondary" className={styles.panelExtraText}>{stageTitle}</Text>}
      >
        <div className={`${styles.scrollContainer} ${styles.treeOnlyScrollContainer}`}>
          <div className={styles.treeUploadRow}>
            <Button type="primary" className={styles.treeUploadButton} onClick={onUploadFiles}>
              {t("projects.upload.button", "Upload Files")}
            </Button>
          </div>
          <div className={`${styles.overviewTreeToolbar} ${styles.treeToolbarSticky}`}>
            <div className={styles.treeToolbarLeft} />
            <div className={styles.treeToolbarRight}>
              <Segmented
                size="small"
                className={styles.treeModeSegment}
                value={treeDisplayMode}
                onChange={(value) => onTreeDisplayModeChange(value as TreeDisplayMode)}
                options={[
                  { label: t("projects.treeViewMode.filter", "Filter"), value: "filter" },
                  { label: t("projects.treeViewMode.highlight", "Highlight"), value: "highlight" },
                ]}
              />
            </div>
          </div>
          <div
            className={`${styles.treeTransitionShell} ${styles.treeTransitionShellFullHeight} ${treeTransitioning ? styles.treeTransitionEnter : ""}`}
          >
            {useLazyTreeMode && projectTreeLoading && lazyTreeData.length === 0 ? (
              <div className={styles.centerState}>
                <Spin />
              </div>
            ) : (useLazyTreeMode ? lazyTreeData : treeData).length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  hasActiveFilter
                    ? t("projects.noFilteredFiles", "No related files under the current filter")
                    : t("projects.noFiles", "No files in this project")
                }
              />
            ) : (
              <Tree
                className={`${styles.overviewCompactTree} ${styles.overviewCompactTreeFullHeight}`}
                selectedKeys={selectedFilePath ? [selectedFilePath] : []}
                treeData={useLazyTreeMode ? lazyTreeData : treeData}
                expandedKeys={expandedKeys}
                onExpand={(keys) => setExpandedKeys(keys as string[])}
                loadData={useLazyTreeMode && onLoadProjectTreeChildren
                  ? async (treeNode) => {
                    const key = String(treeNode.key || "");
                    const currentNode = findLazyTreeItem(lazyTreeItems, key);
                    if (!currentNode || !currentNode.is_directory || currentNode.loaded) {
                      return;
                    }
                    const children = await onLoadProjectTreeChildren(key);
                    setLazyTreeItems((prev) => updateLazyTreeChildren(prev, key, toLazyTreeItems(children)));
                  }
                  : undefined}
                onSelect={(keys) => {
                  const key = String(keys[0] || "");
                  const selectedLazyNode = useLazyTreeMode
                    ? findLazyTreeItem(lazyTreeItems, key)
                    : null;
                  if (key && (!selectedLazyNode || !selectedLazyNode.is_directory)) {
                    onSelectFileFromTree(key);
                  }
                }}
              />
            )}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title={<span className={styles.sectionTitle}>{t("projects.overview", "Overview")}</span>}
      styles={{ body: { padding: 12 } }}
      extra={
        <Text type="secondary" className={styles.panelExtraText}>
          {selectedProject?.status || t("projects.statusActive", "active")}
        </Text>
      }
    >
      <div className={styles.scrollContainer}>
        <div className={styles.overviewSection}>
          <div className={styles.subSectionTitle}>{t("projects.summary", "Project Summary")}</div>
          <div className={styles.projectSummaryHeader}>
            <div className={styles.projectSummaryName}>
              {selectedProject?.name || selectedProject?.id || "-"}
            </div>
            <Button
              size="small"
              type="text"
              onClick={() => setWorkspaceSummaryExpanded((prev) => !prev)}
            >
              {workspaceSummaryExpanded
                ? t("projects.workspaceSummaryCollapse", "Collapse workspace snapshot")
                : t("projects.workspaceSummaryExpand", "Expand workspace snapshot")}
            </Button>
          </div>
          <div className={styles.overviewDescription}>
            {selectedProject?.description || t("projects.noDescription", "No description")}
          </div>
          {workspaceSummaryExpanded ? (
            <pre className={styles.overviewSummary}>{projectWorkspaceSummary}</pre>
          ) : null}
        </div>

        {(selectedProject?.tags || []).length > 0 ? (
          <div className={styles.overviewSection}>
            <div className={styles.subSectionTitle}>{t("projects.tags", "Tags")}</div>
            <div className={styles.overviewTags}>
              {selectedProject?.tags.map((tag) => (
                <div key={tag} className={styles.metricSummaryCard}>
                  <div className={styles.metricSummaryTextValue}>{tag}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className={styles.overviewSection}>
          <div className={styles.quantPanelHeader}>
            <div>
              <div className={styles.subSectionTitle}>{t("projects.knowledgePanelTitle", "Knowledge Quant Panel")}</div>
              <Text type="secondary" className={styles.itemMeta}>
                {t("projects.knowledgePanelHint", "Quickly observe project knowledge density and freshness")}
              </Text>
            </div>
            {knowledgeFilterActive ? (
              <Button
                size="small"
                type="text"
                onClick={() => onMetricFilterChange("")}
              >
                {t("common.reset", "Reset")}
              </Button>
            ) : null}
          </div>
          <div className={styles.metricSummaryGrid}>
            {knowledgeMetricCards.map((item) => {
              const filterKey = item.filterKey;
              const active = filterKey ? selectedMetricFilter === filterKey : false;
              const statusLabel = getProjectKnowledgeQuantStatusLabel(item.assessment.status);
              const className = `${styles.metricSummaryCard} ${item.assessment.tone === "positive" ? styles.metricSummaryCardPositive : item.assessment.tone === "warning" ? styles.metricSummaryCardWarning : styles.metricSummaryCardNeutral} ${item.filterKey ? styles.metricFilterCard : ""} ${active ? styles.metricFilterCardActive : ""}`;

              if (filterKey) {
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={className}
                    onClick={() => onMetricFilterChange(toggleProjectFileFilter(selectedMetricFilter, filterKey))}
                    aria-pressed={active}
                  >
                    <div className={styles.itemMeta}>{item.label}</div>
                    <div className={styles.metricSummaryValue}>{item.value}</div>
                    <div className={styles.metricSummaryNote}>
                      {t(statusLabel.i18nKey, statusLabel.defaultLabel)}
                    </div>
                    <div className={styles.metricSummaryReason}>
                      {t(`projects.quantReason.${item.reason.key}`, item.reason.params || {})}
                    </div>
                  </button>
                );
              }

              return (
                <div key={item.key} className={className}>
                  <div className={styles.itemMeta}>{item.label}</div>
                  <div className={styles.metricSummaryValue}>{item.value}</div>
                  <div className={styles.metricSummaryNote}>
                    {t(statusLabel.i18nKey, statusLabel.defaultLabel)}
                  </div>
                  <div className={styles.metricSummaryReason}>
                    {t(`projects.quantReason.${item.reason.key}`, item.reason.params || {})}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className={styles.overviewSection}>
          <div className={styles.subSectionTitle}>
            {t("projects.progressMaturity", "Project Progress & Maturity")}
          </div>
          <div className={styles.metricSummaryGrid}>
            {metricCards.map((item) => {
              const active = selectedMetricFilter === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`${styles.metricSummaryCard} ${styles.metricFilterCard} ${active ? styles.metricFilterCardActive : ""}`}
                  onClick={() => {
                    onMetricFilterChange(toggleProjectFileFilter(selectedMetricFilter, item.key));
                  }}
                  aria-pressed={active}
                >
                  <div className={styles.itemMeta}>{item.label}</div>
                  <div className={styles.metricSummaryValue}>{item.value}</div>
                </button>
              );
            })}
            <div className={styles.metricSummaryCard}>
              <div className={styles.itemMeta}>{t("projects.runs", "Runs")}</div>
              <div className={styles.metricSummaryValue}>{pipelineRunCount}</div>
            </div>
            <div className={styles.metricSummaryCard}>
              <div className={styles.itemMeta}>{t("projects.updated", "Updated")}</div>
              <div className={styles.metricSummaryValue}>
                <span>{updatedDateParts.day}</span>
                {updatedDateParts.month ? (
                  <span className={styles.metricSummaryDateSuffix}>/{updatedDateParts.month}</span>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className={styles.overviewSection}>
          <div className={styles.subSectionTitle}>{t("projects.workspaceSummaryFiles", "Workspace Files")}</div>
          <div className={styles.treeUploadRow}>
            <Button type="primary" className={styles.treeUploadButton} onClick={onUploadFiles}>
              {t("projects.upload.button", "Upload Files")}
            </Button>
          </div>
          <div className={styles.overviewTreeToolbar}>
            <div className={styles.treeToolbarLeft} />
            <div className={styles.treeToolbarRight}>
              <Segmented
                size="small"
                className={styles.treeModeSegment}
                value={treeDisplayMode}
                onChange={(value) => onTreeDisplayModeChange(value as TreeDisplayMode)}
                options={[
                  { label: t("projects.treeViewMode.filter", "Filter"), value: "filter" },
                  { label: t("projects.treeViewMode.highlight", "Highlight"), value: "highlight" },
                ]}
              />
            </div>
          </div>
          <div
            className={`${styles.treeTransitionShell} ${treeTransitioning ? styles.treeTransitionEnter : ""}`}
          >
            {treeData.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  hasActiveFilter
                    ? t("projects.noFilteredFiles", "No related files under the current filter")
                    : t("projects.noFiles", "No files in this project")
                }
              />
            ) : (
              <Tree
                className={styles.overviewCompactTree}
                selectedKeys={selectedFilePath && treeFilePaths.includes(selectedFilePath) ? [selectedFilePath] : []}
                treeData={treeData}
                expandedKeys={expandedKeys}
                onExpand={(keys) => setExpandedKeys(keys as string[])}
                onSelect={(keys) => {
                  const key = String(keys[0] || "");
                  if (key) {
                    onSelectFileFromTree(key);
                  }
                }}
              />
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}