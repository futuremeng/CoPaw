import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Tag,
  message,
} from "@agentscope-ai/design";
import { Divider, Progress, Space, Spin, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import {
  DatabaseOutlined,
  DownloadOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import api from "../../../api";
import { getApiToken, getApiUrl } from "../../../api/config";
import type {
  AgentsRunningConfig,
  KnowledgeConfig,
  KnowledgeHistoryBackfillProgress,
  KnowledgeHistoryBackfillStatus,
  KnowledgeSearchHit,
  KnowledgeSourceContent,
  KnowledgeSourceItem,
  KnowledgeSourceSpec,
  KnowledgeSourceType,
  GraphQueryRecord,
  GraphQueryResponse,
} from "../../../api/types";
import { MarkdownCopy } from "../../../components/MarkdownCopy/MarkdownCopy";
import {
  computeKnowledgeQuantMetrics,
  getKnowledgeQuantStatusLabel,
  summarizeRemoteRetryResults,
} from "./metrics";
import { buildUnifiedBatchProgress } from "./progress";
import { buildKnowledgeQuantCardViewModels } from "./quantCards";
import { buildRemoteRetryNotice, collectRemoteRetrySources } from "./remoteRetry";
import { recordsToVisualizationData, formatScore } from "./graphQuery";
import { GraphQueryResults, GraphVisualization } from "./graphVisualization";
import styles from "./index.module.less";

const SOURCE_TYPE_OPTIONS: Array<{
  label: string;
  value: KnowledgeSourceType;
}> = [
  { label: "File", value: "file" },
  { label: "Directory", value: "directory" },
  { label: "URL", value: "url" },
  { label: "Text", value: "text" },
  { label: "Chat", value: "chat" },
];

type SourceOriginFilter = "all" | "manual" | "auto";

function safeGraphNodeId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function extractHopNodeId(rawObject: string): string {
  const head = rawObject.split(";")[0]?.trim() || "";
  return safeGraphNodeId(head.replace(/--\[[^\]]+\]--/g, " "));
}

function inferSourceOrigin(source: KnowledgeSourceItem): Exclude<
  SourceOriginFilter,
  "all"
> {
  const tags = source.tags || [];
  const isAuto =
    tags.includes("auto") ||
    tags.includes("origin:auto") ||
    source.id.startsWith("auto-");
  return isAuto ? "auto" : "manual";
}

function getSourceOriginText(
  source: KnowledgeSourceItem,
  t: (key: string) => string,
): string {
  const origin = inferSourceOrigin(source);
  return origin === "manual"
    ? t("knowledge.originManual")
    : t("knowledge.originAuto");
}

function formatRemoteStatus(
  source: KnowledgeSourceItem,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const state = source.status.remote_cache_state;
  if (!state) {
    return "";
  }
  if (state === "cached") {
    return t("knowledge.remoteStateCached");
  }
  if (state === "waiting_retry") {
    return t("knowledge.remoteStateWaitingRetry", {
      time: source.status.remote_next_retry_at || "-",
    });
  }
  if (state === "ready_retry") {
    return t("knowledge.remoteStateReadyRetry");
  }
  if (state === "missing") {
    return t("knowledge.remoteStateMissing");
  }
  return t("knowledge.remoteStateUnknown");
}

function KnowledgePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [form] = Form.useForm<KnowledgeSourceSpec>();
  const [enableConfigForm] = Form.useForm<AgentsRunningConfig>();
  const [config, setConfig] = useState<KnowledgeConfig | null>(null);
  const [runningConfig, setRunningConfig] = useState<AgentsRunningConfig | null>(
    null,
  );
  const knowledgeRuntimeEnabled = runningConfig?.knowledge_enabled ?? true;
  const knowledgePageDisabled = !knowledgeRuntimeEnabled;
  const [backfillStatus, setBackfillStatus] =
    useState<KnowledgeHistoryBackfillStatus | null>(null);
  const [backfillProgress, setBackfillProgress] =
    useState<KnowledgeHistoryBackfillProgress | null>(null);
  const [sources, setSources] = useState<KnowledgeSourceItem[]>([]);
  const [hits, setHits] = useState<KnowledgeSearchHit[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchTypeFilter, setSearchTypeFilter] = useState<
    KnowledgeSourceType | "all"
  >("all");
  const [searching, setSearching] = useState(false);
  const [sourceOriginFilter, setSourceOriginFilter] =
    useState<SourceOriginFilter>("all");
  const [sourceTypeFilter, setSourceTypeFilter] = useState<
    KnowledgeSourceType | "all"
  >("all");
  const [graphQueryText, setGraphQueryText] = useState("");
  const [graphQueryMode, setGraphQueryMode] = useState<"template" | "cypher">(
    "template",
  );
  const [graphQueryResults, setGraphQueryResults] =
    useState<GraphQueryResponse | null>(null);
  const [graphQueryLoading, setGraphQueryLoading] = useState(false);
  const [graphQueryError, setGraphQueryError] = useState<string | null>(null);
  const [graphQueryTopK, setGraphQueryTopK] = useState(20);
  const [graphQueryTimeoutSec, setGraphQueryTimeoutSec] = useState(20);
  const [graphQueryDatasetScopeText, setGraphQueryDatasetScopeText] = useState("");
  const [graphQueryClickedNode, setGraphQueryClickedNode] = useState<string | null>(null);
  const [graphQueryNodeDrawerOpen, setGraphQueryNodeDrawerOpen] =
    useState(false);
  const [graphQueryNodePath, setGraphQueryNodePath] = useState<string[]>([]);
  const [graphRelationPredicateFilter, setGraphRelationPredicateFilter] =
    useState<string>("all");
  const [graphRelationSortMode, setGraphRelationSortMode] = useState<
    "score_desc" | "score_asc" | "predicate_asc"
  >("score_desc");
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [enableModalOpen, setEnableModalOpen] = useState(false);
  const [enableModalNeedsBackfillChoice, setEnableModalNeedsBackfillChoice] =
    useState(false);
  const [enableModalSubmitting, setEnableModalSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [indexingAll, setIndexingAll] = useState(false);
  const [clearingKnowledge, setClearingKnowledge] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);
  const [exportingSourceId, setExportingSourceId] = useState<string | null>(null);
  const [importingBackup, setImportingBackup] = useState(false);
  const [indexingId, setIndexingId] = useState<string | null>(null);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [selectedSource, setSelectedSource] =
    useState<KnowledgeSourceItem | null>(null);
  const [sourceContent, setSourceContent] =
    useState<KnowledgeSourceContent | null>(null);
  const [sourceContentLoading, setSourceContentLoading] = useState(false);
  const [backfillingHistory, setBackfillingHistory] = useState(false);
  const [retryingRemoteSources, setRetryingRemoteSources] = useState(false);
  const [selectedType, setSelectedType] = useState<KnowledgeSourceType>("file");
  const [isFileDragActive, setIsFileDragActive] = useState(false);
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(null);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [selectedDirectoryFiles, setSelectedDirectoryFiles] = useState<
    Array<{ file: File; relativePath: string }>
  >([]);
  const [selectedDirectorySummary, setSelectedDirectorySummary] = useState("");
  const singleFileInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const backupImportInputRef = useRef<HTMLInputElement>(null);
  const remoteStateRef = useRef<Record<string, string | undefined>>({});
  const hasLoadedOnceRef = useRef(false);
  const backfillProgressWsRef = useRef<WebSocket | null>(null);
  const backfillProgressReconnectTimerRef = useRef<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [knowledgeConfig, sourceData, runtimeConfig, historyStatus] = await Promise.all([
        api.getKnowledgeConfig(),
        api.listKnowledgeSources(),
        api.getAgentRunningConfig(),
        api.getKnowledgeHistoryBackfillStatus(),
      ]);

      const nextRemoteStateMap: Record<string, string | undefined> = {};
      sourceData.sources.forEach((source) => {
        nextRemoteStateMap[source.id] = source.status.remote_cache_state;
      });

      if (hasLoadedOnceRef.current) {
        const recoveredSources = sourceData.sources.filter((source) => {
          const currentState = source.status.remote_cache_state;
          const previousState = remoteStateRef.current[source.id];
          return (
            currentState === "cached" &&
            previousState !== "cached" &&
            previousState !== undefined
          );
        });
        recoveredSources.slice(0, 2).forEach((source) => {
          message.success(
            t("knowledge.remoteRecovered", {
              name: source.name,
            }),
          );
        });
      }

      remoteStateRef.current = nextRemoteStateMap;
      hasLoadedOnceRef.current = true;
      setConfig(knowledgeConfig);
      setSources(sourceData.sources);
      setRunningConfig(runtimeConfig);
      setBackfillStatus(historyStatus);
      setBackfillProgress(historyStatus.progress ?? null);
    } catch (error) {
      console.error("Failed to load knowledge data", error);
      message.error(t("knowledge.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const refreshKnowledgeCards = useCallback(async () => {
    try {
      const sourceData = await api.listKnowledgeSources();
      const nextRemoteStateMap: Record<string, string | undefined> = {};
      sourceData.sources.forEach((source) => {
        nextRemoteStateMap[source.id] = source.status.remote_cache_state;
      });
      remoteStateRef.current = nextRemoteStateMap;
      setSources(sourceData.sources);
    } catch {
      // best-effort polling during backfill, ignore transient errors
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // While history backfill is running, poll existing sources API to refresh cards.
  useEffect(() => {
    if (!backfillProgress?.running) {
      return;
    }

    refreshKnowledgeCards();
    const id = window.setInterval(() => {
      refreshKnowledgeCards();
    }, 3000);

    return () => {
      window.clearInterval(id);
    };
  }, [backfillProgress?.running, refreshKnowledgeCards]);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (disposed) {
        return;
      }
      const baseUrl = getApiUrl("/knowledge/history-backfill/progress/ws");
      const wsUrl = new URL(baseUrl, window.location.origin);
      wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
      wsUrl.searchParams.set("interval_ms", "1000");
      const token = getApiToken();
      if (token) {
        wsUrl.searchParams.set("token", token);
      }

      const ws = new WebSocket(wsUrl.toString());
      backfillProgressWsRef.current = ws;

      ws.onmessage = (event) => {
        if (disposed) {
          return;
        }
        try {
          const payload = JSON.parse(event.data || "{}");
          const progress = payload?.progress;
          if (!progress || typeof progress !== "object") {
            return;
          }
          setBackfillProgress(progress as KnowledgeHistoryBackfillProgress);
        } catch {
          // ignore malformed websocket messages
        }
      };

      ws.onclose = () => {
        if (disposed) {
          return;
        }
        backfillProgressReconnectTimerRef.current = window.setTimeout(() => {
          connect();
        }, 1500);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (backfillProgressReconnectTimerRef.current) {
        window.clearTimeout(backfillProgressReconnectTimerRef.current);
        backfillProgressReconnectTimerRef.current = null;
      }
      if (backfillProgressWsRef.current) {
        const ws = backfillProgressWsRef.current;
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.onopen = () => {
            ws.close();
          };
        } else if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
        backfillProgressWsRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (directoryInputRef.current) {
      directoryInputRef.current.setAttribute("webkitdirectory", "");
      directoryInputRef.current.setAttribute("directory", "");
    }
  }, []);

  const resetDraftState = useCallback(() => {
    setSelectedType("file");
    setIsFileDragActive(false);
    setSelectedUploadFile(null);
    setSelectedFileName("");
    setSelectedDirectoryFiles([]);
    setSelectedDirectorySummary("");
    if (singleFileInputRef.current) {
      singleFileInputRef.current.value = "";
    }
    if (directoryInputRef.current) {
      directoryInputRef.current.value = "";
    }
  }, []);

  const persistKnowledgeConfig = useCallback(
    async (nextConfig: KnowledgeConfig) => {
      try {
        const updated = await api.updateKnowledgeConfig(nextConfig);
        setConfig(updated);
        message.success(t("knowledge.configSaved"));
        return updated;
      } catch (error) {
        console.error("Failed to update knowledge config", error);
        message.error(t("knowledge.configSaveFailed"));
        return null;
      }
    },
    [t],
  );

  const handleRunHistoryBackfillNow = useCallback(async () => {
    try {
      setBackfillingHistory(true);
      const response = await api.runKnowledgeHistoryBackfillNow();
      setBackfillStatus(response.status);
      const processed = response.result.processed_sessions ?? 0;
      if (response.result.skipped) {
        message.info(t("knowledge.backfillSkipped"));
      } else {
        message.success(
          t("knowledge.backfillSuccess", {
            count: processed,
          }),
        );
      }
      await loadData();
    } catch (error) {
      console.error("Failed to run knowledge history backfill", error);
      message.error(t("knowledge.backfillFailed"));
    } finally {
      setBackfillingHistory(false);
    }
  }, [loadData, t]);

  const closeEnableModal = useCallback(() => {
    if (enableModalSubmitting) {
      return;
    }
    setEnableModalOpen(false);
    setEnableModalNeedsBackfillChoice(false);
  }, [enableModalSubmitting]);

  const openEnableModal = useCallback(
    (needsBackfillChoice: boolean) => {
      if (!runningConfig) {
        return;
      }
      setEnableModalNeedsBackfillChoice(needsBackfillChoice);
      setEnableModalOpen(true);
    },
    [runningConfig],
  );

  useEffect(() => {
    if (!enableModalOpen || !runningConfig) {
      return;
    }
    enableConfigForm.setFieldsValue(runningConfig);
  }, [enableConfigForm, enableModalOpen, runningConfig]);

  const handleConfirmEnable = useCallback(
    async (runBackfillNow: boolean) => {
      if (!config || !runningConfig) {
        return;
      }
      try {
        const nextRunningConfig = {
          ...runningConfig,
          ...(await enableConfigForm.validateFields()),
          knowledge_enabled: true,
        } as AgentsRunningConfig;
        setEnableModalSubmitting(true);
        const updatedRunningConfig = await api.updateAgentRunningConfig(
          nextRunningConfig,
        );
        setRunningConfig(updatedRunningConfig);
        const updatedKnowledge = await persistKnowledgeConfig({
          ...config,
          enabled: true,
        });
        if (!updatedKnowledge) {
          return;
        }
        setEnableModalOpen(false);
        setEnableModalNeedsBackfillChoice(false);
        if (runBackfillNow) {
          await handleRunHistoryBackfillNow();
        } else if (enableModalNeedsBackfillChoice) {
          message.info(t("knowledge.backfillDeferredHint"));
          await loadData();
        }
      } catch (error) {
        if (error instanceof Error && "errorFields" in error) {
          return;
        }
        console.error("Failed to enable knowledge with runtime config", error);
        message.error(t("knowledge.configSaveFailed"));
      } finally {
        setEnableModalSubmitting(false);
      }
    },
    [
      config,
      enableConfigForm,
      enableModalNeedsBackfillChoice,
      handleRunHistoryBackfillNow,
      loadData,
      persistKnowledgeConfig,
      runningConfig,
      t,
    ],
  );

  const handleToggleEnabled = async (checked: boolean) => {
    if (!config || !runningConfig) {
      return;
    }

    if (!checked) {
      try {
        const updatedRunningConfig = await api.updateAgentRunningConfig({
          ...runningConfig,
          knowledge_enabled: false,
        });
        setRunningConfig(updatedRunningConfig);
        await loadData();
      } catch (error) {
        console.error("Failed to disable knowledge runtime", error);
        message.error(t("knowledge.configSaveFailed"));
      }
      return;
    }

    if (config.enabled) {
      try {
        const updatedRunningConfig = await api.updateAgentRunningConfig({
          ...runningConfig,
          knowledge_enabled: true,
        });
        setRunningConfig(updatedRunningConfig);
        await loadData();
      } catch (error) {
        console.error("Failed to enable knowledge runtime", error);
        message.error(t("knowledge.configSaveFailed"));
      }
      return;
    }

    const firstEnableWithPendingHistory =
      !config.enabled &&
      Boolean(backfillStatus?.has_pending_history) &&
      !backfillStatus?.has_backfill_record;

    if (firstEnableWithPendingHistory) {
      openEnableModal(true);
      return;
    }

    openEnableModal(false);
  };

  const handleAddSource = async () => {
    if (knowledgePageDisabled) {
      return;
    }
    try {
      const values = await form.validateFields();
      setSaving(true);
      const sourceId = `manual-${values.type}-${Math.random().toString(36).slice(2, 8)}`;
      let location = values.location ?? "";
      let content = values.content ?? "";

      if (values.type === "file") {
        if (!selectedUploadFile) {
          message.error(t("knowledge.fileRequired"));
          return;
        }
        const uploaded = await api.uploadKnowledgeFile(sourceId, selectedUploadFile);
        location = uploaded.location;
        content = "";
      }

      if (values.type === "directory") {
        if (selectedDirectoryFiles.length === 0) {
          message.error(t("knowledge.directoryRequired"));
          return;
        }
        const uploaded = await api.uploadKnowledgeDirectory(
          sourceId,
          selectedDirectoryFiles,
        );
        location = uploaded.location;
        content = "";
      }

      const payload = {
        ...values,
        id: sourceId,
        name: sourceId,
        location,
        content,
        recursive: values.recursive ?? true,
        tags: values.tags ?? [],
        summary: values.summary ?? "",
      };

      await api.upsertKnowledgeSource(payload);

      if (
        values.type === "url" ||
        values.type === "chat" ||
        values.type === "file" ||
        values.type === "directory"
      ) {
        await api.indexKnowledgeSource(sourceId);
      }

      message.success(t("knowledge.sourceSaved"));
      setModalOpen(false);
      form.resetFields();
      resetDraftState();
      await loadData();
    } catch (error) {
      if ((error as Error)?.message) {
        console.error("Failed to save knowledge source", error);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleIndexSource = useCallback(async (sourceId: string) => {
    if (knowledgePageDisabled) {
      return;
    }
    try {
      setIndexingId(sourceId);
      await api.indexKnowledgeSource(sourceId);
      message.success(t("knowledge.indexSuccess"));
      await loadData();
    } catch (error) {
      console.error("Failed to index knowledge source", error);
      message.error(t("knowledge.indexFailed"));
    } finally {
      setIndexingId(null);
    }
  }, [knowledgePageDisabled, loadData, t]);

  const handleIndexAll = async () => {
    if (knowledgePageDisabled) {
      return;
    }
    try {
      setIndexingAll(true);
      await api.indexAllKnowledgeSources();
      message.success(t("knowledge.indexAllSuccess"));
      await loadData();
    } catch (error) {
      console.error("Failed to index all knowledge sources", error);
      message.error(t("knowledge.indexFailed"));
    } finally {
      setIndexingAll(false);
    }
  };

  const remoteRetrySources = useMemo(
    () => collectRemoteRetrySources(sources),
    [sources],
  );

  const handleRetryRemoteSources = useCallback(async () => {
    if (knowledgePageDisabled) {
      return;
    }
    if (remoteRetrySources.length === 0) {
      message.info(t("knowledge.remoteRetryNone"));
      return;
    }
    try {
      setRetryingRemoteSources(true);
      const settled = await Promise.allSettled(
        remoteRetrySources.map((source) => api.indexKnowledgeSource(source.id)),
      );
      const summary = summarizeRemoteRetryResults(remoteRetrySources, settled);
      const notice = buildRemoteRetryNotice(summary);
      message[notice.level](t(notice.i18nKey, notice.params));
      await loadData();
    } catch (error) {
      console.error("Failed to retry remote sources", error);
      message.error(t("knowledge.remoteRetryFailed"));
    } finally {
      setRetryingRemoteSources(false);
    }
  }, [knowledgePageDisabled, loadData, remoteRetrySources, t]);

  const triggerBlobDownload = useCallback((blob: Blob, filename: string) => {
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(objectUrl);
  }, []);

  const handleBackupAll = useCallback(async () => {
    if (knowledgePageDisabled) {
      return;
    }
    try {
      setExportingAll(true);
      const blob = await api.downloadKnowledgeBackup();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      triggerBlobDownload(blob, `copaw_knowledge_${timestamp}.zip`);
      message.success(t("knowledge.backupAllSuccess"));
    } catch (error) {
      console.error("Failed to backup knowledge", error);
      message.error(t("knowledge.backupFailed"));
    } finally {
      setExportingAll(false);
    }
  }, [knowledgePageDisabled, t, triggerBlobDownload]);

  const handleBackupSource = useCallback(
    async (sourceId: string, sourceName: string) => {
      try {
        setExportingSourceId(sourceId);
        const blob = await api.downloadKnowledgeSourceBackup(sourceId);
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const normalizedName = (sourceName || sourceId)
          .replace(/[^A-Za-z0-9._-]+/g, "-")
          .replace(/^-+|-+$/g, "") || sourceId;
        triggerBlobDownload(
          blob,
          `copaw_knowledge_${normalizedName}_${timestamp}.zip`,
        );
        message.success(t("knowledge.backupSourceSuccess"));
      } catch (error) {
        console.error("Failed to backup knowledge source", error);
        message.error(t("knowledge.backupFailed"));
      } finally {
        setExportingSourceId(null);
      }
    },
    [t, triggerBlobDownload],
  );

  const handleRestoreBackupPicked = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      event.target.value = "";
      if (!file) {
        return;
      }

      try {
        setImportingBackup(true);
        const result = await api.restoreKnowledgeBackup(file, true);
        message.success(
          t("knowledge.restoreSuccess", {
            count: result.restored_sources,
          }),
        );
        await loadData();
      } catch (error) {
        console.error("Failed to restore knowledge backup", error);
        message.error(t("knowledge.restoreFailed"));
      } finally {
        setImportingBackup(false);
      }
    },
    [loadData, t],
  );

  const handleRestoreBackup = useCallback(() => {
    if (knowledgePageDisabled) {
      return;
    }
    if (importingBackup) {
      return;
    }
    backupImportInputRef.current?.click();
  }, [importingBackup, knowledgePageDisabled]);

  const handleClearKnowledge = useCallback(() => {
    if (knowledgePageDisabled) {
      return;
    }
    Modal.confirm({
      title: t("knowledge.clearConfirmTitle"),
      content: t("knowledge.clearConfirmContent"),
      okText: t("knowledge.clearConfirmOk"),
      cancelText: t("common.cancel"),
      okButtonProps: {
        danger: true,
      },
      onOk: async () => {
        try {
          setClearingKnowledge(true);
          const result = await api.clearKnowledge({ removeSources: true });
          message.success(
            t("knowledge.clearSuccess", {
              sources: result.cleared_sources,
              indexes: result.cleared_indexes,
            }),
          );
          await loadData();
        } catch (error) {
          console.error("Failed to clear knowledge", error);
          message.error(t("knowledge.clearFailed"));
        } finally {
          setClearingKnowledge(false);
        }
      },
    });
  }, [knowledgePageDisabled, loadData, t]);

  const handleSearch = async () => {
    if (knowledgePageDisabled) {
      return;
    }
    const query = searchQuery.trim();
    if (!query) {
      setHits([]);
      return;
    }
    try {
      setSearching(true);
      const result = await api.searchKnowledge({
        query,
        limit: 10,
        sourceTypes:
          searchTypeFilter === "all" ? undefined : [searchTypeFilter],
      });
      setHits(result.hits);
    } catch (error) {
      console.error("Failed to search knowledge", error);
      message.error(t("knowledge.searchFailed"));
    } finally {
      setSearching(false);
    }
  };

  const handleResetSearch = useCallback(() => {
    setSearchQuery("");
    setSearchTypeFilter("all");
    setHits([]);
  }, []);

  const handleGraphQuery = useCallback(async () => {
    if (knowledgePageDisabled) {
      return;
    }
    const query = graphQueryText.trim();
    const datasetScope = graphQueryDatasetScopeText
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!query) {
      message.warning(t("knowledge.graphQuery.emptyQuery"));
      return;
    }
    try {
      setGraphQueryLoading(true);
      setGraphQueryError(null);
      const result = await api.graphQuery({
        query,
        mode: graphQueryMode,
        topK: graphQueryTopK,
        timeoutSec: graphQueryTimeoutSec,
        datasetScope: datasetScope.length ? datasetScope : undefined,
      });
      setGraphQueryResults(result);
      setGraphQueryClickedNode(null);
      setGraphQueryNodeDrawerOpen(false);
      setGraphQueryNodePath([]);
      setGraphRelationPredicateFilter("all");
      setGraphRelationSortMode("score_desc");
    } catch (error) {
      const message_text =
        error instanceof Error ? error.message : "Graph query failed";
      setGraphQueryError(message_text);
      console.error("Failed to execute graph query", error);
      message.error(message_text);
    } finally {
      setGraphQueryLoading(false);
    }
  }, [
    graphQueryText,
    graphQueryMode,
    graphQueryTopK,
    graphQueryTimeoutSec,
    graphQueryDatasetScopeText,
    knowledgePageDisabled,
    t,
  ]);

  const handleResetGraphQuery = useCallback(() => {
    setGraphQueryText("");
    setGraphQueryResults(null);
    setGraphQueryError(null);
    setGraphQueryDatasetScopeText("");
    setGraphQueryClickedNode(null);
    setGraphQueryNodeDrawerOpen(false);
    setGraphQueryNodePath([]);
    setGraphRelationPredicateFilter("all");
    setGraphRelationSortMode("score_desc");
  }, []);

  const hasSearchQuery = searchQuery.trim().length > 0;
  const showSearchPanel = searching || hasSearchQuery || hits.length > 0;

  const graphNodeDetails = useMemo(() => {
    if (!graphQueryResults || !graphQueryClickedNode) {
      return {
        outgoing: [] as GraphQueryRecord[],
        incoming: [] as GraphQueryRecord[],
        nodeIdSet: new Set<string>(),
      };
    }

    const nodeIdSet = new Set(
      graphQueryResults.records.map((record) => safeGraphNodeId(record.subject)),
    );

    const outgoing = graphQueryResults.records.filter(
      (record) => safeGraphNodeId(record.subject) === graphQueryClickedNode,
    );

    const incoming = graphQueryResults.records.filter((record) => {
      const targetId = extractHopNodeId(record.object);
      return Boolean(targetId) && targetId === graphQueryClickedNode;
    });

    return { outgoing, incoming, nodeIdSet };
  }, [graphQueryResults, graphQueryClickedNode]);

  const graphRelationPredicateOptions = useMemo(() => {
    const predicates = new Set<string>();
    graphNodeDetails.outgoing.forEach((item) => predicates.add(item.predicate));
    graphNodeDetails.incoming.forEach((item) => predicates.add(item.predicate));
    return [
      { label: t("knowledge.graphQuery.allPredicates"), value: "all" },
      ...Array.from(predicates)
        .sort((a, b) => a.localeCompare(b))
        .map((predicate) => ({ label: predicate, value: predicate })),
    ];
  }, [graphNodeDetails.incoming, graphNodeDetails.outgoing, t]);

  const graphRelationSortOptions = useMemo(
    () => [
      { label: t("knowledge.graphQuery.sortScoreDesc"), value: "score_desc" },
      { label: t("knowledge.graphQuery.sortScoreAsc"), value: "score_asc" },
      { label: t("knowledge.graphQuery.sortPredicate"), value: "predicate_asc" },
    ],
    [t],
  );

  const applyGraphRelationFilterAndSort = useCallback(
    (records: GraphQueryRecord[]) => {
      const filtered =
        graphRelationPredicateFilter === "all"
          ? records
          : records.filter((record) => record.predicate === graphRelationPredicateFilter);

      const sorted = [...filtered];
      sorted.sort((a, b) => {
        if (graphRelationSortMode === "score_asc") {
          return a.score - b.score;
        }
        if (graphRelationSortMode === "predicate_asc") {
          return a.predicate.localeCompare(b.predicate);
        }
        return b.score - a.score;
      });
      return sorted;
    },
    [graphRelationPredicateFilter, graphRelationSortMode],
  );

  const filteredOutgoingRelations = useMemo(
    () => applyGraphRelationFilterAndSort(graphNodeDetails.outgoing),
    [applyGraphRelationFilterAndSort, graphNodeDetails.outgoing],
  );

  const filteredIncomingRelations = useMemo(
    () => applyGraphRelationFilterAndSort(graphNodeDetails.incoming),
    [applyGraphRelationFilterAndSort, graphNodeDetails.incoming],
  );

  const handleGraphNodeOpen = useCallback((nodeId: string) => {
    setGraphQueryClickedNode(nodeId);
    setGraphQueryNodePath([nodeId]);
    setGraphQueryNodeDrawerOpen(true);
  }, []);

  const handleGraphNodeHop = useCallback((nodeId: string) => {
    setGraphQueryClickedNode(nodeId);
    setGraphQueryNodePath((prev) => {
      const existsIndex = prev.indexOf(nodeId);
      if (existsIndex >= 0) {
        return prev.slice(0, existsIndex + 1);
      }
      return [...prev, nodeId];
    });
  }, []);

  const handleDeleteSource = useCallback(async (sourceId: string) => {
    try {
      await api.deleteKnowledgeSource(sourceId);
      message.success(t("knowledge.deleteSuccess"));
      await loadData();
    } catch (error) {
      console.error("Failed to delete knowledge source", error);
      message.error(t("knowledge.deleteFailed"));
    }
  }, [loadData, t]);

  const handleConfirmDeleteSource = useCallback(
    (sourceId: string, sourceName: string) => {
      Modal.confirm({
        title: t("knowledge.deleteConfirmTitle"),
        content: t("knowledge.deleteConfirmContent", { name: sourceName }),
        okText: t("common.delete"),
        cancelText: t("common.cancel"),
        okButtonProps: {
          danger: true,
        },
        onOk: async () => {
          await handleDeleteSource(sourceId);
        },
      });
    },
    [handleDeleteSource, t],
  );

  const handleFilePicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setIsFileDragActive(false);
    setSelectedUploadFile(file);
    setSelectedFileName(file?.name ?? "");
  };

  const handleFileDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsFileDragActive(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    if (!file) {
      return;
    }
    setSelectedUploadFile(file);
    setSelectedFileName(file.name);
  };

  const handleFileDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!isFileDragActive) {
      setIsFileDragActive(true);
    }
  };

  const handleFileDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsFileDragActive(false);
  };

  const handleDirectoryPicked = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const rawFiles = Array.from(event.target.files ?? []);
    const prepared = rawFiles.map((file) => ({
      file,
      relativePath:
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
        file.name,
    }));
    setSelectedDirectoryFiles(prepared);
    if (prepared.length === 0) {
      setSelectedDirectorySummary("");
      return;
    }
    const topLevel = prepared[0].relativePath.split("/")[0];
    setSelectedDirectorySummary(
      t("knowledge.directorySelected", {
        name: topLevel,
        count: prepared.length,
      }),
    );
  };

  const filteredSources = useMemo(() => {
    return sources.filter((source) => {
      if (sourceOriginFilter !== "all") {
        const origin = inferSourceOrigin(source);
        if (origin !== sourceOriginFilter) return false;
      }
      if (sourceTypeFilter !== "all" && source.type !== sourceTypeFilter) {
        return false;
      }
      return true;
    });
  }, [sourceOriginFilter, sourceTypeFilter, sources]);

  const selectedSourceOriginText = useMemo(() => {
    if (!selectedSource) {
      return "";
    }
    return getSourceOriginText(selectedSource, t);
  }, [selectedSource, t]);

  const selectedSourceRemoteLine = useMemo(() => {
    if (!selectedSource) {
      return "";
    }
    return formatRemoteStatus(selectedSource, t);
  }, [selectedSource, t]);

  const selectedSourceIndexedCountText = useMemo(() => {
    if (!selectedSource) {
      return "-";
    }
    return selectedSource.status.indexed
      ? t("knowledge.indexedCount", {
          documents: selectedSource.status.document_count,
          chunks: selectedSource.status.chunk_count,
        })
      : "-";
  }, [selectedSource, t]);

  const selectedSourceSummaryData = useMemo(() => {
    if (!selectedSource) {
      return {
        summary: "",
        keywords: [] as string[],
      };
    }
    return {
      summary: (selectedSource.summary || "").trim(),
      keywords: selectedSource.keywords || [],
    };
  }, [selectedSource]);

  const openDetailDrawer = useCallback((record: KnowledgeSourceItem) => {
    setSelectedSource(record);
    setSourceContent(null);
    setDetailDrawerOpen(true);
    setSourceContentLoading(true);
    api.getKnowledgeSourceContent(record.id)
      .then((data) => setSourceContent(data))
      .catch(() => setSourceContent({ indexed: false, documents: [] }))
      .finally(() => setSourceContentLoading(false));
  }, []);

  const handleDetailDrawerValueKeyDown = useCallback(
    (
      event: React.KeyboardEvent<HTMLDivElement>,
      record: KnowledgeSourceItem,
    ) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetailDrawer(record);
      }
    },
    [openDetailDrawer],
  );

  const dragZoneClassName = `${styles.dragZone} ${
    isFileDragActive ? styles.dragZoneActive : ""
  }`;
  const enableModalAutoCollectLongText = Form.useWatch(
    "knowledge_auto_collect_long_text",
    enableConfigForm,
  );
  const showBackfillNowButton = Boolean(
    config?.enabled &&
      backfillStatus?.marked_unbackfilled &&
      backfillStatus?.has_pending_history,
  );
  const unifiedBatchProgress = useMemo(() => {
    const progress = buildUnifiedBatchProgress({
      indexingAll,
      backfillProgress,
      backfillingHistory,
      clearingKnowledge,
    });

    return {
      visible: progress.visible,
      percent: progress.percent,
      status: progress.status,
      label: progress.labelI18nKey
        ? progress.labelDefault
          ? t(progress.labelI18nKey, progress.labelDefault, progress.labelParams)
          : t(progress.labelI18nKey, progress.labelParams)
        : "",
    };
  }, [
    backfillProgress,
    backfillingHistory,
    clearingKnowledge,
    indexingAll,
    t,
  ]);

  const knowledgeQuantMetrics = useMemo(
    () => computeKnowledgeQuantMetrics(sources, hits, backfillStatus),
    [backfillStatus, hits, sources],
  );
  const quantCards = buildKnowledgeQuantCardViewModels({
    metrics: knowledgeQuantMetrics,
    handlers: {
      addSource: () => setModalOpen(true),
      rebuildIndex: handleIndexAll,
      backfillHistory: handleRunHistoryBackfillNow,
      retryRemote: handleRetryRemoteSources,
    },
    loading: {
      addSource: false,
      rebuildIndex: indexingAll,
      backfillHistory: backfillingHistory,
      retryRemote: retryingRemoteSources,
    },
  }).map((item) => ({
    ...item,
    label: t(item.labelI18nKey, item.defaultLabel),
    action: item.action
      ? {
          label: t(item.action.labelI18nKey, item.action.defaultLabel),
          onClick: item.action.onClick,
          loading: item.action.loading,
        }
      : undefined,
  }));

  return (
    <div className={styles.knowledgePage}>
      <div className={styles.header}>
        <div className={styles.headerInfo}>
          <Typography.Title level={3} className={styles.title}>
            <Space align="center" size={8}>
              <DatabaseOutlined />
              {t("knowledge.title")}
            </Space>
          </Typography.Title>
          <Typography.Paragraph className={styles.description}>
            {t("knowledge.description")}
          </Typography.Paragraph>
        </div>
        <div className={styles.headerActions}>
          <input
            ref={backupImportInputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            style={{ display: "none" }}
            onChange={handleRestoreBackupPicked}
          />
          <div className={styles.headerControlGroup}>
            <Typography.Text>{t("knowledge.enabled")}</Typography.Text>
            <Switch
              checked={knowledgeRuntimeEnabled}
              onChange={handleToggleEnabled}
            />
          </div>
          <div className={styles.headerButtonGroup}>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleIndexAll}
              loading={indexingAll}
              disabled={knowledgePageDisabled}
            >
              {t("knowledge.indexAll")}
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={handleBackupAll}
              loading={exportingAll}
              disabled={knowledgePageDisabled}
            >
              {t("knowledge.backupAll")}
            </Button>
            <Button
              icon={<UploadOutlined />}
              onClick={handleRestoreBackup}
              loading={importingBackup}
              disabled={knowledgePageDisabled}
            >
              {t("knowledge.restore")}
            </Button>
            <Button onClick={() => navigate("/agent-config")}>
              {t("knowledge.goToRuntimeConfig")}
            </Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={handleClearKnowledge}
              loading={clearingKnowledge}
              disabled={knowledgePageDisabled}
            >
              {t("knowledge.clearKnowledge")}
            </Button>
            {showBackfillNowButton ? (
              <Button
                icon={<ReloadOutlined />}
                onClick={handleRunHistoryBackfillNow}
                loading={backfillingHistory}
                disabled={knowledgePageDisabled}
              >
                {t("knowledge.backfillNowButton")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {unifiedBatchProgress.visible ? (
        <div className={styles.unifiedProgressRow}>
          <Typography.Text className={styles.unifiedProgressLabel}>
            {unifiedBatchProgress.label}
          </Typography.Text>
          <Progress
            percent={unifiedBatchProgress.percent}
            size="small"
            status={unifiedBatchProgress.status}
          />
        </div>
      ) : null}

      <Space
        direction="vertical"
        size={16}
        className={`${styles.contentStack} ${knowledgePageDisabled ? styles.disabledPanel : ""}`}
      >

      <Card>
        <Space className={styles.fullWidth} direction="vertical" size={12}>
          <div className={styles.quantHeader}>
            <Typography.Text>{t("knowledge.quantPanelTitle")}</Typography.Text>
            <Typography.Text type="secondary">
              {t("knowledge.quantPanelHint")}
            </Typography.Text>
          </div>
          <div className={styles.quantGrid}>
            {quantCards.map((item) => {
              const statusLabel = getKnowledgeQuantStatusLabel(item.assessment.status);
              return (
                <div
                  key={item.key}
                  className={`${styles.quantCard} ${item.assessment.tone === "positive" ? styles.quantCardPositive : item.assessment.tone === "warning" ? styles.quantCardWarning : styles.quantCardNeutral}`}
                >
                  <Typography.Text className={styles.quantLabel}>{item.label}</Typography.Text>
                  <Typography.Text className={styles.quantValue}>{item.value}</Typography.Text>
                  <Typography.Text className={styles.quantNote}>
                    {t(statusLabel.i18nKey, statusLabel.defaultLabel)}
                  </Typography.Text>
                  <Typography.Text className={styles.quantReason}>
                    {t(`knowledge.quantReason.${item.reason.key}`, item.reason.params || {})}
                  </Typography.Text>
                  {item.action ? (
                    <div className={styles.quantActionRow}>
                      <Button
                        size="small"
                        type="link"
                        onClick={item.action.onClick}
                        loading={item.action.loading}
                        disabled={knowledgePageDisabled}
                        className={styles.quantActionButton}
                      >
                        {item.action.label}
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Space>
      </Card>

      <Card>
        <Space className={styles.fullWidth} direction="vertical" size={12}>
          <div className={styles.searchHeader}>
            <Typography.Text >{t("knowledge.search")}</Typography.Text>
            {hits.length > 0 ? (
              <Tag color="blue">
                {t("knowledge.searchHitCount", { count: hits.length })}
              </Tag>
            ) : null}
          </div>
          <div className={styles.searchControls}>
            <Space.Compact className={styles.searchCompact}>
              <Select
                value={searchTypeFilter}
                onChange={(value) =>
                  setSearchTypeFilter(value as KnowledgeSourceType | "all")
                }
                options={[
                  { label: t("knowledge.allTypes"), value: "all" },
                  ...SOURCE_TYPE_OPTIONS,
                ]}
                className={styles.searchTypeSelect}
              />
              <Input
                value={searchQuery}
                onChange={(event) => {
                  const value = event.target.value;
                  setSearchQuery(value);
                  if (!value.trim() && hits.length > 0) {
                    setHits([]);
                  }
                }}
                placeholder={t("knowledge.searchPlaceholder")}
                onPressEnter={handleSearch}
              />
            </Space.Compact>
            <div className={styles.searchButtons}>
              <Button onClick={handleResetSearch}>{t("common.reset")}</Button>
              <Button
                type="primary"
                icon={<SearchOutlined />}
                loading={searching}
                onClick={handleSearch}
              >
                {t("knowledge.search")}
              </Button>
            </div>
          </div>
        </Space>
        {showSearchPanel ? (
          <div className={styles.searchResultsWrap}>
            {searching ? (
              <div className={styles.searchStatusText}>
                <Spin size="small" />
              </div>
            ) : hits.length === 0 ? (
              <div className={styles.searchStatusText}>{t("knowledge.searchEmpty")}</div>
            ) : (
              <div className={styles.searchResultList}>
                <Space direction="vertical" size={12} className={styles.fullWidth}>
                  {hits.map((hit) => (
                    <Card
                      key={`${hit.source_id}-${hit.document_path}-${hit.score}`}
                      className={styles.searchHitCard}
                    >
                      <div className={styles.searchHitTopRow}>
                        <Space>
                          <Tag color="blue">{hit.source_name}</Tag>
                          <Tag>{hit.source_type}</Tag>
                        </Space>
                        <Tag color="geekblue">
                          {t("knowledge.scoreLabel", {
                            score: Number(hit.score).toFixed(2),
                          })}
                        </Tag>
                      </div>
                      <Typography.Text >{hit.document_title}</Typography.Text>
                      <Typography.Text type="secondary" className={styles.searchHitPath}>
                        {hit.document_path}
                      </Typography.Text>
                      <Typography.Paragraph className={styles.searchHitSnippet}>
                        {hit.snippet}
                      </Typography.Paragraph>
                    </Card>
                  ))}
                </Space>
              </div>
            )}
          </div>
        ) : null}
      </Card>

      <div className={styles.addSourceRow}>
        <Button icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          {t("knowledge.addSource")}
        </Button>
      </div>

      <div>
      <Card loading={loading}>
        <div className={styles.filterBar}>
          <div className={styles.filterGroup}>
            <Typography.Text className={styles.filterLabel}>
              {t("knowledge.sourceOriginFilter")}
            </Typography.Text>
            <Select
              value={sourceOriginFilter}
              onChange={(value) => setSourceOriginFilter(value as SourceOriginFilter)}
              options={[
                { label: t("knowledge.originAll"), value: "all" },
                { label: t("knowledge.originManual"), value: "manual" },
                { label: t("knowledge.originAuto"), value: "auto" },
              ]}
              className={styles.filterSelect}
            />
          </div>
          <div className={styles.filterGroup}>
            <Typography.Text className={styles.filterLabel}>
              {t("knowledge.sourceTypeFilter")}
            </Typography.Text>
            <Select
              value={sourceTypeFilter}
              onChange={(value) => setSourceTypeFilter(value as KnowledgeSourceType | "all")}
              options={[
                { label: t("knowledge.allTypes"), value: "all" },
                ...SOURCE_TYPE_OPTIONS,
              ]}
              className={styles.filterSelect}
            />
          </div>
        </div>
        {filteredSources.length === 0 ? (
          <Empty description={t("knowledge.empty")} />
        ) : (
          <div className={styles.cardsGrid}>
            {filteredSources.map((record) => {
              const originText = getSourceOriginText(record, t);
              const remoteLine = formatRemoteStatus(record, t);
              const isActiveCard = indexingId === record.id;
              const cardSubject = (record.subject || record.name || "").trim();
              const summaryText = (record.summary || "").trim();
              const summaryKeywords = record.keywords || [];
              const hideSummaryBlock =
                cardSubject.length > 0 &&
                summaryText.length > 0 &&
                cardSubject === summaryText;
              const indexedCountText = record.status.indexed
                ? t("knowledge.indexedCount", {
                    documents: record.status.document_count,
                    chunks: record.status.chunk_count,
                  })
                : "-";
              return (
                <div key={record.id}>
                  <div
                    className={`${styles.cardContainer} ${isActiveCard ? styles.cardContainerActive : ""}`}
                    aria-busy={isActiveCard}
                  >
                        <div className={styles.cardHeader}>
                          <div className={styles.cardHeaderRow}>
                            <Typography.Text type="secondary" className={styles.cardHeaderId}>
                              {record.id}
                            </Typography.Text>
                            <span className={styles.typeTag}>{record.type}</span>
                            <span className={styles.originTag}>{originText}</span>
                          </div>
                        </div>

                        <div className={styles.cardMeta}>
                          {cardSubject ? (
                            <div className={styles.infoSection}>
                              <div className={styles.infoLabel}>
                                {t("knowledge.table.subject")}
                              </div>
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => openDetailDrawer(record)}
                                onKeyDown={(event) =>
                                  handleDetailDrawerValueKeyDown(event, record)
                                }
                                className={`${styles.infoBlock} ${styles.clickableBlock}`}
                                title={cardSubject}
                              >
                                <Typography.Text
                                  className={styles.cardTitle}
                                  title={cardSubject}
                                >
                                  {cardSubject}
                                </Typography.Text>
                              </div>
                            </div>
                          ) : null}

                          {!hideSummaryBlock ? (
                            <div className={styles.infoSection}>
                              <div className={styles.infoLabel}>
                                {t("knowledge.table.source")}
                              </div>
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => openDetailDrawer(record)}
                                onKeyDown={(event) =>
                                  handleDetailDrawerValueKeyDown(event, record)
                                }
                                className={`${styles.infoBlock} ${styles.clickableBlock}`}
                                title={summaryText || t("knowledge.inlineText")}
                              >
                                <Typography.Text
                                  className={styles.cardTitle}
                                  title={summaryText || t("knowledge.inlineText")}
                                >
                                  {summaryText || t("knowledge.inlineText")}
                                </Typography.Text>
                              </div>
                            </div>
                          ) : null}

                          {summaryKeywords.length > 0 ? (
                            <div className={styles.infoSection}>
                              <div className={styles.infoLabel}>
                                {t("knowledge.table.keywords")}
                              </div>
                              <div className={styles.infoBlock}>
                                <div className={styles.keywordList}>
                                  {summaryKeywords.map((keyword) => (
                                    <Tag key={`${record.id}-${keyword}`} className={styles.keywordTag}>
                                      {keyword}
                                    </Tag>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {record.location ? (
                            <div className={styles.infoSection}>
                              <div className={styles.infoLabel}>
                                {t("knowledge.table.location")}
                              </div>
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => openDetailDrawer(record)}
                                onKeyDown={(event) =>
                                  handleDetailDrawerValueKeyDown(event, record)
                                }
                                className={`${styles.infoBlock} ${styles.singleLineValue} ${styles.clickableBlock}`}
                                title={record.location}
                              >
                                {record.location}
                              </div>
                            </div>
                          ) : null}

                          <div className={styles.infoSection}>
                            <div className={styles.infoLabel}>
                              {t("knowledge.statusAndStats")}
                            </div>
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => openDetailDrawer(record)}
                              onKeyDown={(event) =>
                                handleDetailDrawerValueKeyDown(event, record)
                              }
                              className={`${styles.infoBlock} ${styles.clickableBlock}`}
                            >
                              <div className={styles.statusRow}>
                                <div>
                                  <span
                                    className={
                                      record.status.indexed
                                        ? styles.indexedTag
                                        : styles.notIndexedTag
                                    }
                                  >
                                    {record.status.indexed
                                      ? t("knowledge.indexed")
                                      : t("knowledge.notIndexed")}
                                  </span>
                                </div>
                                <Typography.Text type="secondary">
                                  {indexedCountText}
                                </Typography.Text>
                              </div>
                              {remoteLine ? (
                                <div className={styles.statusSubRow}>
                                  <Typography.Text type="secondary">Remote</Typography.Text>
                                  <Typography.Text type="secondary">{remoteLine}</Typography.Text>
                                </div>
                              ) : null}
                              {record.status.remote_last_error ? (
                                <Typography.Text type="secondary" className={styles.remoteError}>
                                  {t("knowledge.remoteLastError", {
                                    error: record.status.remote_last_error,
                                  })}
                                </Typography.Text>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <div className={styles.cardFooter}>
                          <div className={styles.actionRow}>
                            <Button
                              type="link"
                              size="small"
                              className={styles.actionButton}
                              loading={indexingId === record.id}
                              onClick={() => handleIndexSource(record.id)}
                            >
                              {record.status.indexed
                                ? t("knowledge.reindex")
                                : t("knowledge.indexNow")}
                            </Button>
                            <Button
                              type="link"
                              size="small"
                              className={styles.actionButton}
                              loading={exportingSourceId === record.id}
                              onClick={() =>
                                handleBackupSource(record.id, record.name)
                              }
                            >
                              {t("knowledge.backupSource")}
                            </Button>
                            <Button
                              type="text"
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              className={styles.deleteButton}
                              onClick={() =>
                                handleConfirmDeleteSource(record.id, record.name)
                              }
                              title={t("common.delete")}
                            />
                          </div>
                        </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      </div>

      {/* Graph Query Section */}
      <Card>
        <Space className={styles.fullWidth} direction="vertical" size={12}>
          <div className={styles.searchHeader}>
            <Typography.Text>{t("knowledge.graphQuery.title")}</Typography.Text>
            <Typography.Text type="secondary">
              {t("knowledge.graphQuery.subtitle")}
            </Typography.Text>
          </div>
          <div className={styles.searchControls}>
            <Space.Compact className={styles.searchCompact}>
              <Select
                value={graphQueryMode}
                onChange={(value) => setGraphQueryMode(value as "template" | "cypher")}
                options={[
                  { label: t("knowledge.graphQuery.template"), value: "template" },
                  { label: t("knowledge.graphQuery.cypher"), value: "cypher" },
                ]}
                className={styles.searchTypeSelect}
              />
              <Input
                value={graphQueryText}
                onChange={(e) => setGraphQueryText(e.target.value)}
                placeholder={t("knowledge.graphQuery.placeholder")}
                onPressEnter={handleGraphQuery}
              />
            </Space.Compact>
            <div className={styles.searchButtons}>
              <Button onClick={handleResetGraphQuery}>{t("common.reset")}</Button>
              <Button
                type="primary"
                icon={<SearchOutlined />}
                loading={graphQueryLoading}
                onClick={handleGraphQuery}
                disabled={knowledgePageDisabled}
              >
                {t("knowledge.graphQuery.execute")}
              </Button>
            </div>
          </div>
          <div className={styles.searchParams}>
            <Space size="small" wrap>
              <div className={styles.paramControl}>
                <Typography.Text type="secondary" className={styles.paramLabel}>
                  {t("knowledge.graphQuery.topK")}:
                </Typography.Text>
                <InputNumber
                  min={1}
                  max={100}
                  value={graphQueryTopK}
                  onChange={(value) => setGraphQueryTopK(value || 20)}
                  style={{ width: 88 }}
                />
              </div>
              <div className={styles.paramControl}>
                <Typography.Text type="secondary" className={styles.paramLabel}>
                  {t("knowledge.graphQuery.timeout")}:
                </Typography.Text>
                <InputNumber
                  min={1}
                  max={300}
                  value={graphQueryTimeoutSec}
                  onChange={(value) => setGraphQueryTimeoutSec(value || 20)}
                  style={{ width: 88 }}
                />
              </div>
              <div className={styles.paramControl}>
                <Typography.Text type="secondary" className={styles.paramLabel}>
                  {t("knowledge.graphQuery.datasetScope")}:
                </Typography.Text>
                <Input
                  value={graphQueryDatasetScopeText}
                  onChange={(e) => setGraphQueryDatasetScopeText(e.target.value)}
                  placeholder={t("knowledge.graphQuery.datasetScopePlaceholder")}
                  style={{ width: 220 }}
                />
              </div>
            </Space>
          </div>
        </Space>

        {graphQueryResults && (
          <div style={{ marginTop: 20 }}>
            <GraphQueryResults
              records={graphQueryResults.records}
              summary={graphQueryResults.summary}
              warnings={graphQueryResults.warnings}
              provenance={graphQueryResults.provenance}
              query={graphQueryText}
              loading={graphQueryLoading}
              onRefresh={handleGraphQuery}
            />
          </div>
        )}

        {graphQueryResults && (
          <div style={{ marginTop: 20 }}>
            <GraphVisualization
              data={recordsToVisualizationData(
                graphQueryResults.records,
                graphQueryResults.summary,
                graphQueryResults.provenance,
              )}
              loading={graphQueryLoading}
              onNodeClick={(node) => handleGraphNodeOpen(node.id)}
            />
          </div>
        )}

        {graphQueryError && (
          <div
            style={{
              marginTop: 16,
              padding: "12px 16px",
              backgroundColor: "#fff1f0",
              border: "1px solid #ffccc7",
              borderRadius: 4,
            }}
          >
            <Typography.Text type="danger">
              <strong>{t("common.error")}:</strong> {graphQueryError}
            </Typography.Text>
          </div>
        )}
      </Card>

      </Space>

      <Modal
        open={modalOpen}
        title={t("knowledge.addSource")}
        onOk={handleAddSource}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
          resetDraftState();
        }}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            type: "file",
            recursive: true,
            enabled: true,
            location: "",
            content: "",
            tags: [],
            summary: "",
          }}
        >
          <Form.Item
            name="type"
            label={t("knowledge.form.type")}
            rules={[{ required: true }]}
          >
            <Select
              options={SOURCE_TYPE_OPTIONS}
              onChange={(value) => {
                setSelectedType(value as KnowledgeSourceType);
                setIsFileDragActive(false);
                setSelectedUploadFile(null);
                setSelectedFileName("");
                setSelectedDirectoryFiles([]);
                setSelectedDirectorySummary("");
                form.setFieldsValue({ location: "", content: "" });
              }}
            />
          </Form.Item>
          {selectedType === "file" && (
            <Form.Item label={t("knowledge.form.fileUpload")}>
              <Space direction="vertical" size={8} className={styles.fullWidth}>
                <div
                  onClick={() => singleFileInputRef.current?.click()}
                  onDrop={handleFileDrop}
                  onDragOver={handleFileDragOver}
                  onDragLeave={handleFileDragLeave}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      singleFileInputRef.current?.click();
                    }
                  }}
                  className={dragZoneClassName}
                >
                  <Space direction="vertical" size={6} className={styles.fullWidth}>
                    <Typography.Text >
                      {t("knowledge.dragFileTitle")}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {t("knowledge.dragFileHint")}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {selectedFileName || t("knowledge.noFileSelected")}
                    </Typography.Text>
                  </Space>
                </div>
                <Button onClick={() => singleFileInputRef.current?.click()}>
                  {t("knowledge.pickFile")}
                </Button>
                <Typography.Text type="secondary">
                  {t("knowledge.fileUploadHint")}
                </Typography.Text>
              </Space>
            </Form.Item>
          )}
          {selectedType === "directory" && (
            <Form.Item label={t("knowledge.form.directoryUpload")}>
              <Space direction="vertical" size={8} className={styles.fullWidth}>
                <Button onClick={() => directoryInputRef.current?.click()}>
                  {t("knowledge.pickDirectory")}
                </Button>
                <Typography.Text type="secondary">
                  {selectedDirectorySummary || t("knowledge.noDirectorySelected")}
                </Typography.Text>
              </Space>
            </Form.Item>
          )}
          {selectedType === "url" && (
            <>
              <Form.Item
                name="location"
                label={t("knowledge.form.location")}
                rules={[{ required: true }]}
              >
                <Input placeholder={t("knowledge.form.urlPlaceholder")} />
              </Form.Item>
              <Typography.Text type="secondary">
                {t("knowledge.urlHint")}
              </Typography.Text>
            </>
          )}
          {selectedType === "text" && (
            <Form.Item
              name="content"
              label={t("knowledge.form.content")}
              rules={[{ required: true }]}
            >
              <Input.TextArea rows={5} placeholder={t("knowledge.form.contentPlaceholder")} />
            </Form.Item>
          )}
          {selectedType === "chat" && (
            <>
              <Form.Item
                name="location"
                label={t("knowledge.form.chatSessionId")}
                rules={[{ required: true }]}
              >
                <Input placeholder={t("knowledge.chatSessionIdPlaceholder")} />
              </Form.Item>
              <Typography.Text type="secondary">
                {t("knowledge.chatHint")}
              </Typography.Text>
            </>
          )}
          <Form.Item name="summary" label={t("knowledge.form.summary")}>
            <Input placeholder={t("knowledge.form.summaryPlaceholder")} />
          </Form.Item>
          <Form.Item name="enabled" valuePropName="checked">
            <Switch checkedChildren={t("knowledge.form.enabled")} unCheckedChildren={t("knowledge.form.disabled")} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={enableModalOpen}
        title={t("knowledge.enableConfirmTitle")}
        onCancel={closeEnableModal}
        footer={
          enableModalNeedsBackfillChoice ? (
            <Space>
              <Button onClick={closeEnableModal}>{t("common.cancel")}</Button>
              <Button
                loading={enableModalSubmitting}
                onClick={() => void handleConfirmEnable(false)}
              >
                {t("knowledge.enableAndBackfillLater")}
              </Button>
              <Button
                type="primary"
                loading={enableModalSubmitting}
                onClick={() => void handleConfirmEnable(true)}
              >
                {t("knowledge.enableAndBackfillNow")}
              </Button>
            </Space>
          ) : (
            <Space>
              <Button onClick={closeEnableModal}>{t("common.cancel")}</Button>
              <Button
                type="primary"
                loading={enableModalSubmitting}
                onClick={() => void handleConfirmEnable(false)}
              >
                {t("knowledge.enableConfirmOk")}
              </Button>
            </Space>
          )
        }
        destroyOnHidden={false}
      >
        <Space direction="vertical" size={12} className={styles.fullWidth}>
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            {t("knowledge.enableConfirmDescription")}
          </Typography.Paragraph>
          <Form
            form={enableConfigForm}
            layout="vertical"
            className={styles.enableConfigForm}
          >
            <Form.Item
              label={t("agentConfig.autoCollectChatFiles")}
              name="knowledge_auto_collect_chat_files"
              valuePropName="checked"
              tooltip={t("agentConfig.autoCollectChatFilesTooltip")}
            >
              <Switch />
            </Form.Item>
            <Form.Item
              label={t("agentConfig.autoCollectChatUrls")}
              name="knowledge_auto_collect_chat_urls"
              valuePropName="checked"
              tooltip={t("agentConfig.autoCollectChatUrlsTooltip")}
            >
              <Switch />
            </Form.Item>
            <Form.Item
              label={t("agentConfig.autoCollectLongText")}
              name="knowledge_auto_collect_long_text"
              valuePropName="checked"
              tooltip={t("agentConfig.autoCollectLongTextTooltip")}
            >
              <Switch />
            </Form.Item>
            <Form.Item
              label={t("agentConfig.longTextMinChars")}
              name="knowledge_long_text_min_chars"
              rules={[
                {
                  required: true,
                  message: t("agentConfig.longTextMinCharsRequired"),
                },
                {
                  type: "number",
                  min: 200,
                  message: t("agentConfig.longTextMinCharsMin"),
                },
              ]}
              tooltip={t("agentConfig.longTextMinCharsTooltip")}
            >
              <InputNumber
                style={{ width: "100%" }}
                min={200}
                max={20000}
                step={100}
                disabled={!enableModalAutoCollectLongText}
                placeholder={t("agentConfig.longTextMinCharsPlaceholder")}
              />
            </Form.Item>
            <Form.Item
              label={t("agentConfig.knowledgeChunkSize")}
              name="knowledge_chunk_size"
              rules={[
                {
                  required: true,
                  message: t("agentConfig.knowledgeChunkSizeRequired"),
                },
                {
                  type: "number",
                  min: 200,
                  message: t("agentConfig.knowledgeChunkSizeMin"),
                },
              ]}
              tooltip={t("agentConfig.knowledgeChunkSizeTooltip")}
            >
              <InputNumber
                style={{ width: "100%" }}
                min={200}
                max={8000}
                step={100}
                placeholder={t("agentConfig.knowledgeChunkSizePlaceholder")}
              />
            </Form.Item>
          </Form>
          {enableModalNeedsBackfillChoice ? (
            <Typography.Paragraph className={styles.enableBackfillHint}>
              {t("knowledge.firstEnableBackfillPrompt", {
                count: backfillStatus?.history_chat_count ?? 0,
              })}
            </Typography.Paragraph>
          ) : (
            <Typography.Paragraph className={styles.enableBackfillHint}>
              {t("knowledge.enableConfigInlineHint")}
            </Typography.Paragraph>
          )}
        </Space>
      </Modal>
      <Drawer
        width={560}
        placement="right"
        title={t("knowledge.graphQuery.nodeDetail")}
        open={graphQueryNodeDrawerOpen && Boolean(graphQueryClickedNode)}
        onClose={() => setGraphQueryNodeDrawerOpen(false)}
        destroyOnClose
      >
        {graphQueryClickedNode ? (
          <Space direction="vertical" size={14} className={styles.fullWidth}>
            <div className={styles.graphNodeToolbarRow}>
              <Select
                value={graphRelationPredicateFilter}
                options={graphRelationPredicateOptions}
                onChange={(value) => setGraphRelationPredicateFilter(String(value))}
                className={styles.graphNodeToolbarSelect}
              />
              <Select
                value={graphRelationSortMode}
                options={graphRelationSortOptions}
                onChange={(value) =>
                  setGraphRelationSortMode(
                    value as "score_desc" | "score_asc" | "predicate_asc",
                  )
                }
                className={styles.graphNodeToolbarSelect}
              />
            </div>

            {graphQueryNodePath.length > 0 ? (
              <div className={styles.graphNodePathWrap}>
                <Typography.Text type="secondary" className={styles.graphNodePathLabel}>
                  {t("knowledge.graphQuery.path")}:
                </Typography.Text>
                <Space size={6} wrap>
                  {graphQueryNodePath.map((nodeId, idx) => (
                    <Button
                      key={`${nodeId}-${idx}`}
                      type={nodeId === graphQueryClickedNode ? "primary" : "default"}
                      size="small"
                      onClick={() => handleGraphNodeHop(nodeId)}
                    >
                      {nodeId}
                    </Button>
                  ))}
                </Space>
              </div>
            ) : null}

            <div className={styles.infoSection}>
              <div className={styles.infoLabel}>Node ID</div>
              <div className={`${styles.infoBlock} ${styles.singleLineValue}`}>
                {graphQueryClickedNode}
              </div>
            </div>

            <div className={styles.infoSection}>
              <div className={styles.infoLabel}>
                {t("knowledge.graphQuery.outgoingRelations")}
              </div>
              {filteredOutgoingRelations.length ? (
                <Space direction="vertical" size={8} className={styles.fullWidth}>
                  {filteredOutgoingRelations.slice(0, 8).map((rel, idx) => {
                    const hopNodeId = extractHopNodeId(rel.object);
                    const canHop = Boolean(hopNodeId) && graphNodeDetails.nodeIdSet.has(hopNodeId);
                    return (
                      <div key={`out-${idx}`} className={styles.infoBlock}>
                        <Typography.Text type="secondary">{rel.predicate}</Typography.Text>
                        <div>{rel.object}</div>
                        <Space size={8} style={{ marginTop: 6 }}>
                          <Tag color="blue">{formatScore(rel.score).value}</Tag>
                          <Button
                            size="small"
                            type="link"
                            disabled={!canHop}
                            onClick={() => canHop && handleGraphNodeHop(hopNodeId)}
                          >
                            {t("knowledge.graphQuery.hop")}
                          </Button>
                        </Space>
                      </div>
                    );
                  })}
                </Space>
              ) : (
                <Empty description={t("knowledge.graphQuery.noOutgoing")} />
              )}
            </div>

            <div className={styles.infoSection}>
              <div className={styles.infoLabel}>
                {t("knowledge.graphQuery.incomingRelations")}
              </div>
              {filteredIncomingRelations.length ? (
                <Space direction="vertical" size={8} className={styles.fullWidth}>
                  {filteredIncomingRelations.slice(0, 8).map((rel, idx) => {
                    const sourceNodeId = safeGraphNodeId(rel.subject);
                    const canHop = Boolean(sourceNodeId) && graphNodeDetails.nodeIdSet.has(sourceNodeId);
                    return (
                      <div key={`in-${idx}`} className={styles.infoBlock}>
                        <Typography.Text type="secondary">{rel.subject}</Typography.Text>
                        <div>{rel.predicate}</div>
                        <Space size={8} style={{ marginTop: 6 }}>
                          <Tag color="purple">{formatScore(rel.score).value}</Tag>
                          <Button
                            size="small"
                            type="link"
                            disabled={!canHop}
                            onClick={() => canHop && handleGraphNodeHop(sourceNodeId)}
                          >
                            {t("knowledge.graphQuery.hop")}
                          </Button>
                        </Space>
                      </div>
                    );
                  })}
                </Space>
              ) : (
                <Empty description={t("knowledge.graphQuery.noIncoming")} />
              )}
            </div>
          </Space>
        ) : null}
      </Drawer>
      <Drawer
        width={520}
        placement="right"
        title={selectedSource?.name?.trim() || t("knowledge.form.id")}
        open={detailDrawerOpen}
        onClose={() => setDetailDrawerOpen(false)}
        destroyOnClose
      >
        {selectedSource ? (
          <Space direction="vertical" size={12} className={styles.fullWidth}>
            {selectedSource.name?.trim() ? (
              <div className={styles.infoSection}>
                <div className={styles.infoLabel}>{t("knowledge.table.subject")}</div>
                <div className={`${styles.infoBlock} ${styles.singleLineValue}`}>
                  {selectedSource.subject || selectedSource.name}
                </div>
              </div>
            ) : null}

            <div className={styles.infoSection}>
              <div className={styles.infoLabel}>{t("knowledge.table.source")}</div>
              <div className={styles.infoBlock}>
                {selectedSourceSummaryData.summary || t("knowledge.inlineText")}
              </div>
            </div>

            {selectedSourceSummaryData.keywords.length > 0 ? (
              <div className={styles.infoSection}>
                <div className={styles.infoLabel}>{t("knowledge.table.keywords")}</div>
                <div className={styles.infoBlock}>
                  <div className={styles.keywordList}>
                    {selectedSourceSummaryData.keywords.map((keyword) => (
                      <Tag key={`drawer-${selectedSource.id}-${keyword}`} className={styles.keywordTag}>
                        {keyword}
                      </Tag>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            <div className={styles.detailTagRow}>
              <span className={styles.originTag}>{selectedSourceOriginText}</span>
              <span className={styles.typeTag}>{selectedSource.type}</span>
            </div>

            <div className={styles.infoSection}>
              <div className={styles.infoLabel}>{t("knowledge.form.id")}</div>
              <div className={`${styles.infoBlock} ${styles.singleLineValue}`}>
                {selectedSource.id}
              </div>
            </div>

            {selectedSource.location ? (
              <div className={styles.infoSection}>
                <div className={styles.infoLabel}>{t("knowledge.table.location")}</div>
                <div className={styles.infoBlock}>{selectedSource.location}</div>
              </div>
            ) : null}

            <div className={styles.infoSection}>
              <div className={styles.infoLabel}>{t("knowledge.table.chunkStats")}</div>
              <div className={`${styles.infoBlock} ${styles.singleLineValue}`}>
                {selectedSourceIndexedCountText}
              </div>
            </div>

            <div className={styles.infoSection}>
              <div className={styles.infoLabel}>{t("knowledge.table.status")}</div>
              <div>
                <span
                  className={
                    selectedSource.status.indexed
                      ? styles.indexedTag
                      : styles.notIndexedTag
                  }
                >
                  {selectedSource.status.indexed
                    ? t("knowledge.indexed")
                    : t("knowledge.notIndexed")}
                </span>
              </div>
            </div>

            {selectedSourceRemoteLine ? (
              <div className={styles.infoSection}>
                <div className={styles.infoLabel}>Remote</div>
                <div className={styles.infoBlock}>{selectedSourceRemoteLine}</div>
              </div>
            ) : null}

            {selectedSource.status.remote_last_error ? (
              <Typography.Text type="secondary" className={styles.remoteError}>
                {t("knowledge.remoteLastError", {
                  error: selectedSource.status.remote_last_error,
                })}
              </Typography.Text>
            ) : null}

            <Divider style={{ margin: "4px 0" }} />

            <div className={styles.infoSection}>
              <div className={styles.infoLabel}>{t("knowledge.documentContent")}</div>
              {sourceContentLoading ? (
                <div className={styles.contentLoadingWrap}>
                  <Spin size="small" />
                </div>
              ) : !sourceContent?.indexed ? (
                <Typography.Text type="secondary" className={styles.contentEmpty}>
                  {selectedSource.status.indexed
                    ? t("knowledge.documentContentEmpty")
                    : t("knowledge.documentContentNotIndexed")}
                </Typography.Text>
              ) : (
                <div className={styles.documentList}>
                  {sourceContent.documents.map((doc, idx) => (
                    <div key={doc.path || idx} className={styles.documentItem}>
                      {sourceContent.documents.length > 1 && (
                        <Typography.Text  className={styles.documentTitle}>
                          {doc.title || doc.path}
                        </Typography.Text>
                      )}
                      <div className={styles.documentMarkdown}>
                        <MarkdownCopy
                          content={doc.text}
                          showMarkdown
                          showControls
                          markdownViewerProps={{
                            className: styles.documentMarkdownViewer,
                            style: {
                              backgroundColor: "transparent",
                              border: "none",
                              maxHeight: 360,
                              padding: 12,
                            },
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Space>
        ) : null}
      </Drawer>
      <input
        type="file"
        ref={singleFileInputRef}
        className={styles.hiddenInput}
        onChange={handleFilePicked}
      />
      <input
        type="file"
        ref={directoryInputRef}
        className={styles.hiddenInput}
        multiple
        onChange={handleDirectoryPicked}
      />
    </div>
  );
}

export default KnowledgePage;