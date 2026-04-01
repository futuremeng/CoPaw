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

interface ProjectChatPanelProps {
  projectFileCount: number;
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
}

export default function ProjectChatPanel({
  projectFileCount,
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
}: ProjectChatPanelProps) {
  const { t } = useTranslation();
  const hasUserFiles = projectFileCount > 0;

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
          {selectedRunId || t("projects.chat.workspaceLabel", "Project workspace")}
        </Text>
      }
    >
      <div className={styles.previewBody}>
        {!selectedRunId ? (
          chatStarting ? (
            <div className={styles.centerState}>
              <Spin />
            </div>
          ) : activeWorkspaceChatId ? (
            <div className={styles.chatPanel}>
              <AnywhereChat
                sessionId={activeWorkspaceChatId}
                autoAttachRequest={autoAttachRequest}
                onAutoAttachHandled={handleAutoAttachHandled}
                onNewChat={onStartWorkspaceChat}
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
                    ? "Use this space to understand the project, organize materials, and plan the next step before opening automation."
                    : "This is a new project. Start by clarifying goals, scope, and expected outcomes, then prepare the first batch of materials.",
                )}
                welcomePromptsWhenEmpty={[
                  t(
                    hasUserFiles
                      ? "projects.chat.collaborationPromptEmpty1"
                      : "projects.chat.collaborationPromptEmptyNewProject1",
                    hasUserFiles
                      ? "Help me clarify this project's goal, current stage, and expected deliverable."
                      : "This is a new project. Help me define the goal, scope, milestones, and acceptance criteria.",
                  ),
                  t(
                    hasUserFiles
                      ? "projects.chat.collaborationPromptEmpty2"
                      : "projects.chat.collaborationPromptEmptyNewProject2",
                    hasUserFiles
                      ? "I have provided materials. Summarize the current state and point out missing information."
                      : "Give me a from-zero-to-one kickoff checklist with the first three actions I can start today.",
                  ),
                ]}
                welcomePromptsWhenDraft={[
                  t(
                    "projects.chat.collaborationPrompt1",
                    "Summarize the current project based on the available files and highlight missing inputs.",
                  ),
                  t(
                    "projects.chat.collaborationPrompt2",
                    "Suggest the next three actions to move this project forward without assuming a fixed flow yet.",
                  ),
                ]}
              />
            </div>
          ) : activeDesignChatId ? (
            <div className={styles.chatPanel}>
              <AnywhereChat
                sessionId={activeDesignChatId}
                autoAttachRequest={autoAttachRequest}
                onAutoAttachHandled={handleAutoAttachHandled}
                onNewChat={onStartDesignChat}
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
          ) : (
            <div className={styles.chatEmptyAction}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t(
                  "projects.chat.initializingCollaboration",
                  "Preparing project collaboration session...",
                )}
              />
            </div>
          )
        ) : chatStarting ? (
          <div className={styles.centerState}>
            <Spin />
          </div>
        ) : activeRunChatId ? (
          <div className={styles.chatPanel}>
            <AnywhereChat
              sessionId={activeRunChatId}
              autoAttachRequest={autoAttachRequest}
              onAutoAttachHandled={handleAutoAttachHandled}
              onNewChat={onStartRunChat}
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
        ) : (
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
        )}
      </div>
    </Card>
  );
}