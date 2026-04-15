import {
  ApartmentOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  CopyOutlined,
  DatabaseOutlined,
  FileMarkdownOutlined,
  FileOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  LeftOutlined,
  RightOutlined,
  RobotOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { Badge, Button, Menu } from "antd";
import type { MenuProps } from "antd";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectFileFilterKey } from "./filtering";
import type { ProjectStageKey } from "./projectLayoutPrefs";
import styles from "./index.module.less";

type StageCounts = {
  source: number;
  knowledge: number;
  output: number;
  outputRuns: number;
  builtin: number;
};

type LeafCounts = {
  original: number;
  intermediate: number;
  artifact: number;
  markdown: number;
  text: number;
  script: number;
  otherType: number;
  agent: number;
  skill: number;
  flow: number;
  case: number;
  builtin: number;
};

type StageLeafFilterItem = {
  key: ProjectFileFilterKey;
  label: string;
  count: number;
};

type StageLeafFilters = {
  source: StageLeafFilterItem[];
  knowledge: StageLeafFilterItem[];
  output: StageLeafFilterItem[];
  builtin: StageLeafFilterItem[];
};

interface ProjectStageMenuProps {
  isDark: boolean;
  leftPanelCollapsed: boolean;
  leftPanelExpandedMenuReady: boolean;
  activeStage: ProjectStageKey;
  selectedMetricFilter: ProjectFileFilterKey | "";
  stageCounts: StageCounts;
  leafCounts: LeafCounts;
  onToggleLeftPanel: () => void;
  onSelectStage: (stage: ProjectStageKey) => void;
  onSelectMetricFilter: (filter: ProjectFileFilterKey) => void;
}

function getLeafFilterIcon(filterKey: ProjectFileFilterKey) {
  switch (filterKey) {
    case "original":
      return <FolderOpenOutlined />;
    case "intermediate":
      return <FileOutlined />;
    case "artifact":
      return <CheckSquareOutlined />;
    case "markdown":
      return <FileMarkdownOutlined />;
    case "text":
      return <FileSearchOutlined />;
    case "script":
      return <CodeOutlined />;
    case "otherType":
      return <CopyOutlined />;
    case "agent":
      return <RobotOutlined />;
    case "skill":
      return <ToolOutlined />;
    case "flow":
      return <ApartmentOutlined />;
    case "case":
      return <CheckSquareOutlined />;
    case "builtin":
      return <FileOutlined />;
    default:
      return <FileOutlined />;
  }
}

