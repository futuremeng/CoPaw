import { useCallback } from "react";
import { chatApi } from "../../../api/modules/chat";
import type {
  AgentProjectFileInfo,
  AgentProjectSummary,
  AgentSummary,
} from "../../../api/types/agents";
import type { ChatSpec } from "../../../api/types/chat";
import {
  isPreviewablePath,
  selectSeedSourceFiles,
} from "./projectFileSelectionUtils";

interface UseProjectDesignChatControllerParams {
  activeDesignChatId: string;
  currentAgent?: AgentSummary;
  selectedProject?: AgentProjectSummary;
  selectedTemplateId: string;
  selectedTemplateName: string;
  selectedTemplateVersion: string;
  resolvedProjectRequestId: string;
  projectFiles: AgentProjectFileInfo[];
  designFocusChatIdRef: React.MutableRefObject<string>;
  setDesignFocusChatId: (value: string) => void;
  setChatStarting: (value: boolean) => void;
  setError: (value: string) => void;
  startFailedText: string;
}

function buildProjectFlowWorkspaceRelativePath(projectId: string): string {
  return `projects/${projectId}/pipelines`;
}

function buildProjectFlowMemoryRelativePath(projectId: string): string {
  return `${buildProjectFlowWorkspaceRelativePath(projectId)}/flow-memory.md`;
}

function buildProjectFlowBindingKey(params: {
  projectId: string;
  templateId: string;
}): string {
  return `project-flow-design:${params.projectId}:${params.templateId || "draft"}`;
}

function getMetaString(meta: Record<string, unknown> | undefined, key: string): string {
  const value = meta?.[key];
  return typeof value === "string" ? value : "";
}

function sortChatsForRestore<T extends ChatSpec>(chats: T[]): T[] {
  const toMillis = (chat: ChatSpec): number => {
    const updatedTs = chat.updated_at ? Date.parse(chat.updated_at) : 0;
    if (Number.isFinite(updatedTs) && updatedTs > 0) {
      return updatedTs;
    }
    const createdTs = chat.created_at ? Date.parse(chat.created_at) : 0;
    return Number.isFinite(createdTs) ? createdTs : 0;
  };

  return [...chats].sort((a, b) => toMillis(b) - toMillis(a));
}

function pickLeafChatCandidates(chats: ChatSpec[]): ChatSpec[] {
  const parentIds = new Set(chats.map((chat) => chat.session_id).filter(Boolean) as string[]);
  const leaves = chats.filter((chat) => !parentIds.has(chat.id));
  return leaves.length > 0 ? leaves : chats;
}

async function pickChatWithHistory(chats: ChatSpec[]): Promise<string> {
  for (const chat of chats.slice(0, 10)) {
    try {
      const history = await chatApi.getChat(chat.id, { limit: 1 });
      if ((history.messages || []).length > 0) {
        return chat.id;
      }
    } catch {
      // Ignore unreadable chats and continue scanning recent candidates.
    }
  }

  return chats[0]?.id || "";
}

function buildProjectFlowBootstrapPrompt(params: {
  projectName: string;
  selectedTemplateName: string;
  flowMemoryPath: string;
  workspaceDir: string;
  sourceFiles: string[];
}): string {
  const seedFiles = selectSeedSourceFiles(params.sourceFiles);
  const fileLines = seedFiles.length
    ? seedFiles.map((file, index) => `${index + 1}. ${file}`).join("\n")
    : "- (source files will be uploaded next)";
  const shortageHint =
    seedFiles.length < 4
      ? `注意：当前仅检测到 ${seedFiles.length} 个候选源文件，请先按现有文件生成草案，并显式标注缺失输入。`
      : "";
  return [
    `你现在处于项目流程设计模式。项目：${params.projectName}`,
    `当前模板：${params.selectedTemplateName}`,
    `路径基准（workspace root）：${params.workspaceDir}`,
    "路径解析规则：以下 source files 与 flow memory path 均为相对路径，必须以 workspace root 为起点拼接后访问。",
    `flow memory path: ${params.flowMemoryPath}`,
    "请基于以下 4 个真实源文件，先给出可执行的 4~6 步流程草案，并为每步明确：inputs / outputs / depends_on / retry_policy。",
    "源文件列表：",
    fileLines,
    shortageHint,
    "输出要求：",
    "1) 先给流程总览；",
    "2) 再逐步给出结构化字段；",
    "3) 明确哪些是 source artifact、哪些是 intermediate、哪些是 final。",
  ].join("\n");
}

