import {
  CodeOutlined,
  DeleteOutlined,
  EditOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FileMarkdownOutlined,
  FileOutlined,
  FilePdfOutlined,
  FilePptOutlined,
  FileTextOutlined,
  FileWordOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Button, Empty, Input, Segmented, Spin, Tooltip, Tree, Typography } from "antd";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { Key, MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  useContextMenu,
  type ContextMenuItem,
} from "../../../../components/ContextMenu";
import type {
  AgentProjectFileInfo,
  AgentProjectFileSummary,
  AgentProjectFileTreeNode,
  AgentProjectSummary,
} from "../../../../api/types/agents";
import { matchesProjectKnowledgeFilter } from "../utils/metrics";
import {
  getProjectFilterLabelDescriptor,
  toggleProjectFileFilter,
} from "../utils/filtering";
import type { ProjectFileFilterKey } from "../utils/filtering";
import type { TreeDisplayMode } from "../utils/projectLayoutPrefs";
import { isBuiltInProjectDirectory, isBuiltInProjectFile } from "../utils/builtInFiles";
import {
  isStandardTreeRootDir,
  matchesProjectPathQuery,
  normalizeProjectPath,
  normalizeTreeKeys,
  compareTreePathDepth,
  collectDirectoryKeys,
  resolveRangePaths,
  resolveProjectFileStage,
  isAgentProjectFile,
} from "../utils/projectFileTreeUtils";
import styles from "./ProjectFileTree.module.less";

const { Text } = Typography;
const LAZY_TREE_AUTO_LOAD_BATCH_SIZE = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TreeNode {
  key: string;
  title: ReactNode;
  children?: TreeNode[];
  isLeaf?: boolean;
}

interface LazyTreeItem extends AgentProjectFileTreeNode {
  loaded: boolean;
  builtin?: boolean;
  children?: LazyTreeItem[];
}

type SummaryCountField = {
  [K in keyof AgentProjectFileSummary]-?: NonNullable<AgentProjectFileSummary[K]> extends number ? K : never;
}[keyof AgentProjectFileSummary];

const METRIC_FILTER_CHIPS: Array<{ key: ProjectFileFilterKey; field: SummaryCountField }> = [
  { key: "original", field: "original_files" },
  { key: "intermediate", field: "intermediate_files" },
  { key: "artifact", field: "artifact_files" },
  { key: "agent", field: "agent_files" },
  { key: "skill", field: "skill_files" },
  { key: "flow", field: "flow_files" },
  { key: "case", field: "case_files" },
  { key: "builtin", field: "builtin_files" },
  { key: "markdown", field: "markdown_files" },
  { key: "text", field: "text_files" },
  { key: "script", field: "script_files" },
  { key: "otherType", field: "other_type_files" },
];

export interface ProjectFileTreeProps {
  selectedProject?: AgentProjectSummary;
  /** All project files (used for filtering/builtin detection) */
  projectFiles: AgentProjectFileInfo[];
  /** Pre-computed file summary (drives the file-type filter chips) */
  projectFileSummary?: AgentProjectFileSummary | null;
  /** Project tree nodes (lazy-loaded root level) */
  projectTreeNodes?: AgentProjectFileTreeNode[];
  projectTreeLoading?: boolean;
  /** Priority files to highlight */
  priorityFilePaths: string[];
  /** Currently selected file path */
  selectedFilePath: string;
  /** Expanded directory keys */
  expandedKeys?: string[];
  /** Directories that need refresh */
  staleDirectoryPaths?: string[];
  /** Paths attached to chat */
  selectedAttachPaths: string[];
  /** Tree filter keyword */
  treeFilterQuery?: string;
  /** Current metric filter */
  selectedMetricFilter: ProjectFileFilterKey | "";
  /** Change the metric filter (enables the file-type filter chips) */
  onMetricFilterChange?: (next: ProjectFileFilterKey | "") => void;
  activeStage?: string;
  treeDisplayMode: TreeDisplayMode;
  /** Files that are currently being deleted */
  deletingTreePaths?: string[];
  /** Whether files are currently refreshing */
  projectFilesRefreshing?: boolean;
  /** Latest updated file path (for quick navigation) */
  latestUpdatedFilePath?: string;

  onTreeFilterQueryChange?: (value: string) => void;
  onExpandedKeysChange?: (keys: string[]) => void;
  onConsumeStaleDirectoryPaths?: (paths: string[]) => void;
  onSelectFileFromTree: (path: string) => void;
  onSelectLatestUpdatedFile?: (path: string) => void;
  onAttachArtifactToChat: (path: string) => void;
  onRequestMoveTreePath?: (sourcePath: string, sourceIsDirectory: boolean, targetDirPath: string) => void;
  onRequestRenameTreePath?: (path: string, isDirectory: boolean) => void;
  onRequestCreateChildDirectory?: (parentPath: string) => void;
  onRequestDeleteTreePath?: (path: string, isDirectory: boolean) => void;
  onRequestDeleteSelectedFilePaths?: (paths: string[]) => void;
  onRequestMoveSelectedFilePaths?: (paths: string[]) => void;
  onRequestSetSelectedFilePaths?: (paths: string[]) => void;
  onRefreshProjectFiles?: () => Promise<void> | void;
  onRefreshProjectTreeDirectory?: (path: string) => Promise<AgentProjectFileTreeNode[]>;
  onLoadProjectTreeChildren?: (path: string) => Promise<AgentProjectFileTreeNode[]>;
  onUploadFiles: () => void;
  onTreeDisplayModeChange: (next: TreeDisplayMode) => void;
}

// ---------------------------------------------------------------------------
// File icon helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tree builders (flat path list → Ant Design Tree nodes)
// ---------------------------------------------------------------------------

