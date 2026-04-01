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
import { Button, Card, Empty, Tree, Typography } from "antd";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type {
  AgentProjectFileInfo,
  AgentProjectSummary,
} from "../../../api/types/agents";
import styles from "./index.module.less";

const { Text } = Typography;

type FileMetricFilterKey = "original" | "derived" | "skills" | "scripts" | "flows" | "cases";

interface ProjectOverviewCardProps {
  selectedProject?: AgentProjectSummary;
  projectFileCount: number;
  pipelineTemplateCount: number;
  pipelineRunCount: number;
  projectWorkspaceSummary: string;
  projectFiles: AgentProjectFileInfo[];
  priorityFilePaths: string[];
  selectedFilePath: string;
  selectedAttachPaths: string[];
  hideBuiltInFiles: boolean;
  onUploadFiles: () => void;
  onSelectFileFromTree: (path: string) => void;
  onAttachArtifactToChat: (path: string) => void;
  onToggleHideBuiltInFiles: (value: boolean) => void;
}

interface TreeNode {
  key: string;
  title: ReactNode;
  children?: TreeNode[];
  isLeaf?: boolean;
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

function isBuiltInProjectFile(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  const fileName = normalized.split("/").pop() || "";
  return fileName === "project.md" || fileName === "heartbeat.md";
}

function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function isOriginalInputFile(path: string): boolean {
  const normalized = normalizeProjectPath(path);
  return normalized === "original" || normalized.startsWith("original/");
}

function isPathInStandardDir(path: string, dir: "skills" | "scripts" | "flows" | "cases"): boolean {
  const normalized = normalizeProjectPath(path);
  return normalized === dir || normalized.startsWith(`${dir}/`);
}

function isStandardArtifactDirPath(path: string): boolean {
  return (
    isPathInStandardDir(path, "skills")
    || isPathInStandardDir(path, "scripts")
    || isPathInStandardDir(path, "flows")
    || isPathInStandardDir(path, "cases")
  );
}

function isStandardTreeRootDir(dir: string): boolean {
  return ["original", "skills", "scripts", "flows", "cases", "data"].includes(dir);
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
                <span className={styles.treeNodeText}>{node.title}</span>
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

export default function ProjectOverviewCard({
  selectedProject,
  projectFileCount: _projectFileCount,
  pipelineTemplateCount: _pipelineTemplateCount,
  pipelineRunCount,
  projectWorkspaceSummary,
  projectFiles,
  priorityFilePaths,
  selectedFilePath,
  selectedAttachPaths,
  hideBuiltInFiles,
  onUploadFiles,
  onSelectFileFromTree,
  onAttachArtifactToChat,
  onToggleHideBuiltInFiles,
}: ProjectOverviewCardProps) {
  void _projectFileCount;
  void _pipelineTemplateCount;
  const { t } = useTranslation();
  const [workspaceSummaryExpanded, setWorkspaceSummaryExpanded] = useState(false);
  const [selectedMetricFilter, setSelectedMetricFilter] = useState<FileMetricFilterKey | "">("");
  const updatedDateParts = formatUpdatedDateParts(selectedProject?.updated_time);

  const visibleFiles = hideBuiltInFiles
    ? projectFiles.filter((item) => !isBuiltInProjectFile(item.path))
    : projectFiles;
  const attachTitle = t("projects.chat.addAttachment", "Add to chat attachments");
  const detachTitle = t("projects.chat.removeAttachment", "Remove from chat attachments");
  const priorityFileSet = new Set(priorityFilePaths);
  const selectedAttachSet = new Set(selectedAttachPaths);
  const artifactProfile = selectedProject?.artifact_profile;
  const artifactCounts = {
    skills: artifactProfile?.skills.length || 0,
    scripts: artifactProfile?.scripts.length || 0,
    flows: artifactProfile?.flows.length || 0,
    cases: artifactProfile?.cases.length || 0,
  };
  const normalizedVisibleFiles = visibleFiles.map((item) => normalizeProjectPath(item.path));
  const originalFileCount = normalizedVisibleFiles.filter((path) => isOriginalInputFile(path)).length;
  const derivedFileCount = normalizedVisibleFiles.filter(
    (path) => !isOriginalInputFile(path) && !isStandardArtifactDirPath(path),
  ).length;
  const filteredFiles = visibleFiles.filter((item) => {
    const normalizedPath = normalizeProjectPath(item.path);
    switch (selectedMetricFilter) {
      case "original":
        return isOriginalInputFile(normalizedPath);
      case "derived":
        return !isOriginalInputFile(normalizedPath) && !isStandardArtifactDirPath(normalizedPath);
      case "skills":
        return isPathInStandardDir(normalizedPath, "skills");
      case "scripts":
        return isPathInStandardDir(normalizedPath, "scripts");
      case "flows":
        return isPathInStandardDir(normalizedPath, "flows");
      case "cases":
        return isPathInStandardDir(normalizedPath, "cases");
      default:
        return true;
    }
  });
  const filteredFilePaths = filteredFiles.map((item) => item.path);
  const treeData = buildFileTree(
    filteredFilePaths,
    priorityFileSet,
    selectedAttachSet,
    onAttachArtifactToChat,
    attachTitle,
    detachTitle,
  );
  const selectedFilterLabel =
    selectedMetricFilter === "original"
      ? t("projects.filesOriginal", "Original Files")
      : selectedMetricFilter === "derived"
        ? t("projects.filesDerived", "Derived Files")
        : selectedMetricFilter === "skills"
          ? t("projects.artifacts.skill", "Skills")
          : selectedMetricFilter === "scripts"
            ? t("projects.artifacts.script", "Scripts")
            : selectedMetricFilter === "flows"
              ? t("projects.artifacts.flow", "Flows")
              : selectedMetricFilter === "cases"
                ? t("projects.artifacts.case", "Cases")
                : "";

  useEffect(() => {
    if (!selectedMetricFilter) {
      return;
    }
    if (filteredFilePaths.length === 0) {
      return;
    }
    if (!selectedFilePath) {
      onSelectFileFromTree(filteredFilePaths[0]);
    }
  }, [filteredFilePaths, onSelectFileFromTree, selectedFilePath, selectedMetricFilter]);

  const metricCards: Array<{ key: FileMetricFilterKey; label: string; value: number }> = [
    {
      key: "original",
      label: t("projects.filesOriginal", "Original Files"),
      value: originalFileCount,
    },
    {
      key: "derived",
      label: t("projects.filesDerived", "Derived Files"),
      value: derivedFileCount,
    },
    {
      key: "skills",
      label: t("projects.artifacts.skill", "Skills"),
      value: artifactCounts.skills,
    },
    {
      key: "scripts",
      label: t("projects.artifacts.script", "Scripts"),
      value: artifactCounts.scripts,
    },
    {
      key: "flows",
      label: t("projects.artifacts.flow", "Flows"),
      value: artifactCounts.flows,
    },
    {
      key: "cases",
      label: t("projects.artifacts.case", "Cases"),
      value: artifactCounts.cases,
    },
  ];

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
                    setSelectedMetricFilter((prev) => (prev === item.key ? "" : item.key));
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
          {selectedFilterLabel ? (
            <div className={styles.treeFilterIndicator}>
              <Text type="secondary" className={styles.itemMeta}>
                {t("projects.workspaceSummaryFilterLabel", "Current filter: {{label}}", {
                  label: selectedFilterLabel,
                })}
              </Text>
            </div>
          ) : null}
          <div className={styles.overviewTreeToolbar}>
            <Text type="secondary" className={styles.itemMeta}>
              {t("projects.artifacts.hideBuiltins", "Hide built-in files")}
            </Text>
            <Button
              size="small"
              type={hideBuiltInFiles ? "default" : "text"}
              onClick={() => onToggleHideBuiltInFiles(!hideBuiltInFiles)}
            >
              {hideBuiltInFiles ? t("common.on", "On") : t("common.off", "Off")}
            </Button>
          </div>
          {treeData.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                selectedFilterLabel
                  ? t("projects.noFilteredFiles", "No related files under the current filter")
                  : t("projects.noFiles", "No files in this project")
              }
            />
          ) : (
            <Tree
              className={styles.overviewCompactTree}
              selectedKeys={selectedFilePath && filteredFilePaths.includes(selectedFilePath) ? [selectedFilePath] : []}
              treeData={treeData}
              onSelect={(keys) => {
                const key = String(keys[0] || "");
                if (key) {
                  onSelectFileFromTree(key);
                }
              }}
            />
          )}
        </div>

        <div className={styles.overviewActions}>
          <Button onClick={onUploadFiles}>{t("projects.upload.button", "Upload Files")}</Button>
        </div>
      </div>
    </Card>
  );
}