export default function useProjectDesignChatController({
  activeDesignChatId,
  currentAgent,
  selectedProject,
  selectedTemplateId,
  selectedTemplateName,
  selectedTemplateVersion,
  resolvedProjectRequestId,
  projectFiles,
  designFocusChatIdRef,
  setDesignFocusChatId,
  setChatStarting,
  setError,
  startFailedText,
}: UseProjectDesignChatControllerParams) {
  const resolveLatestDesignBoundChatId = useCallback(async (): Promise<string> => {
    if (!selectedProject || !currentAgent) {
      return "";
    }

    const templateId = selectedTemplateId || "draft";
    const bindingKey = buildProjectFlowBindingKey({
      projectId: selectedProject.id,
      templateId,
    });

    const chats = await chatApi.listChats({ user_id: "default", channel: "console" });
    const matched = chats.filter((chat) => {
      const meta =
        chat.meta && typeof chat.meta === "object"
          ? (chat.meta as Record<string, unknown>)
          : undefined;
      const metaType = getMetaString(meta, "focus_type") || getMetaString(meta, "binding_type");
      const metaKey =
        getMetaString(meta, "focus_binding_key") || getMetaString(meta, "pipeline_binding_key");
      const metaAgentId = getMetaString(meta, "agent_id");
      if (metaType !== "pipeline_edit" || metaKey !== bindingKey) {
        return false;
      }
      if (metaAgentId && metaAgentId !== currentAgent.id) {
        return false;
      }
      return true;
    });

    if (matched.length === 0) {
      const sessionPrefix = `project-flow-design-${selectedProject.id}-`;
      const bySession = chats.filter((chat) =>
        (chat.session_id || "").startsWith(sessionPrefix),
      );
      if (bySession.length > 0) {
        const sorted = sortChatsForRestore(pickLeafChatCandidates(bySession));
        return pickChatWithHistory(sorted);
      }
    }

    if (matched.length === 0) {
      return "";
    }

    const sorted = sortChatsForRestore(pickLeafChatCandidates(matched));
    return pickChatWithHistory(sorted);
  }, [currentAgent, selectedProject, selectedTemplateId]);

  const handleEnsureDesignChat = useCallback(async (
    forceNew = false,
    allowCreate = true,
  ): Promise<string> => {
    if (!selectedProject || !currentAgent) {
      return "";
    }

    if (!forceNew && activeDesignChatId) {
      return activeDesignChatId;
    }

    setChatStarting(true);
    try {
      const previousChatId = designFocusChatIdRef.current;
      if (forceNew && previousChatId) {
        void chatApi
          .clearChatMeta(previousChatId, {
            user_id: "default",
            channel: "console",
          })
          .catch(() => {});
      }

      const templateId = selectedTemplateId || "draft";
      const bindingKey = buildProjectFlowBindingKey({
        projectId: selectedProject.id,
        templateId,
      });
      const focusPath = buildProjectFlowWorkspaceRelativePath(selectedProject.id);
      const flowMemoryPath = buildProjectFlowMemoryRelativePath(selectedProject.id);

      if (!forceNew) {
        const restoredChatId = await resolveLatestDesignBoundChatId();
        if (restoredChatId) {
          setDesignFocusChatId(restoredChatId);
          setError("");
          return restoredChatId;
        }

        if (!allowCreate) {
          return "";
        }
      }

      const created = await chatApi.createChat({
        name: `[flow] ${selectedProject.name}`,
        session_id: `project-flow-design-${selectedProject.id}-${Date.now()}`,
        user_id: "default",
        channel: "console",
        meta: {
          focus_type: "pipeline_edit",
          focus_binding_key: bindingKey,
          focus_id: templateId,
          focus_path: focusPath,
          focus_scope: "project",
          focus_flow_memory_path: flowMemoryPath,
          // Legacy compatibility fields
          binding_type: "pipeline_edit",
          pipeline_binding_key: bindingKey,
          pipeline_id: templateId,
          pipeline_name: selectedTemplateName || selectedProject.name,
          pipeline_version: (selectedTemplateVersion || "0").trim() || "0",
          pipeline_scope: "project",
          agent_id: currentAgent.id,
          flow_memory_path: flowMemoryPath,
          project_id: selectedProject.id,
          project_request_id: resolvedProjectRequestId || selectedProject.id,
        },
      });

      setDesignFocusChatId(created.id);
      const sourceFiles = projectFiles
        .map((item) => item.path)
        .filter((item) => isPreviewablePath(item))
        .slice(0, 200);
      const bootstrapPrompt = buildProjectFlowBootstrapPrompt({
        projectName: selectedProject.name,
        selectedTemplateName: selectedTemplateName || selectedProject.name,
        flowMemoryPath,
        workspaceDir: selectedProject.workspace_dir || "",
        sourceFiles,
      });
      void chatApi
        .startConsoleChat({
          sessionId: created.session_id,
          prompt: bootstrapPrompt,
          userId: "default",
          channel: "console",
        })
        .catch((err) => {
          console.warn("failed to start design bootstrap prompt", err);
        });
      setError("");
      return created.id;
    } catch (err) {
      console.error("failed to create project flow design chat", err);
      setError(startFailedText);
      return "";
    } finally {
      setChatStarting(false);
    }
  }, [
    activeDesignChatId,
    currentAgent,
    designFocusChatIdRef,
    projectFiles,
    resolvedProjectRequestId,
    resolveLatestDesignBoundChatId,
    selectedProject,
    selectedTemplateId,
    selectedTemplateName,
    selectedTemplateVersion,
    setChatStarting,
    setDesignFocusChatId,
    setError,
    startFailedText,
  ]);

  return {
    handleEnsureDesignChat,
  };
}