function buildFileTree(
  paths: string[],
  priorityFileSet: Set<string>,
  selectedAttachSet: Set<string>,
  highlightedFileSet: Set<string>,
  onAttachArtifactToChat: (path: string) => void,
  onRequestRenameTreePath: ((path: string, isDirectory: boolean) => void) | undefined,
  onRequestCreateChildDirectory: ((parentPath: string) => void) | undefined,
  onRequestDeleteTreePath: ((path: string, isDirectory: boolean) => void) | undefined,
  onOpenNodeContextMenu: ((event: MouseEvent, path: string, isDirectory: boolean, isAttached: boolean) => void) | undefined,
  deletingTreePathSet: Set<string>,
  attachTitle: string,
  detachTitle: string,
  renameTitle: string,
  createFolderTitle: string,
  deleteTitle: string,
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
        const isDeleting = deletingTreePathSet.has(node.key);
        return {
          key: node.key,
          title: (
            <span
              className={styles.treeNodeRow}
              onContextMenu={(event) => onOpenNodeContextMenu?.(event, node.key, isDirectory, isAttached)}
            >
              <span
                className={
                  isDirectory ? styles.compactTreeFolderLabel : styles.compactTreeLeafLabel
                }
              >
                {renderNodeIcon(node.title, isDirectory, isPriority)}
                <span
                  className={[
                    styles.treeNodeText,
                    isHighlighted ? styles.treeNodeTextHighlighted : "",
                    isAttached ? styles.treeNodeTextAttached : "",
                  ].filter(Boolean).join(" ")}
                >
                  {node.title}
                </span>
                {!isDirectory && isAttached ? (
                  <span className={styles.treeNodeAttachedMark}>✓</span>
                ) : null}
              </span>
              {!isDirectory ? (
                <span className={styles.treeNodeActions}>
                  <Button size="small" type="text" icon={isAttached ? <MinusOutlined /> : <PlusOutlined />} className={styles.attachActionButton} title={isAttached ? detachTitle : attachTitle} aria-label={isAttached ? detachTitle : attachTitle} onClick={(event) => { event.stopPropagation(); onAttachArtifactToChat(node.key); }} />
                  <Button size="small" type="text" icon={<EditOutlined />} className={styles.attachActionButton} title={renameTitle} aria-label={renameTitle} disabled={!onRequestRenameTreePath || isDeleting} onClick={(event) => { event.stopPropagation(); onRequestRenameTreePath?.(node.key, false); }} />
                  <Button size="small" type="text" icon={<DeleteOutlined />} className={styles.attachActionButton} title={deleteTitle} aria-label={deleteTitle} danger loading={isDeleting} disabled={!onRequestDeleteTreePath || isDeleting} onClick={(event) => { event.stopPropagation(); onRequestDeleteTreePath?.(node.key, false); }} />
                </span>
              ) : (
                <span className={styles.treeNodeActions}>
                  <Button size="small" type="text" icon={<FolderAddOutlined />} className={styles.attachActionButton} title={createFolderTitle} aria-label={createFolderTitle} disabled={!onRequestCreateChildDirectory || isDeleting} onClick={(event) => { event.stopPropagation(); onRequestCreateChildDirectory?.(node.key); }} />
                  <Button size="small" type="text" icon={<EditOutlined />} className={styles.attachActionButton} title={renameTitle} aria-label={renameTitle} disabled={!onRequestRenameTreePath || isDeleting} onClick={(event) => { event.stopPropagation(); onRequestRenameTreePath?.(node.key, true); }} />
                  <Button size="small" type="text" icon={<DeleteOutlined />} className={styles.attachActionButton} title={deleteTitle} aria-label={deleteTitle} danger loading={isDeleting} disabled={!onRequestDeleteTreePath || isDeleting} onClick={(event) => { event.stopPropagation(); onRequestDeleteTreePath?.(node.key, true); }} />
                </span>
              )}
            </span>
          ),
          isLeaf: !isDirectory,
          children: isDirectory ? children : undefined,
        };
      });

  return toTreeNodes(root);
}

// ---------------------------------------------------------------------------
// Lazy tree helpers
// ---------------------------------------------------------------------------

function toLazyTreeItems(nodes: AgentProjectFileTreeNode[]): LazyTreeItem[] {
  return nodes.map((item) => ({
    ...item,
    loaded: !item.is_directory || item.child_count <= 0,
    children: undefined,
  }));
}

