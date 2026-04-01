import {
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
  CodeOutlined,
} from "@ant-design/icons";
import { Button, Card, Empty, Tag, Tree, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type {
  ProjectArtifactItem,
  AgentProjectFileInfo,
  AgentProjectSummary,
  ProjectArtifactProfile,
} from "../../../api/types/agents";
import styles from "./index.module.less";
import type { ReactNode } from "react";
import ProjectArtifactProfileEditor from "./ProjectArtifactProfileEditor";

const { Text } = Typography;

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
  onStartCollaboration: () => void;
  onUploadFiles: () => void;
  onSelectFileFromTree: (path: string) => void;
  onAttachArtifactToChat: (path: string) => void;
  onToggleHideBuiltInFiles: (value: boolean) => void;
  artifactProfileSaving: boolean;
  distillingSkills: boolean;
  promotingSkillId: string;
  confirmingSkillId: string;
  onSaveArtifactProfile: (
    profile: ProjectArtifactProfile,
    distillMode: "file_scan" | "conversation_evidence",
  ) => Promise<void>;
  onAutoDistillSkills: () => Promise<void>;
  onConfirmArtifactSkillStable: (item: ProjectArtifactItem) => Promise<void>;
  onPromoteArtifactSkill: (item: ProjectArtifactItem) => Promise<void>;
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
    <span
      className={isPriority ? styles.priorityFileIcon : styles.treeNodeIconWrap}
    >
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
  const collapseDataRoot =
    paths.length > 0 &&
    paths.every((path) => {
      const parts = path.split("/").filter(Boolean);
      return parts.length > 1 && parts[0] === "data";
    });

  for (const path of paths) {
    const originalParts = path.split("/").filter(Boolean);
    const displayParts = collapseDataRoot ? originalParts.slice(1) : originalParts;
    let current = root;
    let originalPrefix = collapseDataRoot ? "data" : "";
    for (let index = 0; index < displayParts.length; index += 1) {
      const part = displayParts[index];
      const originalPart = originalParts[collapseDataRoot ? index + 1 : index];
      originalPrefix = originalPrefix
        ? `${originalPrefix}/${originalPart}`
        : originalPart;
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
  projectFileCount,
  pipelineTemplateCount,
  pipelineRunCount,
  projectWorkspaceSummary,
  projectFiles,
  priorityFilePaths,
  selectedFilePath,
  selectedAttachPaths,
  hideBuiltInFiles,
  onStartCollaboration,
  onUploadFiles,
  onSelectFileFromTree,
  onAttachArtifactToChat,
  onToggleHideBuiltInFiles,
  artifactProfileSaving,
  distillingSkills,
  promotingSkillId,
  confirmingSkillId,
  onSaveArtifactProfile,
  onAutoDistillSkills,
  onConfirmArtifactSkillStable,
  onPromoteArtifactSkill,
}: ProjectOverviewCardProps) {
  const { t } = useTranslation();
  const updatedDateParts = formatUpdatedDateParts(selectedProject?.updated_time);

  const visibleFiles = hideBuiltInFiles
    ? projectFiles.filter((item) => !isBuiltInProjectFile(item.path))
    : projectFiles;
  const attachTitle = t("projects.chat.addAttachment", "Add to chat attachments");
  const detachTitle = t("projects.chat.removeAttachment", "Remove from chat attachments");
  const priorityFileSet = new Set(priorityFilePaths);
  const selectedAttachSet = new Set(selectedAttachPaths);
  const treeData = buildFileTree(
    visibleFiles.map((item) => item.path),
    priorityFileSet,
    selectedAttachSet,
    onAttachArtifactToChat,
    attachTitle,
    detachTitle,
  );
  const artifactProfile = selectedProject?.artifact_profile;
  const artifactCounts = {
    skills: artifactProfile?.skills.length || 0,
    scripts: artifactProfile?.scripts.length || 0,
    flows: artifactProfile?.flows.length || 0,
    cases: artifactProfile?.cases.length || 0,
  };

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
          <div className={styles.overviewDescription}>
            {selectedProject?.description || t("projects.noDescription", "No description")}
          </div>
        </div>

        {(selectedProject?.tags || []).length > 0 && (
          <div className={styles.overviewSection}>
            <div className={styles.subSectionTitle}>{t("projects.tags", "Tags")}</div>
            <div className={styles.overviewTags}>
              {selectedProject?.tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </div>
          </div>
        )}

        <div className={styles.metricSummaryGrid}>
          <div className={styles.metricSummaryCard}>
            <div className={styles.itemMeta}>{t("projects.files", "Files")}</div>
            <div className={styles.metricSummaryValue}>{projectFileCount}</div>
          </div>
          <div className={styles.metricSummaryCard}>
            <div className={styles.itemMeta}>{t("projects.automation.flows", "Flows")}</div>
            <div className={styles.metricSummaryValue}>{pipelineTemplateCount}</div>
          </div>
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

        <div className={styles.overviewSection}>
          <div className={styles.subSectionTitle}>
            {t("projects.artifactArchitecture", "Product Artifacts")}
          </div>
          <div className={styles.overviewTags}>
            <Tag color="blue">
              {t("projects.artifacts.skill", "Skills")}: {artifactCounts.skills}
            </Tag>
            <Tag color="geekblue">
              {t("projects.artifacts.script", "Scripts")}: {artifactCounts.scripts}
            </Tag>
            <Tag color="purple">
              {t("projects.artifacts.flow", "Flows")}: {artifactCounts.flows}
            </Tag>
            <Tag color="gold">
              {t("projects.artifacts.case", "Cases")}: {artifactCounts.cases}
            </Tag>
          </div>
          <ProjectArtifactProfileEditor
            value={artifactProfile}
            distillMode={selectedProject?.artifact_distill_mode || "file_scan"}
            saving={artifactProfileSaving}
            distillingSkills={distillingSkills}
            promotingSkillId={promotingSkillId}
            confirmingSkillId={confirmingSkillId}
            onSave={onSaveArtifactProfile}
            onAutoDistillSkills={onAutoDistillSkills}
            onConfirmSkillStable={onConfirmArtifactSkillStable}
            onPromoteSkill={onPromoteArtifactSkill}
          />
        </div>

        <div className={styles.overviewSection}>
          <div className={styles.subSectionTitle}>{t("projects.workspaceSummary", "Workspace Snapshot")}</div>
          <pre className={styles.overviewSummary}>{projectWorkspaceSummary}</pre>
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
              description={t("projects.noFiles", "No files in this project")}
            />
          ) : (
            <Tree
              className={styles.overviewCompactTree}
              selectedKeys={selectedFilePath ? [selectedFilePath] : []}
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
          <Button type="primary" onClick={onStartCollaboration}>
            {t("projects.chat.startCollaboration", "Start project collaboration")}
          </Button>
          <Button onClick={onUploadFiles}>{t("projects.upload.button", "Upload Files")}</Button>
        </div>
      </div>
    </Card>
  );
}