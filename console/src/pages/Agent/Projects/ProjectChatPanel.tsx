import { Button, Card, Empty, Spin, Typography, message } from "antd";
import { useTranslation } from "react-i18next";
import AnywhereChat from "../../../components/AnywhereChat";
import styles from "./index.module.less";

const { Text } = Typography;

export interface ProjectChatAutoAttachRequest {
  id: string;
  mode?: "submit" | "draft";
  fileName?: string;
  content?: string;
  mimeType?: string;
  files?: Array<{
    fileName: string;
    content: string;
    mimeType?: string;
  }>;
  note?: string;
}

interface AutoAttachHandledPayload {
  id: string;
  ok: boolean;
}

export type ProjectChatMode = "workspace" | "design" | "run";

interface ProjectChatPanelProps {
  projectFileCount: number;
  chatMode: ProjectChatMode;
  selectedRunId: string;
  chatStarting: boolean;
  activeWorkspaceChatId: string;
  activeDesignChatId: string;
  activeRunChatId: string;
  autoAttachRequest: ProjectChatAutoAttachRequest | null;
  onAutoAttachHandled: (payload: AutoAttachHandledPayload) => void;
  onStartWorkspaceChat: () => void;
  onStartDesignChat: () => void;
  onStartRunChat: () => void;
  onSelectWorkspaceHistoryChat: (chatId: string) => void;
  onSelectDesignHistoryChat: (chatId: string) => void;
  onSelectRunHistoryChat: (chatId: string) => void;
  onOpenManualRecoverDialog?: () => void;
  onAssistantTurnCompleted?: () => void;
}

