import React from "react";
import { useChatAnywhereSessionsState } from "@agentscope-ai/chat";
import type { IAgentScopeRuntimeWebUISession } from "@agentscope-ai/chat";
import styles from "./index.module.less";

const ChatHeaderTitle: React.FC = () => {
  const { sessions, currentSessionId } = useChatAnywhereSessionsState();
  const currentSession = sessions.find(
    (s: IAgentScopeRuntimeWebUISession) => s.id === currentSessionId,
  );
  const chatName = currentSession?.name || "New Chat";

  return <span className={styles.chatName}>{chatName}</span>;
};

export default ChatHeaderTitle;