export default function ProjectStageMenu({
  isDark,
  leftPanelCollapsed,
  leftPanelExpandedMenuReady,
  activeStage,
  selectedMetricFilter,
  stageCounts,
  leafCounts,
  onToggleLeftPanel,
  onSelectStage,
  onSelectMetricFilter,
}: ProjectStageMenuProps) {
  const { t } = useTranslation();

  const stageLeafFilters = useMemo<StageLeafFilters>(
    () => ({
      source: [
        { key: "original", label: t("projects.filesOriginal", "Original Files"), count: leafCounts.original },
        { key: "intermediate", label: t("projects.filesIntermediate", "Intermediate Files"), count: leafCounts.intermediate },
        { key: "artifact", label: t("projects.filesArtifact", "Artifact Files"), count: leafCounts.artifact },
      ],
      knowledge: [
        { key: "markdown", label: t("projects.quantMarkdownFiles", "Markdown"), count: leafCounts.markdown },
        { key: "text", label: t("projects.quantTextFiles", "文本文件"), count: leafCounts.text },
        { key: "script", label: t("projects.quantScriptFiles", "脚本 (.py)"), count: leafCounts.script },
        { key: "otherType", label: t("projects.quantOtherTypeFiles", "其他类型"), count: leafCounts.otherType },
      ],
      output: [
        { key: "agent", label: t("projects.filesAgent", "智能体"), count: leafCounts.agent },
        { key: "skill", label: t("projects.filesSkill", "技能"), count: leafCounts.skill },
        { key: "flow", label: t("projects.filesFlow", "流程"), count: leafCounts.flow },
        { key: "case", label: t("projects.filesCase", "案例"), count: leafCounts.case },
      ],
      builtin: [
        { key: "builtin", label: t("projects.filesBuiltIn", "Built-in Files"), count: leafCounts.builtin },
      ],
    }),
    [leafCounts, t],
  );

  const filterToStageMap = useMemo<Record<ProjectFileFilterKey, ProjectStageKey>>(
    () => ({
      original: "source",
      intermediate: "source",
      artifact: "source",
      markdown: "knowledge",
      text: "knowledge",
      script: "knowledge",
      otherType: "knowledge",
      agent: "output",
      skill: "output",
      flow: "output",
      case: "output",
      builtin: "builtin",
    }),
    [],
  );

  const stageMenuItems = useMemo<MenuProps["items"]>(
    () => [
      {
        key: "stage:source",
        icon: <FileSearchOutlined />,
        label: (
          <span className={styles.stageMenuLabel}>
            <span>{t("projects.stage.source", "Source")}</span>
            <span
              className={`${styles.stageMenuCount} ${activeStage === "source" ? styles.stageMenuCountActive : styles.stageMenuCountMuted}`}
            >
              {stageCounts.source}
            </span>
          </span>
        ),
        children: stageLeafFilters.source.map((item) => ({
          key: item.key,
          icon: getLeafFilterIcon(item.key),
          label: (
            <span className={styles.stageLeafMenuLabel}>
              <span>{item.label}</span>
              <span
                className={`${styles.stageLeafMenuCount} ${selectedMetricFilter === item.key ? styles.stageLeafMenuCountActive : styles.stageLeafMenuCountMuted}`}
              >
                {item.count}
              </span>
            </span>
          ),
        })),
      },
      {
        key: "stage:knowledge",
        icon: <DatabaseOutlined />,
        label: (
          <span className={styles.stageMenuLabel}>
            <span>{t("projects.stage.fileTypes", "文件类型")}</span>
            <span
              className={`${styles.stageMenuCount} ${activeStage === "knowledge" ? styles.stageMenuCountActive : styles.stageMenuCountMuted}`}
            >
              {stageCounts.knowledge}
            </span>
          </span>
        ),
        children: stageLeafFilters.knowledge.map((item) => ({
          key: item.key,
          icon: getLeafFilterIcon(item.key),
          label: (
            <span className={styles.stageLeafMenuLabel}>
              <span>{item.label}</span>
              <span
                className={`${styles.stageLeafMenuCount} ${selectedMetricFilter === item.key ? styles.stageLeafMenuCountActive : styles.stageLeafMenuCountMuted}`}
              >
                {item.count}
              </span>
            </span>
          ),
        })),
      },
      {
        key: "group:output",
        type: "group",
        label: (
          <span className={styles.stageMenuLabel}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <ApartmentOutlined />
              <span>{t("projects.stage.projectFiles", "项目文件")}</span>
            </span>
            <span
              className={`${styles.stageMenuCount} ${activeStage === "output" ? styles.stageMenuCountActive : styles.stageMenuCountMuted}`}
            >
              {stageCounts.outputRuns || stageCounts.output}
            </span>
          </span>
        ),
        children: stageLeafFilters.output.map((item) => ({
          key: item.key,
          icon: getLeafFilterIcon(item.key),
          label: (
            <span className={styles.stageLeafMenuLabel}>
              <span>{item.label}</span>
              <span
                className={`${styles.stageLeafMenuCount} ${selectedMetricFilter === item.key ? styles.stageLeafMenuCountActive : styles.stageLeafMenuCountMuted}`}
              >
                {item.count}
              </span>
            </span>
          ),
        })),
      },
      {
        key: "stage:builtin",
        icon: <FileOutlined />,
        label: (
          <span className={styles.stageMenuLabel}>
            <span>{t("projects.stage.builtin", "Built-in")}</span>
            <span
              className={`${styles.stageMenuCount} ${activeStage === "builtin" ? styles.stageMenuCountActive : styles.stageMenuCountMuted}`}
            >
              {stageCounts.builtin}
            </span>
          </span>
        ),
        children: stageLeafFilters.builtin.map((item) => ({
          key: item.key,
          icon: getLeafFilterIcon(item.key),
          label: (
            <span className={styles.stageLeafMenuLabel}>
              <span>{item.label}</span>
              <span
                className={`${styles.stageLeafMenuCount} ${selectedMetricFilter === item.key ? styles.stageLeafMenuCountActive : styles.stageLeafMenuCountMuted}`}
              >
                {item.count}
              </span>
            </span>
          ),
        })),
      },
    ],
    [activeStage, selectedMetricFilter, stageCounts, stageLeafFilters, t],
  );

  const renderCollapsedLeafIcon = (itemKey: ProjectFileFilterKey, itemCount: number) => {
    const isActive = selectedMetricFilter === itemKey;
    if (itemCount > 0) {
      return (
        <Badge
          count={itemCount}
          size="small"
          overflowCount={99}
          offset={[4, -1]}
          className={`${styles.collapsedLeafBadge} ${isActive ? styles.collapsedLeafBadgeActive : styles.collapsedLeafBadgeMuted}`}
          styles={{
            indicator: {
              minWidth: 14,
              width: "auto",
              height: 14,
              lineHeight: "14px",
              padding: "0 2px",
              fontSize: 8,
              fontWeight: 600,
              color: isActive ? "#ffffff" : "#5f7fc7",
              background: isActive ? "#2f66e8" : "#eef3ff",
              border: isActive ? "1px solid #ffffff" : "1px solid #d4def8",
              boxShadow: isActive ? "0 1px 2px rgba(15, 23, 42, 0.16)" : "none",
            },
          }}
        >
          <span className={styles.collapsedLeafIconWrap}>{getLeafFilterIcon(itemKey)}</span>
        </Badge>
      );
    }
    return (
      <Badge
        dot
        offset={[2, -1]}
        className={`${styles.collapsedLeafBadgeDot} ${isActive ? styles.collapsedLeafBadgeDotActive : styles.collapsedLeafBadgeDotMuted}`}
      >
        <span className={styles.collapsedLeafIconWrap}>{getLeafFilterIcon(itemKey)}</span>
      </Badge>
    );
  };

  const collapsedLeafMenuItems = useMemo<MenuProps["items"]>(
    () => [
      ...stageLeafFilters.source.map((item) => ({
        key: item.key,
        icon: renderCollapsedLeafIcon(item.key, item.count),
        label: item.label,
      })),
      ...stageLeafFilters.knowledge.map((item) => ({
        key: item.key,
        icon: renderCollapsedLeafIcon(item.key, item.count),
        label: item.label,
      })),
      ...stageLeafFilters.output.map((item) => ({
        key: item.key,
        icon: renderCollapsedLeafIcon(item.key, item.count),
        label: item.label,
      })),
      ...stageLeafFilters.builtin.map((item) => ({
        key: item.key,
        icon: renderCollapsedLeafIcon(item.key, item.count),
        label: item.label,
      })),
    ],
    [selectedMetricFilter, stageLeafFilters],
  );

  const showExpandedStageMenu = !leftPanelCollapsed && leftPanelExpandedMenuReady;
  const stageMenuOpenKeys = useMemo(
    () => (showExpandedStageMenu ? ["stage:source", "stage:knowledge", "stage:builtin"] : []),
    [showExpandedStageMenu],
  );

  return (
    <div className={`${styles.leftStageRail} ${leftPanelCollapsed ? styles.leftStageRailCollapsed : ""}`}>
      <Button
        size="small"
        block
        className={styles.leftRailToggle}
        icon={leftPanelCollapsed ? <RightOutlined /> : <LeftOutlined />}
        onClick={onToggleLeftPanel}
        title={leftPanelCollapsed
          ? t("projects.layout.expandLeft", "Expand left panel")
          : t("projects.layout.collapseLeft", "Collapse left panel")}
      />
      <Menu
        mode="inline"
        className={styles.leftStageMenu}
        theme={isDark ? "dark" : "light"}
        inlineCollapsed={!showExpandedStageMenu}
        items={showExpandedStageMenu ? stageMenuItems : collapsedLeafMenuItems}
        selectedKeys={selectedMetricFilter ? [selectedMetricFilter] : []}
        openKeys={stageMenuOpenKeys}
        onClick={({ key }) => {
          const keyValue = String(key);
          if (keyValue === "stage:source") {
            onSelectStage("source");
            return;
          }
          if (keyValue === "stage:knowledge") {
            onSelectStage("knowledge");
            return;
          }
          if (keyValue === "group:output" || keyValue === "stage:output") {
            onSelectStage("output");
            return;
          }
          if (keyValue === "stage:builtin") {
            onSelectStage("builtin");
            return;
          }
          const nextFilter = keyValue as ProjectFileFilterKey;
          onSelectMetricFilter(nextFilter);
          const nextStage = filterToStageMap[nextFilter];
          if (nextStage) {
            onSelectStage(nextStage);
          }
        }}
      />
    </div>
  );
}
