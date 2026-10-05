/**
 * ProjectEditorPanel – wraps TabbedEditor with project-scoped file
 * operations and the document knowledge visualization sidebar.
 *
 * Layout:
 *   ┌──────────────────────────────────────┬──────────────────────┐
 *   │        TabbedEditor                  │    Knowledge         │
 *   │  (Monaco editor + FilePreview)       │    Visualization     │
 *   │                                      │    (侧边面板)        │
 *   ├──────────────────────────────────────┴──────────────────────┤
 *   │  Floating Attach Bar (send selected files to chat)          │
 *   └─────────────────────────────────────────────────────────────┘
 */

import { Checkbox, Button, Splitter, Typography } from "antd";
import { SendOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import TabbedEditor from "../../../Coding/TabbedEditor";
import ProjectDocumentKnowledgeVisualization from "./ProjectDocumentKnowledgeVisualization";
import {
  useCurrentTabs,
  useCurrentActiveTabPath,
  useCodingTabsStore,
} from "../../../../stores/codingTabsStore";
import { useAgentStore } from "../../../../stores/agentStore";
import type { ProjectWorkspaceFacade } from "../hooks/useProjectWorkspaceFacade";
import type { ProjectKnowledgeState } from "../hooks/useProjectKnowledgeState";
import { shouldHideKnowledgeVisualization } from "../utils/projectFileSelectionUtils";
import styles from "../index.module.less";

const { Text } = Typography;

interface ProjectEditorPanelProps {
  projectWorkspaceFacade: ProjectWorkspaceFacade;
  selectedFilePath: string;
  fileContent: string;
  charStatsContent: string;
  nerStructuredContent: string;
  selectedAttachPaths: string[];
  autoAnalyzeOnAttach: boolean;
  sendingSelectedFiles: boolean;
  knowledgeState: ProjectKnowledgeState;
  onToggleAutoAnalyze: (value: boolean) => void;
  onSendSelectedFilesToChat: () => void;
  loadFileContent: (path: string) => string | undefined;
}

export default function ProjectEditorPanel({
  projectWorkspaceFacade,
  selectedFilePath,
  fileContent,
  charStatsContent,
  nerStructuredContent,
  selectedAttachPaths,
  autoAnalyzeOnAttach,
  sendingSelectedFiles,
  knowledgeState,
  onToggleAutoAnalyze,
  onSendSelectedFilesToChat,
  loadFileContent,
}: ProjectEditorPanelProps) {
  const { t } = useTranslation();

  // Use the existing per-agent coding tabs store for tab state management.
  // This is safe because codingTabsStore is already keyed by agentId and
  // persists to localStorage. Project pages that switch agents will
  // automatically get the correct tab set.
  const { selectedAgent } = useAgentStore();
  const tabs = useCurrentTabs();
  const activeTabPath = useCurrentActiveTabPath();
  const {
    openTab,
    closeTab,
    setActiveTab,
    setTabContent,
    setTabDirty,
  } = useCodingTabsStore();

  // Track which files have been opened as tabs to avoid re-opening
  const openedFilesRef = useRef<Set<string>>(new Set());

  // When the selected file path changes, open it as a tab in the editor
  useEffect(() => {
    if (!selectedFilePath || !selectedAgent || !projectWorkspaceFacade) {
      return;
    }
    if (openedFilesRef.current.has(selectedFilePath)) {
      // File already opened — just switch to its tab
      setActiveTab(selectedAgent, selectedFilePath);
      return;
    }

    const content = loadFileContent(selectedFilePath);
    if (content === undefined || content.startsWith("Unable to preview")) {
      // File content not yet available; the ProjectDetailPage's useEffect
      // will trigger loadFileContent and we'll open it then.
      return;
    }

    openedFilesRef.current.add(selectedFilePath);
    openTab(selectedAgent, { path: selectedFilePath, content, dirty: false });
    setActiveTab(selectedAgent, selectedFilePath);
  }, [selectedFilePath, selectedAgent, projectWorkspaceFacade, loadFileContent, openTab, setActiveTab]);

  // When fileContent updates for the active tab, sync it
  useEffect(() => {
    if (!activeTabPath || !fileContent || !selectedAgent) return;
    const currentTab = tabs.find((t) => t.path === activeTabPath);
    if (currentTab && currentTab.content !== fileContent && !currentTab.dirty) {
      setTabContent(selectedAgent, activeTabPath, fileContent);
    }
  }, [fileContent, activeTabPath, selectedAgent, tabs, setTabContent]);

  // Build project-scoped file operations for the TabbedEditor
  const projectLoadFile = useCallback(async (path: string) => {
    if (!projectWorkspaceFacade) return { content: "" };
    try {
      return await projectWorkspaceFacade.readText(path);
    } catch {
      return { content: "" };
    }
  }, [projectWorkspaceFacade]);

  const projectSaveFile = useCallback(async (path: string, content: string) => {
    if (!projectWorkspaceFacade) return {};
    try {
      return await projectWorkspaceFacade.writeText(path, content);
    } catch {
      return {};
    }
  }, [projectWorkspaceFacade]);

  const handleTabSelect = useCallback(
    (path: string) => setActiveTab(selectedAgent, path),
    [selectedAgent, setActiveTab],
  );

  const handleTabClose = useCallback(
    (path: string) => {
      const idx = tabs.findIndex((t) => t.path === path);
      closeTab(selectedAgent, path);
      if (activeTabPath === path) {
        const fallback = tabs[idx + 1]?.path ?? tabs[idx - 1]?.path ?? "";
        setActiveTab(selectedAgent, fallback);
      }
    },
    [tabs, activeTabPath, selectedAgent, closeTab, setActiveTab],
  );

  const handleTabDirtyChange = useCallback(
    (path: string, dirty: boolean) => setTabDirty(selectedAgent, path, dirty),
    [selectedAgent, setTabDirty],
  );

  const handleTabContentChange = useCallback(
    (path: string, content: string) => setTabContent(selectedAgent, path, content),
    [selectedAgent, setTabContent],
  );

  const showKnowledgeVisualization = Boolean(
    selectedFilePath
    && !shouldHideKnowledgeVisualization(selectedFilePath)
    && knowledgeState,
  );

  const hasAttachments = selectedAttachPaths.length > 0;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        {showKnowledgeVisualization ? (
          <Splitter style={{ height: "100%" }}>
            <Splitter.Panel defaultSize="68%" min="45%" style={{ overflow: "hidden" }}>
              <TabbedEditor
                tabs={tabs}
                activeTabPath={activeTabPath}
                onTabSelect={handleTabSelect}
                onTabClose={handleTabClose}
                onTabDirtyChange={handleTabDirtyChange}
                onTabContentChange={handleTabContentChange}
                loadFile={projectLoadFile}
                saveFile={projectSaveFile}
              />
            </Splitter.Panel>
            <Splitter.Panel min="28%" style={{ overflow: "hidden" }}>
              <div className={styles.knowledgePreviewPane}>
                <div className={styles.knowledgePreviewHeader}>
                  <Text strong>
                    {t("projects.workbench.knowledgePreviewTitle")}
                  </Text>
                </div>
                <div className={styles.knowledgePreviewBody}>
                  <ProjectDocumentKnowledgeVisualization
                    selectedFilePath={selectedFilePath}
                    fileContent={fileContent}
                    charStatsContent={charStatsContent}
                    nerStructuredContent={nerStructuredContent}
                    knowledgeState={knowledgeState}
                  />
                </div>
              </div>
            </Splitter.Panel>
          </Splitter>
        ) : (
          <TabbedEditor
            tabs={tabs}
            activeTabPath={activeTabPath}
            onTabSelect={handleTabSelect}
            onTabClose={handleTabClose}
            onTabDirtyChange={handleTabDirtyChange}
            onTabContentChange={handleTabContentChange}
            loadFile={projectLoadFile}
            saveFile={projectSaveFile}
          />
        )}
      </div>

      {/* ── Floating attach bar ──────────────────────────────────────── */}
      {hasAttachments && (
        <div className={styles.attachFloatingBar}>
          <div className={styles.attachCountText}>
            {t("projects.chat.selectedCount", {
              count: selectedAttachPaths.length,
            })}
          </div>
          <Checkbox
            className={styles.attachAutoAnalyzeCheck}
            checked={autoAnalyzeOnAttach}
            onChange={(event) => onToggleAutoAnalyze(event.target.checked)}
          >
            {t("projects.chat.autoAnalyze")}
          </Checkbox>
          <Button
            type="primary"
            size="small"
            icon={<SendOutlined />}
            loading={sendingSelectedFiles}
            onClick={onSendSelectedFilesToChat}
          >
            {t("projects.chat.sendSelected")}
          </Button>
        </div>
      )}
    </div>
  );
}