export default function ProjectChatPanel({
  projectFileCount,
  chatMode,
  selectedRunId,
  chatStarting,
  activeWorkspaceChatId,
  activeDesignChatId,
  activeRunChatId,
  autoAttachRequest,
  onAutoAttachHandled,
  onStartWorkspaceChat,
  onStartDesignChat,
  onStartRunChat,
  onSelectWorkspaceHistoryChat,
  onSelectDesignHistoryChat,
  onSelectRunHistoryChat,
  onOpenManualRecoverDialog,
  onAssistantTurnCompleted,
}: ProjectChatPanelProps) {
  const { t } = useTranslation();
  const hasUserFiles = projectFileCount > 0;
  const isRunMode = chatMode === "run";

  const handleAutoAttachHandled = (payload: AutoAttachHandledPayload) => {
    if (!payload.ok) {
      message.error(
        t("projects.chat.autoAttachFailed", "Failed to attach selected file to chat."),
      );
    }
    onAutoAttachHandled(payload);
  };

  return (
    <Card
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
      title={<span className={styles.sectionTitle}>{t("projects.chat.workspaceLabel", "Project collaboration")}</span>}
      styles={{
        body: {
          padding: 0,
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        },
      }}
      extra={
        <Text type="secondary" className={styles.panelExtraText}>
          {isRunMode && selectedRunId
            ? selectedRunId
            : t("projects.chat.workspaceLabel", "Project workspace")}
        </Text>
      }
    >
      <div className={styles.previewBody}>
        {chatStarting ? (
          <div className={styles.centerState}>
            <Spin />
          </div>
        ) : (
          (() => {
            if (chatMode === "run") {
              if (activeRunChatId) {
                return (
                  <div className={styles.chatPanel}>
                    <AnywhereChat
                      sessionId={activeRunChatId}
                      autoAttachRequest={autoAttachRequest}
                      onAutoAttachHandled={handleAutoAttachHandled}
                      onNewChat={onStartRunChat}
                      onSelectHistoryChat={onSelectRunHistoryChat}
                      historyMenuActionLabel={t("projects.chat.manualRecover", "手动恢复对话关联")}
                      onHistoryMenuAction={onOpenManualRecoverDialog}
                      onAssistantTurnCompleted={onAssistantTurnCompleted}
                      inputPlaceholder={t(
                        "projects.chat.placeholder",
                        "Describe what you want to adjust in this run, and I will help iterate.",
                      )}
                      welcomeGreeting={t(
                        "projects.chat.welcomeGreeting",
                        "Project run assistant is ready.",
                      )}
                      welcomeDescription={t(
                        "projects.chat.welcomeDescription",
                        "Discuss artifacts, metrics, and evidence for the selected run without leaving this page.",
                      )}
                      welcomePrompts={[
                        t(
                          "projects.chat.prompt1",
                          "Summarize the risks in this run and suggest next actions.",
                        ),
                        t(
                          "projects.chat.prompt2",
                          "Based on current evidence, propose a retry strategy for failed steps.",
                        ),
                      ]}
                    />
                  </div>
                );
              }

              return (
                <div className={styles.chatEmptyAction}>
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t("projects.chat.noSession", "No chat session for this run yet")}
                  >
                    <Button type="primary" onClick={onStartRunChat}>
                      {t("projects.chat.start", "Start chat")}
                    </Button>
                  </Empty>
                </div>
              );
            }

            if (chatMode === "design") {
              if (activeDesignChatId) {
                return (
                  <div className={styles.chatPanel}>
                    <AnywhereChat
                      sessionId={activeDesignChatId}
                      autoAttachRequest={autoAttachRequest}
                      onAutoAttachHandled={handleAutoAttachHandled}
                      onNewChat={onStartDesignChat}
                      onSelectHistoryChat={onSelectDesignHistoryChat}
                      historyMenuActionLabel={t("projects.chat.manualRecover", "手动恢复对话关联")}
                      onHistoryMenuAction={onOpenManualRecoverDialog}
                      onAssistantTurnCompleted={onAssistantTurnCompleted}
                      inputPlaceholder={t(
                        "projects.chat.designPlaceholder",
                        "Describe your target workflow and constraints, and I will draft/refine the project flow.",
                      )}
                      welcomeGreeting={t(
                        "projects.chat.designWelcomeGreeting",
                        "Project flow design assistant is ready.",
                      )}
                      welcomeDescription={t(
                        "projects.chat.designWelcomeDescription",
                        "Use this session to build a flow draft from your real project files before launching a run.",
                      )}
                      welcomePrompts={[
                        t(
                          "projects.chat.designPrompt1",
                          "Based on the current source files, propose a 4-step flow with clear inputs and outputs.",
                        ),
                        t(
                          "projects.chat.designPrompt2",
                          "Please optimize the flow for reliability and add retry policy suggestions.",
                        ),
                      ]}
                    />
                  </div>
                );
              }

                return (
                  <div className={styles.chatEmptyAction}>
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={t(
                        "projects.chat.noDesignSession",
                        "No design chat session yet.",
                      )}
                    >
                      <Button type="primary" onClick={onStartDesignChat}>
                        {t("projects.chat.start", "Start chat")}
                      </Button>
                    </Empty>
                  </div>
                );
            }

            if (activeWorkspaceChatId) {
              return (
                <div className={styles.chatPanel}>
                  <AnywhereChat
                    sessionId={activeWorkspaceChatId}
                    autoAttachRequest={autoAttachRequest}
                    onAutoAttachHandled={handleAutoAttachHandled}
                    onNewChat={onStartWorkspaceChat}
                    onSelectHistoryChat={onSelectWorkspaceHistoryChat}
                    historyMenuActionLabel={t("projects.chat.manualRecover", "手动恢复对话关联")}
                    onHistoryMenuAction={onOpenManualRecoverDialog}
                    onAssistantTurnCompleted={onAssistantTurnCompleted}
                    welcomePromptClickBehavior="append"
                    inputPlaceholder={t(
                      "projects.chat.collaborationPlaceholder",
                      "Describe the project goal, current materials, or the next thing you want to move forward.",
                    )}
                    welcomeGreeting={t(
                      "projects.chat.collaborationWelcomeGreeting",
                      "Project collaboration assistant is ready.",
                    )}
                    welcomeDescription={t(
                      hasUserFiles
                        ? "projects.chat.collaborationWelcomeDescription"
                        : "projects.chat.collaborationWelcomeDescriptionEmptyProject",
                      hasUserFiles
                        ? "Use this space to understand the project, organize materials, and plan the next step. In your first reply, confirm workspace root and path mapping (original/* -> data/*) before drafting actions."
                        : "This is a new project. Start by clarifying goals, scope, and expected outcomes, then confirm workspace root and path mapping before preparing the first batch of materials.",
                    )}
                    welcomePromptsWhenEmpty={[
                      t(
                        hasUserFiles
                          ? "projects.chat.collaborationPromptEmpty1"
                          : "projects.chat.collaborationPromptEmptyNewProject1",
                        hasUserFiles
                          ? "First confirm workspace root and map original/* to data/*. Then help me clarify this project's goal, current stage, and expected deliverable."
                          : "This is a new project. First confirm workspace root and path mapping, then help me define goal, scope, milestones, and acceptance criteria.",
                      ),
                      t(
                        hasUserFiles
                          ? "projects.chat.collaborationPromptEmpty2"
                          : "projects.chat.collaborationPromptEmptyNewProject2",
                        hasUserFiles
                          ? "I have provided materials. Summarize current state with exact file paths, point out missing information, and avoid guessing non-existent paths."
                          : "Give me a from-zero-to-one kickoff checklist with the first three actions, and include where each artifact should be stored (skills/scripts/flows/cases).",
                      ),
                    ]}
                  />
                </div>
              );
            }

            return (
              <div className={styles.chatEmptyAction}>
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t(
                      "projects.chat.noWorkspaceSession",
                      "No project collaboration session yet.",
                  )}
                  >
                    <Button type="primary" onClick={onStartWorkspaceChat}>
                      {t("projects.chat.start", "Start chat")}
                    </Button>
                  </Empty>
              </div>
            );
          })()
        )}

      </div>
    </Card>
  );
}