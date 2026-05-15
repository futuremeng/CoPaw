import React, { useCallback, useEffect, useRef, useState } from "react";
import { Drawer, Empty, Input, List, Spin, Typography } from "antd";
import type { InputRef } from "antd";
import { IconButton } from "@agentscope-ai/design";
import { SparkOperateRightLine, SparkSearchLine } from "@agentscope-ai/icons";
import { useTranslation } from "react-i18next";
import { chatApi } from "../../api/modules/chat";
import { splitHighlightSegments } from "./searchHighlight";
import styles from "./ChatSearchPanel.module.less";

interface ChatSearchPanelProps {
  open: boolean;
  onClose: () => void;
  onSelectChat?: (payload: {
    chatId: string;
    messageId?: string;
    query: string;
  }) => void;
}

interface SearchResult {
  chatId: string;
  messageId?: string;
  chatName: string;
  roleLabel: string;
  matchedText: string;
  timestamp?: string | null;
}

export function renderHighlightedText(text: string, query: string): React.ReactNode {
  const segments = splitHighlightSegments(text, query);
  if (segments.length === 1 && !segments[0].highlighted) {
    return segments[0].text;
  }

  return segments.map((segment, index) => {
    if (!segment.highlighted) {
      return segment.text;
    }
    return (
      <mark key={`mark-${index}`} className={styles.highlight}>
        {segment.text}
      </mark>
    );
  });
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return (content as Array<{ type?: string; text?: string }>)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text || "")
    .join("\n");
}

export function formatTimestamp(raw: string | null | undefined): string {
  if (!raw) {
    return "";
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const ChatSearchPanel: React.FC<ChatSearchPanelProps> = ({
  open,
  onClose,
  onSelectChat,
}) => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchProgress, setSearchProgress] = useState("");
  const inputRef = useRef<InputRef>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return;
    }

    setSearchQuery("");
    setSearchResults([]);
    setSearchProgress("");
    setLoading(false);
  }, [open]);

  useEffect(() => {
    const seq = ++searchSeqRef.current;

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchProgress("");
      setLoading(false);
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setLoading(true);
      setSearchProgress("");

      try {
        const query = searchQuery.toLowerCase();
        const results: SearchResult[] = [];
        const chats = await chatApi.listChats({ user_id: "default", channel: "console" });

        if (seq !== searchSeqRef.current) {
          return;
        }

        const validChats = chats.filter((chat): chat is typeof chat & { id: string } => !!chat.id);

        for (let index = 0; index < validChats.length; index += 1) {
          if (seq !== searchSeqRef.current) {
            return;
          }

          const chat = validChats[index];
          const chatName = chat.name || t("chat.newChat", "New Chat");
          const timestamp = chat.updated_at || chat.created_at;
          setSearchProgress(`${index + 1}/${validChats.length}`);

          if (chatName.toLowerCase().includes(query)) {
            results.push({
              chatId: chat.id,
              chatName,
              roleLabel: t("chat.search.titleMatch", "Title"),
              matchedText: chatName,
              timestamp,
            });
          }

          try {
            const history = await chatApi.getChat(chat.id);
            if (seq !== searchSeqRef.current) {
              return;
            }

            for (const msg of history.messages || []) {
              const text = extractTextFromContent(msg.content);
              const lower = text.toLowerCase();
              if (!lower.includes(query)) {
                continue;
              }

              const matchIndex = lower.indexOf(query);
              const start = Math.max(0, matchIndex - 80);
              const end = Math.min(text.length, matchIndex + query.length + 80);
              const snippet = text.slice(start, end);

              results.push({
                chatId: chat.id,
                messageId: String(msg.id || ""),
                chatName,
                roleLabel:
                  msg.role === "user"
                    ? t("chat.search.userMessage", "User")
                    : t("chat.search.assistantMessage", "Assistant"),
                matchedText: start > 0 ? `...${snippet}` : snippet,
                timestamp,
              });
            }
          } catch (error) {
            console.warn("AnywhereChat: failed to search chat", chat.id, error);
          }

          if ((index + 1) % 5 === 0 || index === validChats.length - 1) {
            if (seq !== searchSeqRef.current) {
              return;
            }
            results.sort((a, b) => Date.parse(b.timestamp || "") - Date.parse(a.timestamp || ""));
            setSearchResults([...results]);
          }
        }
      } catch (error) {
        if (seq !== searchSeqRef.current) {
          return;
        }
        console.error("AnywhereChat: search failed", error);
        setSearchResults([]);
      } finally {
        if (seq === searchSeqRef.current) {
          setLoading(false);
          setSearchProgress("");
        }
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, t]);

  const handleResultClick = useCallback(
    (result: SearchResult) => {
      onSelectChat?.({
        chatId: result.chatId,
        messageId: result.messageId,
        query: searchQuery.trim(),
      });
      onClose();
    },
    [onClose, onSelectChat, searchQuery],
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      destroyOnClose
      placement="right"
      width={360}
      closable={false}
      title={null}
      styles={{
        header: { display: "none" },
        body: {
          padding: 0,
          display: "flex",
          flexDirection: "column",
          height: "100%",
          overflow: "hidden",
        },
        mask: { background: "transparent" },
      }}
      className={styles.drawer}
      rootClassName={styles.root}
    >
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerTitle}>{t("chat.search.title", "Search")}</span>
        </div>
        <div className={styles.headerRight}>
          <IconButton bordered={false} icon={<SparkOperateRightLine />} onClick={onClose} />
        </div>
      </div>

      <div className={styles.searchSection}>
        <Input
          ref={inputRef}
          placeholder={t("chat.search.placeholder", "Search conversations")}
          prefix={<SparkSearchLine style={{ color: "rgba(0,0,0,0.25)" }} />}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          allowClear
          className={styles.searchInput}
        />
      </div>

      {searchQuery.trim() ? (
        <div className={styles.resultsCount}>
          <Typography.Text type="secondary">
            {loading && searchProgress
              ? t("chat.search.searching", { progress: searchProgress })
              : loading
                ? t("chat.search.loading", "Searching...")
                : t("chat.search.resultsCount", { count: searchResults.length })}
          </Typography.Text>
        </div>
      ) : null}

      <div className={styles.listWrapper}>
        <div className={styles.topGradient} />
        <div className={styles.list}>
          {loading && searchResults.length === 0 ? (
            <div className={styles.loadingState}>
              <Spin />
            </div>
          ) : searchQuery.trim() && !loading && searchResults.length === 0 ? (
            <Empty description={t("chat.search.noResults", "No results")} style={{ marginTop: 40 }} />
          ) : (
            <List
              dataSource={searchResults}
              renderItem={(item) => (
                <div className={styles.searchResultItem} onClick={() => handleResultClick(item)}>
                  <div className={styles.resultHeader}>
                    <span className={styles.resultChatName}>{item.chatName}</span>
                    <span className={styles.resultRole}>{item.roleLabel}</span>
                  </div>
                  <div className={styles.resultContent}>
                    <Typography.Text ellipsis style={{ fontSize: 13 }}>
                      {renderHighlightedText(item.matchedText, searchQuery)}
                    </Typography.Text>
                  </div>
                  {item.timestamp ? (
                    <div className={styles.resultTime}>{formatTimestamp(item.timestamp)}</div>
                  ) : null}
                </div>
              )}
            />
          )}
        </div>
        <div className={styles.bottomGradient} />
      </div>
    </Drawer>
  );
};

export default ChatSearchPanel;
