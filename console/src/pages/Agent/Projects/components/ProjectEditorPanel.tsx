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
  useCodingTabsStore,
  useTabsForScope,
  useActiveTabPathForScope,
} from "../../../../stores/codingTabsStore";
import { agentFilesScopeKey } from "../../../../features/files-workspace/filesWorkspaceScope";
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

  // Use the shared coding tabs store, keyed by the upstream files-workspace
  // scope key so project tabs persist under the agent bucket.
  const { selectedAgent } = useAgentStore();
  const scopeKey = agentFilesScopeKey({ kind: "agent", agentId: selectedAgent });
  const tabs = useTabsForScope(scopeKey);
  const activeTabPath = useActiveTabPathForScope(scopeKey);
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
      setActiveTab(scopeKey, selectedFilePath);
      return;
    }

    const content = loadFileContent(selectedFilePath);
    if (content === undefined || content.startsWith("Unable to preview")) {
      // File content not yet available; the ProjectDetailPage's useEffect
      // will trigger loadFileContent and we'll open it then.
      return;
    }

    openedFilesRef.current.add(selectedFilePath);
    openTab(scopeKey, { path: selectedFilePath, content, dirty: false });
    setActiveTab(scopeKey, selectedFilePath);
  }, [selectedFilePath, selectedAgent, scopeKey, projectWorkspaceFacade, loadFileContent, openTab, setActiveTab]);

  // When fileContent updates for the active tab, sync it
  useEffect(() => {
    if (!activeTabPath || !fileContent || !selectedAgent) return;
    const currentTab = tabs.find((t) => t.path === activeTabPath);
    if (currentTab && currentTab.content !== fileContent && !currentTab.dirty) {
      setTabContent(scopeKey, activeTabPath, fileContent);
    }
  }, [fileContent, activeTabPath, selectedAgent, scopeKey, tabs, setTabContent]);

  // Build project-scoped file operations for the TabbedEditor
  const projectLoadFile = useCallback(async (path: string) => {
    if (!projectWorkspaceFacade) return "";
    try {
      return (await projectWorkspaceFacade.readText(path)).content ?? "";
    } catch {
      return "";
    }
  }, [projectWorkspaceFacade]);

  const projectSaveFile = useCallback(async (path: string, content: string) => {
    if (!projectWorkspaceFacade) return;
    try {
      await projectWorkspaceFacade.writeText(path, content);
    } catch {
      // TabbedEditor keeps the tab dirty and surfaces the failure
    }
  }, [projectWorkspaceFacade]);

  const handleTabSelect = useCallback(
    (path: string) => setActiveTab(scopeKey, path),
    [scopeKey, setActiveTab],
  );

  const handleTabClose = useCallback(
    (path: string) => {
      const idx = tabs.findIndex((t) => t.path === path);
      closeTab(scopeKey, path);
      if (activeTabPath === path) {
        const fallback = tabs[idx + 1]?.path ?? tabs[idx - 1]?.path ?? "";
        setActiveTab(scopeKey, fallback);
      }
    },
    [tabs, activeTabPath, scopeKey, closeTab, setActiveTab],
  );

  const handleTabCloseOthers = useCallback(
    (path: string) => {
      tabs.forEach((tab) => {
        if (tab.path !== path) closeTab(scopeKey, tab.path);
      });
      setActiveTab(scopeKey, path);
    },
    [tabs, scopeKey, closeTab, setActiveTab],
  );

  const handleTabDirtyChange = useCallback(
    (path: string, dirty: boolean) => setTabDirty(scopeKey, path, dirty),
    [scopeKey, setTabDirty],
  );

  const handleTabContentChange = useCallback(
    (path: string, content: string) => setTabContent(scopeKey, path, content),
    [scopeKey, setTabContent],
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
                scopeKey={scopeKey}
                onTabSelect={handleTabSelect}
                onTabClose={handleTabClose}
                onCloseOtherTabs={handleTabCloseOthers}
                onTabDirtyChange={handleTabDirtyChange}
                onTabContentChange={handleTabContentChange}
                onLoadFile={projectLoadFile}
                onSaveFile={projectSaveFile}
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
            scopeKey={scopeKey}
            onTabSelect={handleTabSelect}
            onTabClose={handleTabClose}
            onCloseOtherTabs={handleTabCloseOthers}
            onTabDirtyChange={handleTabDirtyChange}
            onTabContentChange={handleTabContentChange}
            onLoadFile={projectLoadFile}
            onSaveFile={projectSaveFile}
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