function mergeLazyTreeRootItems(
  current: LazyTreeItem[],
  nextNodes: AgentProjectFileTreeNode[],
): LazyTreeItem[] {
  const currentByPath = new Map(current.map((item) => [item.path, item]));
  return nextNodes.map((node) => {
    const previous = currentByPath.get(node.path);
    if (!node.is_directory) {
      return { ...node, loaded: true, children: undefined };
    }
    if (!previous || !previous.is_directory) {
      return { ...node, loaded: node.child_count <= 0, children: undefined };
    }
    const hasChildren = Boolean(previous.children && previous.children.length > 0);
    const shouldKeepChildren = previous.loaded && hasChildren && node.child_count > 0;
    return {
      ...node,
      loaded: node.child_count <= 0 ? true : previous.loaded,
      children: shouldKeepChildren ? previous.children : undefined,
    };
  });
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
        child_count: children.length,
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

function findLazyTreeItem(items: LazyTreeItem[], targetPath: string): LazyTreeItem | null {
  for (const item of items) {
    if (item.path === targetPath) return item;
    if (item.children && item.children.length > 0) {
      const nested = findLazyTreeItem(item.children, targetPath);
      if (nested) return nested;
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
  onRequestRenameTreePath: ((path: string, isDirectory: boolean) => void) | undefined,
  onRequestCreateChildDirectory: ((parentPath: string) => void) | undefined,
  onRequestDeleteTreePath: ((path: string, isDirectory: boolean) => void) | undefined,
  onOpenNodeContextMenu: ((event: MouseEvent, path: string, isDirectory: boolean, isAttached: boolean) => void) | undefined,
  deletingTreePathSet: Set<string>,
  attachTitle: string,
  detachTitle: string,
  renameTitle: string,
  createFolderTitle: string,
  deleteTitle: string,
  onRefreshTreeDirectory: ((path: string) => void) | undefined,
  refreshingDirectorySet: Set<string>,
  refreshTitle: string,
): TreeNode[] {
  return items.map((item) => {
    const isPriority = !item.is_directory && priorityFileSet.has(item.path);
    const isAttached = !item.is_directory && selectedAttachSet.has(item.path);
    const isHighlighted = !item.is_directory && highlightedFileSet.has(item.path);
    const isDeleting = deletingTreePathSet.has(item.path);
    const isRefreshingDirectory = item.is_directory && refreshingDirectorySet.has(item.path);
    const directoryCountLabel = item.is_directory && item.direct_file_count > 0
      ? `${item.direct_file_count}${item.has_child_directories ? "+" : ""}`
      : "";
    const childNodes = item.children
      ? buildLazyTreeNodes(
          item.children, priorityFileSet, selectedAttachSet, highlightedFileSet,
          onAttachArtifactToChat, onRequestRenameTreePath, onRequestCreateChildDirectory,
          onRequestDeleteTreePath, onOpenNodeContextMenu, deletingTreePathSet,
          attachTitle, detachTitle, renameTitle, createFolderTitle, deleteTitle,
          onRefreshTreeDirectory, refreshingDirectorySet, refreshTitle,
        )
      : undefined;

    return {
      key: item.path,
      title: (
        <span
          className={styles.treeNodeRow}
          onContextMenu={(event) => onOpenNodeContextMenu?.(event, item.path, item.is_directory, isAttached)}
        >
          <span className={item.is_directory ? styles.compactTreeFolderLabel : styles.compactTreeLeafLabel}>
            {renderNodeIcon(item.filename, item.is_directory, isPriority)}
            <span className={[styles.treeNodeText, isHighlighted ? styles.treeNodeTextHighlighted : "", isAttached ? styles.treeNodeTextAttached : ""].filter(Boolean).join(" ")}>
              {item.filename}
            </span>
            {!item.is_directory && isAttached ? <span className={styles.treeNodeAttachedMark}>✓</span> : null}
            {directoryCountLabel ? <span className={styles.treeNodeMetaCount}>{directoryCountLabel}</span> : null}
          </span>
          {item.is_directory ? (
            <span className={styles.treeNodeActions}>
              <Button size="small" type="text" icon={<ReloadOutlined spin={isRefreshingDirectory} />} className={styles.attachActionButton} title={refreshTitle} aria-label={refreshTitle} disabled={!onRefreshTreeDirectory || isRefreshingDirectory} onClick={(event) => { event.stopPropagation(); onRefreshTreeDirectory?.(item.path); }} />
              <Button size="small" type="text" icon={<FolderAddOutlined />} className={styles.attachActionButton} title={createFolderTitle} aria-label={createFolderTitle} disabled={!onRequestCreateChildDirectory || isDeleting} onClick={(event) => { event.stopPropagation(); onRequestCreateChildDirectory?.(item.path); }} />
              <Button size="small" type="text" icon={<EditOutlined />} className={styles.attachActionButton} title={renameTitle} aria-label={renameTitle} disabled={!onRequestRenameTreePath || isDeleting} onClick={(event) => { event.stopPropagation(); onRequestRenameTreePath?.(item.path, true); }} />
              <Button size="small" type="text" icon={<DeleteOutlined />} className={styles.attachActionButton} title={deleteTitle} aria-label={deleteTitle} danger loading={isDeleting} disabled={!onRequestDeleteTreePath || isDeleting} onClick={(event) => { event.stopPropagation(); onRequestDeleteTreePath?.(item.path, true); }} />
            </span>
          ) : (
            <span className={styles.treeNodeActions}>
              <Button size="small" type="text" icon={isAttached ? <MinusOutlined /> : <PlusOutlined />} className={styles.attachActionButton} title={isAttached ? detachTitle : attachTitle} aria-label={isAttached ? detachTitle : attachTitle} onClick={(event) => { event.stopPropagation(); onAttachArtifactToChat(item.path); }} />
              <Button size="small" type="text" icon={<EditOutlined />} className={styles.attachActionButton} title={renameTitle} aria-label={renameTitle} disabled={!onRequestRenameTreePath || isDeleting} onClick={(event) => { event.stopPropagation(); onRequestRenameTreePath?.(item.path, false); }} />
              <Button size="small" type="text" icon={<DeleteOutlined />} className={styles.attachActionButton} title={deleteTitle} aria-label={deleteTitle} danger loading={isDeleting} disabled={!onRequestDeleteTreePath || isDeleting} onClick={(event) => { event.stopPropagation(); onRequestDeleteTreePath?.(item.path, false); }} />
            </span>
          )}
        </span>
      ),
      isLeaf: !item.is_directory,
      children: childNodes,
    };
  });
}

// ---------------------------------------------------------------------------
// ProjectFileTree component
// ---------------------------------------------------------------------------

export default function ProjectFileTree({
  selectedProject,
  projectFiles,
  projectFileSummary,
  projectTreeNodes,
  projectTreeLoading = false,
  priorityFilePaths,
  selectedFilePath,
  expandedKeys: controlledExpandedKeys,
  staleDirectoryPaths = [],
  selectedAttachPaths,
  treeFilterQuery,
  selectedMetricFilter = "",
  onMetricFilterChange,
  activeStage,
  treeDisplayMode,
  deletingTreePaths = [],
  projectFilesRefreshing = false,
  latestUpdatedFilePath,
  onTreeFilterQueryChange,
  onExpandedKeysChange,
  onConsumeStaleDirectoryPaths,
  onSelectFileFromTree,
  onSelectLatestUpdatedFile,
  onAttachArtifactToChat,
  onRequestMoveTreePath,
  onRequestRenameTreePath,
  onRequestCreateChildDirectory,
  onRequestDeleteTreePath,
  onRequestDeleteSelectedFilePaths,
  onRequestMoveSelectedFilePaths,
  onRequestSetSelectedFilePaths,
  onRefreshProjectFiles,
  onRefreshProjectTreeDirectory,
  onLoadProjectTreeChildren,
  onUploadFiles,
  onTreeDisplayModeChange,
}: ProjectFileTreeProps) {
  const { t } = useTranslation();
  const [treeTransitioning, setTreeTransitioning] = useState(false);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [localTreeFilterQuery, setLocalTreeFilterQuery] = useState("");
  const [internalExpandedKeys, setInternalExpandedKeys] = useState<string[]>([]);
  const [lazyTreeItems, setLazyTreeItems] = useState<LazyTreeItem[]>([]);
  const [refreshingDirectoryPaths, setRefreshingDirectoryPaths] = useState<string[]>([]);
  const [treeSelectionAnchorPath, setTreeSelectionAnchorPath] = useState("");
  const treeExpandedInitializedRef = useRef(false);
  const lazyTreeItemsRef = useRef<LazyTreeItem[]>([]);
  const loadingTreeDirectoryPathsRef = useRef<Set<string>>(new Set());
  const treeContextMenu = useContextMenu();
  const [contextMenuTarget, setContextMenuTarget] = useState<{
    path: string;
    isDirectory: boolean;
    isAttached: boolean;
  } | null>(null);

  const effectiveTreeFilterQuery = treeFilterQuery ?? localTreeFilterQuery;
  const deferredTreeFilterQuery = useDeferredValue(effectiveTreeFilterQuery);
  const normalizedTreeFilterQuery = normalizeProjectPath(deferredTreeFilterQuery.trim());
  const expandedKeys = useMemo(
    () => normalizeTreeKeys(controlledExpandedKeys ?? internalExpandedKeys),
    [controlledExpandedKeys, internalExpandedKeys],
  );

  // Derived data
  const builtInFiles = useMemo(
    () => projectFiles.filter((item) => typeof item.builtin === "boolean" ? item.builtin : isBuiltInProjectFile(item.path)),
    [projectFiles],
  );
  const nonBuiltInFiles = useMemo(
    () => projectFiles.filter((item) => !(typeof item.builtin === "boolean" ? item.builtin : isBuiltInProjectFile(item.path))),
    [projectFiles],
  );
  const filterScopedFiles = useMemo(() => {
    if (selectedMetricFilter === "builtin") return builtInFiles;
    return selectedMetricFilter ? nonBuiltInFiles : projectFiles;
  }, [builtInFiles, nonBuiltInFiles, projectFiles, selectedMetricFilter]);

  const attachTitle = t("projects.chat.addAttachment");
  const detachTitle = t("projects.chat.removeAttachment");
  const refreshTitle = t("projects.refreshFiles");
  const renameTitle = t("common.rename");
  const createFolderTitle = t("projects.createFolder");
  const deleteTitle = t("common.delete");
  const deleteSelectedTitle = t("projects.deleteSelectedFiles");
  const moveSelectedTitle = t("projects.moveSelectedFiles");
  const selectVisibleTitle = t("projects.selectVisibleFiles");
  const clearSelectedTitle = t("projects.clearSelectedFiles");
  const selectedOnlyTitle = t("projects.treeSelectedOnly");

  const priorityFileSet = useMemo(() => new Set(priorityFilePaths), [priorityFilePaths]);
  const selectedAttachSet = useMemo(() => new Set(selectedAttachPaths), [selectedAttachPaths]);
  const staleDirectorySet = useMemo(
    () => new Set(normalizeTreeKeys(staleDirectoryPaths)),
    [staleDirectoryPaths],
  );
  const refreshingDirectorySet = useMemo(
    () => new Set(refreshingDirectoryPaths),
    [refreshingDirectoryPaths],
  );
  const deletingTreePathSet = useMemo(
    () => new Set(normalizeTreeKeys(deletingTreePaths)),
    [deletingTreePaths],
  );

  // Filter files by metric/type filter
  const filteredFiles = useMemo(
    () => filterScopedFiles.filter((item) => {
      const normalizedPath = normalizeProjectPath(item.path);
      const fileStage = resolveProjectFileStage(item);
      switch (selectedMetricFilter) {
        case "original": return fileStage === "original";
        case "intermediate": return fileStage === "intermediate";
        case "artifact": return fileStage === "artifact";
        case "agent": return isAgentProjectFile(normalizedPath);
        case "builtin": return typeof item.builtin === "boolean" ? item.builtin : isBuiltInProjectFile(item.path);
        case "markdown": return matchesProjectKnowledgeFilter("markdown", item);
        case "text": return matchesProjectKnowledgeFilter("text", item);
        case "script": return matchesProjectKnowledgeFilter("script", item);
        case "otherType": return matchesProjectKnowledgeFilter("otherType", item);
        default: return true;
      }
    }),
    [filterScopedFiles, selectedMetricFilter],
  );

  const selectionScopedFilteredFiles = useMemo(
    () => (showSelectedOnly
      ? filteredFiles.filter((item) => selectedAttachSet.has(item.path))
      : filteredFiles),
    [filteredFiles, selectedAttachSet, showSelectedOnly],
  );

  const keywordFilteredFiles = useMemo(
    () => selectionScopedFilteredFiles.filter(
      (item) => matchesProjectPathQuery(item.path, normalizedTreeFilterQuery),
    ),
    [normalizedTreeFilterQuery, selectionScopedFilteredFiles],
  );

  const filteredFilePaths = keywordFilteredFiles.map((item) => item.path);
  const highlightedFilePaths = useMemo(
    () => (selectedMetricFilter ? filteredFilePaths : []),
    [filteredFilePaths, selectedMetricFilter],
  );

  // Tree data: filter mode vs highlight mode
  const highlightBaseFiles = useMemo(() => {
    const base = selectedMetricFilter === "builtin" ? projectFiles : filterScopedFiles;
    return showSelectedOnly ? base.filter((item) => selectedAttachSet.has(item.path)) : base;
  }, [filterScopedFiles, projectFiles, selectedAttachSet, selectedMetricFilter, showSelectedOnly]);

  const treeBaseFiles = treeDisplayMode === "highlight" ? highlightBaseFiles : keywordFilteredFiles;

  const treeFiles = useMemo(
    () => treeBaseFiles.filter(
      (item) => matchesProjectPathQuery(item.path, normalizedTreeFilterQuery),
    ),
    [normalizedTreeFilterQuery, treeBaseFiles],
  );

  const treeFilePaths = treeFiles.map((item) => item.path);
  const highlightedFileSet = useMemo(
    () => new Set(treeDisplayMode === "highlight" ? highlightedFilePaths : []),
    [highlightedFilePaths, treeDisplayMode],
  );

  // Decide whether to use lazy tree mode
  const useLazyTreeMode = Boolean(
    treeDisplayMode === "filter"
    && !normalizedTreeFilterQuery
    && (!selectedMetricFilter
      || ["original", "intermediate", "artifact", "agent", "skill", "flow", "case", "builtin"].includes(selectedMetricFilter)),
  );

  // Build tree nodes (flat or lazy)
  const treeData = useMemo(
    () => buildFileTree(
      treeFilePaths, priorityFileSet, selectedAttachSet, highlightedFileSet,
      onAttachArtifactToChat, onRequestRenameTreePath, onRequestCreateChildDirectory,
      onRequestDeleteTreePath,
      (event, path, isDirectory, isAttached) => {
        setContextMenuTarget({ path, isDirectory, isAttached });
        treeContextMenu.show(event);
      },
      deletingTreePathSet, attachTitle, detachTitle, renameTitle, createFolderTitle, deleteTitle,
    ),
    [treeFilePaths, priorityFileSet, selectedAttachSet, highlightedFileSet,
      onAttachArtifactToChat, onRequestRenameTreePath, onRequestCreateChildDirectory,
      onRequestDeleteTreePath, deletingTreePathSet, attachTitle, detachTitle,
      renameTitle, createFolderTitle, deleteTitle, treeContextMenu],
  );

  // Context menu items
  const contextMenuItems: ContextMenuItem[] = useMemo(() => {
    if (!contextMenuTarget) return [];
    if (contextMenuTarget.isDirectory) {
      return [
        { key: "new-folder", label: createFolderTitle, onClick: () => onRequestCreateChildDirectory?.(contextMenuTarget.path), disabled: !onRequestCreateChildDirectory },
        { key: "rename", label: renameTitle, onClick: () => onRequestRenameTreePath?.(contextMenuTarget.path, true), disabled: !onRequestRenameTreePath },
        { key: "delete", label: deleteTitle, danger: true, onClick: () => onRequestDeleteTreePath?.(contextMenuTarget.path, true), disabled: !onRequestDeleteTreePath },
      ];
    }
    return [
      { key: "attach", label: contextMenuTarget.isAttached ? detachTitle : attachTitle, onClick: () => onAttachArtifactToChat(contextMenuTarget.path) },
      { key: "rename", label: renameTitle, onClick: () => onRequestRenameTreePath?.(contextMenuTarget.path, false), disabled: !onRequestRenameTreePath },
      { key: "delete", label: deleteTitle, danger: true, onClick: () => onRequestDeleteTreePath?.(contextMenuTarget.path, false), disabled: !onRequestDeleteTreePath },
    ];
  }, [contextMenuTarget, createFolderTitle, renameTitle, deleteTitle, attachTitle, detachTitle, onAttachArtifactToChat, onRequestCreateChildDirectory, onRequestRenameTreePath, onRequestDeleteTreePath]);

  // Drop handler
  const handleTreeDrop = useCallback((info: {
    dragNode: { key: Key; isLeaf?: boolean };
    node: { key: Key; isLeaf?: boolean };
    dropToGap?: boolean;
  }) => {
    if (!onRequestMoveTreePath) return;
    const sourcePath = String(info.dragNode?.key || "").trim();
    const targetPath = String(info.node?.key || "").trim();
    if (!sourcePath || !targetPath || sourcePath === targetPath) return;
    if (info.dropToGap) {
      const lastSlash = targetPath.lastIndexOf("/");
      const targetDirPath = lastSlash > 0 ? targetPath.slice(0, lastSlash) : "";
      onRequestMoveTreePath(sourcePath, !Boolean(info.dragNode?.isLeaf), targetDirPath);
      return;
    }
    if (info.node?.isLeaf) return;
    onRequestMoveTreePath(sourcePath, !Boolean(info.dragNode?.isLeaf), targetPath);
  }, [onRequestMoveTreePath]);

  // Tree select handler
  const handleTreeSelect = useCallback((
    keys: Key[],
    info: {
      node?: { key?: Key; isLeaf?: boolean };
      // Only the modifier keys are read, so accept both the React synthetic
      // event and the native event antd hands to Tree#onSelect.
      nativeEvent?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean };
    },
  ) => {
    const key = String(keys[0] || info.node?.key || "");
    if (!key || info.node?.isLeaf === false) return;

    const nativeEvent = info.nativeEvent;
    const withToggle = Boolean(nativeEvent?.metaKey || nativeEvent?.ctrlKey);
    const withRange = Boolean(nativeEvent?.shiftKey);
    const hasSelectionHandler = Boolean(onRequestSetSelectedFilePaths);

    if (hasSelectionHandler && withRange) {
      const orderedPaths = treeFilePaths.length > 0 ? treeFilePaths : treeFilePaths;
      const anchorPath = treeSelectionAnchorPath || selectedAttachPaths[selectedAttachPaths.length - 1] || key;
      const rangePaths = resolveRangePaths(orderedPaths, anchorPath, key);
      if (withToggle) {
        onRequestSetSelectedFilePaths?.(Array.from(new Set([...selectedAttachPaths, ...rangePaths])));
      } else {
        onRequestSetSelectedFilePaths?.(rangePaths);
      }
      setTreeSelectionAnchorPath(key);
      onSelectFileFromTree(key);
      return;
    }

    if (hasSelectionHandler && withToggle) {
      const selectedSet = new Set(selectedAttachPaths);
      if (selectedSet.has(key)) selectedSet.delete(key);
      else selectedSet.add(key);
      onRequestSetSelectedFilePaths?.(Array.from(selectedSet));
      setTreeSelectionAnchorPath(key);
      onSelectFileFromTree(key);
      return;
    }

    setTreeSelectionAnchorPath(key);
    onSelectFileFromTree(key);
  }, [onRequestSetSelectedFilePaths, onSelectFileFromTree, selectedAttachPaths, treeFilePaths, treeSelectionAnchorPath]);

  // Empty state message
  const emptyTreeDescription = showSelectedOnly && selectedAttachPaths.length === 0
    ? t("projects.noSelectedFiles")
    : normalizedTreeFilterQuery
      ? t("projects.noMatchedFiles")
      : selectedMetricFilter || normalizedTreeFilterQuery
        ? t("projects.noFilteredFiles")
        : t("projects.noFiles");

  // Expanded keys management
  const updateExpandedKeys = useCallback((nextKeys: string[]) => {
    const normalizedKeys = normalizeTreeKeys(nextKeys);
    if (onExpandedKeysChange) {
      onExpandedKeysChange(normalizedKeys);
      return;
    }
    setInternalExpandedKeys(normalizedKeys);
  }, [onExpandedKeysChange]);

  // Sync lazy tree items from props
  useEffect(() => {
    lazyTreeItemsRef.current = lazyTreeItems;
  }, [lazyTreeItems]);

  useEffect(() => {
    setLazyTreeItems((prev) => mergeLazyTreeRootItems(prev, projectTreeNodes || []));
    setRefreshingDirectoryPaths([]);
  }, [projectTreeNodes]);

  // Reset local filter when project changes
  useEffect(() => {
    if (typeof treeFilterQuery === "string") {
      onTreeFilterQueryChange?.("");
      return;
    }
    setLocalTreeFilterQuery("");
  }, [onTreeFilterQueryChange, selectedProject?.id]);

  // Lazy tree directory loading
  const loadTreeDirectory = useCallback(async (path: string, options?: { force?: boolean }) => {
    if (!useLazyTreeMode || !onLoadProjectTreeChildren) return false;
    const normalizedPath = String(path || "").trim();
    if (!normalizedPath) return false;
    const currentNode = findLazyTreeItem(lazyTreeItemsRef.current, normalizedPath);
    if (!currentNode || !currentNode.is_directory) return false;
    if (!options?.force && currentNode.loaded) return false;
    if (loadingTreeDirectoryPathsRef.current.has(normalizedPath)) return false;
    loadingTreeDirectoryPathsRef.current.add(normalizedPath);
    try {
      const children = await onLoadProjectTreeChildren(normalizedPath);
      setLazyTreeItems((prev) => updateLazyTreeChildren(prev, normalizedPath, toLazyTreeItems(children)));
      return true;
    } finally {
      loadingTreeDirectoryPathsRef.current.delete(normalizedPath);
    }
  }, [onLoadProjectTreeChildren, useLazyTreeMode]);

  const handleRefreshTreeDirectory = useCallback(async (path: string) => {
    if (!onRefreshProjectTreeDirectory) return;
    setRefreshingDirectoryPaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
    try {
      const children = await onRefreshProjectTreeDirectory(path);
      setLazyTreeItems((prev) => updateLazyTreeChildren(prev, path, toLazyTreeItems(children)));
      onConsumeStaleDirectoryPaths?.([path]);
    } finally {
      setRefreshingDirectoryPaths((prev) => prev.filter((item) => item !== path));
    }
  }, [onRefreshProjectTreeDirectory, onConsumeStaleDirectoryPaths]);

  // Auto-load lazy tree directories for expanded keys
  useEffect(() => {
    if (!useLazyTreeMode || !onLoadProjectTreeChildren || expandedKeys.length === 0) return;
    const nextPaths = [...expandedKeys].sort(compareTreePathDepth);
    let remainingBudget = LAZY_TREE_AUTO_LOAD_BATCH_SIZE;
    for (const path of nextPaths) {
      if (remainingBudget <= 0) break;
      const currentNode = findLazyTreeItem(lazyTreeItems, path);
      if (currentNode && currentNode.is_directory && !currentNode.loaded) {
        remainingBudget -= 1;
        void loadTreeDirectory(path);
      }
    }
  }, [expandedKeys, lazyTreeItems, loadTreeDirectory, onLoadProjectTreeChildren, useLazyTreeMode]);

  // Reload stale directories
  useEffect(() => {
    if (!useLazyTreeMode || staleDirectorySet.size === 0 || expandedKeys.length === 0) return;
    const nextPaths = expandedKeys
      .filter((path) => staleDirectorySet.has(path))
      .sort(compareTreePathDepth)
      .slice(0, LAZY_TREE_AUTO_LOAD_BATCH_SIZE);
    if (nextPaths.length === 0) return;
    void (async () => {
      const consumedPaths: string[] = [];
      for (const path of nextPaths) {
        const loaded = await loadTreeDirectory(path, { force: true });
        if (loaded) consumedPaths.push(path);
      }
      if (consumedPaths.length > 0) onConsumeStaleDirectoryPaths?.(consumedPaths);
    })();
  }, [expandedKeys, loadTreeDirectory, onConsumeStaleDirectoryPaths, staleDirectorySet, useLazyTreeMode]);

  // Filter lazy tree items by metric filter
  const visibleLazyTreeItems = useMemo(() => {
    if (!useLazyTreeMode) return [] as LazyTreeItem[];
    if (!selectedMetricFilter) return lazyTreeItems;
    return lazyTreeItems.filter((item) => {
      const normalizedPath = normalizeProjectPath(item.path);
      switch (selectedMetricFilter) {
        case "original": return normalizedPath === "original" || normalizedPath.startsWith("original/");
        case "intermediate": return normalizedPath === "intermediate" || normalizedPath.startsWith("intermediate/");
        case "artifact": return normalizedPath === "output" || normalizedPath.startsWith("output/");
        case "agent": return normalizedPath === ".agent" || normalizedPath.startsWith(".agent/");
        case "builtin":
          if (typeof item.builtin === "boolean") return item.builtin;
          return item.is_directory
            ? isBuiltInProjectDirectory(item.path)
            : isBuiltInProjectFile(item.path);
        default: return true;
      }
    });
  }, [lazyTreeItems, selectedMetricFilter, useLazyTreeMode]);

  const lazyTreeData = useMemo(
    () => buildLazyTreeNodes(
      visibleLazyTreeItems, priorityFileSet, selectedAttachSet, highlightedFileSet,
      onAttachArtifactToChat, onRequestRenameTreePath, onRequestCreateChildDirectory,
      onRequestDeleteTreePath,
      (event, path, isDirectory, isAttached) => {
        setContextMenuTarget({ path, isDirectory, isAttached });
        treeContextMenu.show(event);
      },
      deletingTreePathSet, attachTitle, detachTitle, renameTitle, createFolderTitle, deleteTitle,
      useLazyTreeMode ? handleRefreshTreeDirectory : undefined, refreshingDirectorySet, refreshTitle,
    ),
    [visibleLazyTreeItems, priorityFileSet, selectedAttachSet, highlightedFileSet,
      onAttachArtifactToChat, onRequestRenameTreePath, onRequestCreateChildDirectory,
      onRequestDeleteTreePath, deletingTreePathSet, attachTitle, detachTitle,
      renameTitle, createFolderTitle, deleteTitle, useLazyTreeMode,
      handleRefreshTreeDirectory, refreshingDirectorySet, refreshTitle, treeContextMenu],
  );

  // Initialize expanded keys
  useEffect(() => {
    treeExpandedInitializedRef.current = false;
  }, [selectedProject?.id, useLazyTreeMode]);

  useEffect(() => {
    const nextTreeData = useLazyTreeMode ? lazyTreeData : treeData;
    if (nextTreeData.length === 0) return;
    if (expandedKeys.length > 0) { treeExpandedInitializedRef.current = true; return; }
    if (treeExpandedInitializedRef.current) return;
    if (useLazyTreeMode) {
      updateExpandedKeys(
        nextTreeData.length === 1 && !nextTreeData[0].isLeaf
          ? [String(nextTreeData[0].key)] : [],
      );
    } else {
      updateExpandedKeys(collectDirectoryKeys(nextTreeData));
    }
    treeExpandedInitializedRef.current = true;
  }, [expandedKeys.length, lazyTreeData, treeData, updateExpandedKeys, useLazyTreeMode]);

  // Auto-select first file when metric filter changes
  useEffect(() => {
    if (treeDisplayMode !== "filter") return;
    if (!selectedMetricFilter) return;
    if (filteredFilePaths.length === 0) return;
    if (!selectedFilePath || !filteredFilePaths.includes(selectedFilePath)) {
      onSelectFileFromTree(filteredFilePaths[0]);
    }
  }, [filteredFilePaths, onSelectFileFromTree, selectedFilePath, selectedMetricFilter, treeDisplayMode]);

  // Transition animation
  useEffect(() => {
    setTreeTransitioning(true);
    const timer = window.setTimeout(() => setTreeTransitioning(false), 220);
    return () => window.clearTimeout(timer);
  }, [activeStage, selectedMetricFilter]);

  const metricFilterChips = useMemo(() => {
    if (!onMetricFilterChange) return [] as Array<{ key: ProjectFileFilterKey; label: string; count: number }>;
    return METRIC_FILTER_CHIPS.map(({ key, field }) => {
      const descriptor = getProjectFilterLabelDescriptor(key);
      return {
        key,
        label: t(descriptor.i18nKey),
        count: projectFileSummary?.[field] ?? 0,
      };
    }).filter((chip) => chip.count > 0 || chip.key === selectedMetricFilter);
  }, [onMetricFilterChange, projectFileSummary, selectedMetricFilter, t]);

  return (
    <div className={`${styles.scrollContainer} ${styles.treeOnlyScrollContainer}`}>
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className={styles.treeOnlyHeaderRow}>
        <span className={styles.sectionTitle}>{t("projects.projectSpaceFiles")}</span>
        <div className={styles.panelExtraActions}>
          {latestUpdatedFilePath ? (
            <Tooltip title={latestUpdatedFilePath}>
              <Button size="small" type="link" className={`${styles.panelExtraAction} ${styles.latestUpdatedFileButton}`} onClick={() => onSelectLatestUpdatedFile?.(latestUpdatedFilePath)}>
                {t("projects.latestUpdatedFile")}
              </Button>
            </Tooltip>
          ) : null}
          <Button size="small" type="link" icon={<ReloadOutlined spin={projectFilesRefreshing} />} className={styles.panelExtraAction} onClick={() => { void onRefreshProjectFiles?.(); }} disabled={!onRefreshProjectFiles || projectFilesRefreshing}>
            {t("projects.refreshFiles")}
          </Button>
        </div>
      </div>

      {/* ── Upload / Create / Select toolbar ──────────────────────────── */}
      <div className={styles.treeUploadRow}>
        <div className={styles.chatEmptyActions}>
          <Button type="primary" className={styles.treeUploadButton} onClick={onUploadFiles}>
            {t("projects.upload.button")}
          </Button>
          <Button onClick={() => onRequestCreateChildDirectory?.("")}>{createFolderTitle}</Button>
          <Button disabled={!onRequestSetSelectedFilePaths || treeFilePaths.length === 0} onClick={() => onRequestSetSelectedFilePaths?.(treeFilePaths)}>
            {selectVisibleTitle}
          </Button>
          <Button disabled={!onRequestSetSelectedFilePaths || selectedAttachPaths.length === 0} onClick={() => onRequestSetSelectedFilePaths?.([])}>
            {clearSelectedTitle}
          </Button>
          <Button disabled={!onRequestMoveSelectedFilePaths || selectedAttachPaths.length === 0} onClick={() => onRequestMoveSelectedFilePaths?.(selectedAttachPaths)}>
            {moveSelectedTitle}
          </Button>
          <Button danger disabled={!onRequestDeleteSelectedFilePaths || selectedAttachPaths.length === 0} onClick={() => onRequestDeleteSelectedFilePaths?.(selectedAttachPaths)}>
            {deleteSelectedTitle}
          </Button>
          <Text type="secondary" className={styles.treeSelectedCountText}>
            {t("projects.selectedFilesCount", { count: selectedAttachPaths.length })}
          </Text>
        </div>
      </div>

      {/* ── Filter toolbar ────────────────────────────────────────────── */}
      <div className={`${styles.overviewTreeToolbar} ${styles.treeToolbarSticky}`}>
        <div className={styles.treeToolbarLeft}>
          <Input
            size="small"
            allowClear
            value={effectiveTreeFilterQuery}
            onChange={(event) => {
              const next = event.target.value;
              if (typeof treeFilterQuery === "string") {
                onTreeFilterQueryChange?.(next);
              } else {
                setLocalTreeFilterQuery(next);
              }
            }}
            className={styles.treeFilterInput}
            prefix={<SearchOutlined />}
            placeholder={t("projects.treeFilterPlaceholder")}
          />
          <Button size="small" type={showSelectedOnly ? "primary" : "default"} onClick={() => setShowSelectedOnly((prev) => !prev)}>
            {selectedOnlyTitle}
          </Button>
          {metricFilterChips.length > 0 ? (
            <div className={styles.treeFilterChips}>
              {metricFilterChips.map((chip) => {
                const active = selectedMetricFilter === chip.key;
                return (
                  <button
                    key={chip.key}
                    type="button"
                    className={`${styles.treeFilterChip} ${active ? styles.treeFilterChipActive : ""}`}
                    aria-pressed={active}
                    onClick={() => onMetricFilterChange?.(toggleProjectFileFilter(selectedMetricFilter, chip.key))}
                  >
                    {chip.label}
                    <span className={styles.treeFilterChipCount}>{chip.count}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <div className={styles.treeToolbarRight}>
          <Segmented
            size="small"
            className={styles.treeModeSegment}
            value={treeDisplayMode}
            onChange={(value) => onTreeDisplayModeChange(value as TreeDisplayMode)}
            options={[
              { label: t("projects.treeViewMode.filter"), value: "filter" },
              { label: t("projects.treeViewMode.highlight"), value: "highlight" },
            ]}
          />
        </div>
      </div>

      {/* ── Tree ──────────────────────────────────────────────────────── */}
      <div className={`${styles.treeTransitionShell} ${styles.treeTransitionShellFullHeight} ${treeTransitioning ? styles.treeTransitionEnter : ""}`}>
        {useLazyTreeMode && projectTreeLoading && lazyTreeData.length === 0 ? (
          <div className={styles.centerState}><Spin /></div>
        ) : (useLazyTreeMode ? lazyTreeData : treeData).length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyTreeDescription} />
        ) : (
          <Tree
            className={`${styles.overviewCompactTree} ${styles.overviewCompactTreeFullHeight}`}
            selectedKeys={selectedFilePath ? [selectedFilePath] : []}
            treeData={useLazyTreeMode ? lazyTreeData : treeData}
            draggable={Boolean(onRequestMoveTreePath)}
            onDrop={handleTreeDrop}
            expandedKeys={expandedKeys}
            onExpand={(keys) => {
              const nextKeys = normalizeTreeKeys((keys as string[]).map((key) => String(key)));
              const previousKeySet = new Set(expandedKeys);
              updateExpandedKeys(nextKeys);
              if (!useLazyTreeMode) return;
              for (const key of nextKeys) {
                if (!previousKeySet.has(key)) {
                  const shouldForceRefresh = staleDirectorySet.has(key);
                  void loadTreeDirectory(key, shouldForceRefresh ? { force: true } : undefined)
                    .then((loaded) => { if (loaded && shouldForceRefresh) onConsumeStaleDirectoryPaths?.([key]); });
                }
              }
            }}
            loadData={useLazyTreeMode && onLoadProjectTreeChildren
              ? async (treeNode) => {
                const key = String(treeNode.key || "");
                const currentNode = findLazyTreeItem(lazyTreeItemsRef.current, key);
                const shouldForceRefresh = staleDirectorySet.has(key);
                if (!currentNode || !currentNode.is_directory || (currentNode.loaded && !shouldForceRefresh)) return;
                const loaded = await loadTreeDirectory(key, shouldForceRefresh ? { force: true } : undefined);
                if (loaded && shouldForceRefresh) onConsumeStaleDirectoryPaths?.([key]);
              }
              : undefined}
            onSelect={(keys, info) => {
              const key = String(keys[0] || info?.node?.key || "");
              const selectedLazyNode = useLazyTreeMode ? findLazyTreeItem(lazyTreeItems, key) : null;
              if (key && (!selectedLazyNode || !selectedLazyNode.is_directory)) {
                handleTreeSelect(keys, { node: { key: info?.node?.key, isLeaf: info?.node?.isLeaf }, nativeEvent: info?.nativeEvent });
              }
            }}
          />
        )}
      </div>

      <ContextMenu visible={treeContextMenu.visible} x={treeContextMenu.x} y={treeContextMenu.y} items={contextMenuItems} onClose={treeContextMenu.hide} />
    </div>
  );
}
