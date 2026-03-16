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
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import api from "../../../api";
import type {
  AgentsRunningConfig,
  KnowledgeConfig,
  KnowledgeHistoryBackfillStatus,
  KnowledgeRegenerateTitlesQueueStatus,
  KnowledgeSearchHit,
  KnowledgeSourceContent,
  KnowledgeSourceItem,
  KnowledgeSourceSpec,
  KnowledgeSourceType,
} from "../../../api/types";
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
  const [backfillStatus, setBackfillStatus] =
    useState<KnowledgeHistoryBackfillStatus | null>(null);
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
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [enableModalOpen, setEnableModalOpen] = useState(false);
  const [enableModalNeedsBackfillChoice, setEnableModalNeedsBackfillChoice] =
    useState(false);
  const [enableModalSubmitting, setEnableModalSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [indexingAll, setIndexingAll] = useState(false);
  const [indexingId, setIndexingId] = useState<string | null>(null);
  const [regeneratingTitles, setRegeneratingTitles] = useState(false);
  const [policyCollapsed, setPolicyCollapsed] = useState(true);
  const [queueStatus, setQueueStatus] =
    useState<KnowledgeRegenerateTitlesQueueStatus | null>(null);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [selectedSource, setSelectedSource] =
    useState<KnowledgeSourceItem | null>(null);
  const [sourceContent, setSourceContent] =
    useState<KnowledgeSourceContent | null>(null);
  const [sourceContentLoading, setSourceContentLoading] = useState(false);
  const [backfillingHistory, setBackfillingHistory] = useState(false);
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
  const remoteStateRef = useRef<Record<string, string | undefined>>({});
  const hasLoadedOnceRef = useRef(false);

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
    } catch (error) {
      console.error("Failed to load knowledge data", error);
      message.error(t("knowledge.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Poll queue status every 5s; refresh sources when job completes
  useEffect(() => {
    let cancelled = false;
    let prevActiveJobId: string | null | undefined = undefined;

    const poll = async () => {
      try {
        const status = await api.getRegenerateKnowledgeTitlesQueueStatus();
        if (cancelled) return;
        setQueueStatus(status);

        // When active job disappears (transitioned to completed), reload source names
        const curJobId = status.active_job?.job_id ?? null;
        if (prevActiveJobId !== undefined && prevActiveJobId !== null && curJobId === null) {
          loadData();
        }
        prevActiveJobId = curJobId;
      } catch {
        // silently ignore poll errors
      }
    };

    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [loadData]);

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
      enableConfigForm.setFieldsValue(runningConfig);
      setEnableModalNeedsBackfillChoice(needsBackfillChoice);
      setEnableModalOpen(true);
    },
    [enableConfigForm, runningConfig],
  );

  const handleConfirmEnable = useCallback(
    async (runBackfillNow: boolean) => {
      if (!config) {
        return;
      }
      try {
        const nextRunningConfig = await enableConfigForm.validateFields();
        setEnableModalSubmitting(true);
        const updatedRunningConfig = await api.updateAgentRunningConfig(
          nextRunningConfig as AgentsRunningConfig,
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
      t,
    ],
  );

  const handleToggleEnabled = async (checked: boolean) => {
    if (!config) {
      return;
    }

    if (!checked) {
      await persistKnowledgeConfig({
        ...config,
        enabled: false,
      });
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
        description: values.description ?? "",
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
  }, [loadData, t]);

  const handleIndexAll = async () => {
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

  const runRegenerateTitles = useCallback(async (forceClear = false) => {
    try {
      setRegeneratingTitles(true);
      const result = await api.regenerateKnowledgeTitles({
        enabledOnly: true,
        batchSize: 5,
        forceClear,
      });
      message.success(
        forceClear
          ? t("knowledge.regenerateTitlesRestarted", {
              total: result.job.total,
              batchSize: result.job.batch_size,
              cleared: result.cleared_jobs ?? 0,
            })
          : t("knowledge.regenerateTitlesQueued", {
              total: result.job.total,
              batchSize: result.job.batch_size,
            }),
      );
      // Immediately reflect new queue status without waiting for next poll
      const freshStatus = await api.getRegenerateKnowledgeTitlesQueueStatus();
      setQueueStatus(freshStatus);
    } catch (error) {
      console.error("Failed to regenerate knowledge titles", error);
      message.error(t("knowledge.regenerateTitlesFailed"));
    } finally {
      setRegeneratingTitles(false);
    }
  }, [t]);

  const handleRegenerateTitles = useCallback(() => {
    const enabledCount = sources.filter((item) => item.enabled).length;
    Modal.confirm({
      title: t("knowledge.regenerateTitlesConfirmTitle"),
      content: t("knowledge.regenerateTitlesConfirmContent", {
        total: sources.length,
        enabled: enabledCount,
      }),
      okText: t("knowledge.regenerateTitlesConfirmOk"),
      cancelText: t("common.cancel"),
      okButtonProps: {
        danger: true,
      },
      onOk: async () => {
        const latestQueue = await api.getRegenerateKnowledgeTitlesQueueStatus();
        setQueueStatus(latestQueue);
        if (latestQueue.has_active_job && latestQueue.active_job) {
          Modal.confirm({
            title: t("knowledge.regenerateTitlesQueueExistsTitle"),
            content: t("knowledge.regenerateTitlesQueueExistsContent", {
              status: latestQueue.active_job.status,
              processed: latestQueue.active_job.processed,
              total: latestQueue.active_job.total,
            }),
            okText: t("knowledge.regenerateTitlesQueueForceOk"),
            cancelText: t("common.cancel"),
            okButtonProps: {
              danger: true,
            },
            onOk: async () => {
              await runRegenerateTitles(true);
            },
          });
          return;
        }
        await runRegenerateTitles(false);
      },
    });
  }, [runRegenerateTitles, sources, t]);

  const handleSearch = async () => {
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
    "auto_collect_long_text",
    enableConfigForm,
  );
  const showBackfillNowButton = Boolean(
    config?.enabled &&
      backfillStatus?.marked_unbackfilled &&
      backfillStatus?.has_pending_history,
  );

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
          <Typography.Text>{t("knowledge.enabled")}</Typography.Text>
          <Switch
            checked={config?.enabled ?? false}
            onChange={handleToggleEnabled}
          />
          <Button icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            {t("knowledge.addSource")}
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleIndexAll}
            loading={indexingAll}
          >
            {t("knowledge.indexAll")}
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleRegenerateTitles}
            loading={regeneratingTitles}
          >
            {t("knowledge.regenerateTitles")}
          </Button>
          {showBackfillNowButton ? (
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRunHistoryBackfillNow}
              loading={backfillingHistory}
            >
              {t("knowledge.backfillNowButton")}
            </Button>
          ) : null}
        </div>
      </div>

      <Space direction="vertical" size={16} className={styles.contentStack}>

      {/* Queue status banner — shown whenever a regen job is active OR recently completed */}
      {(queueStatus?.has_active_job || queueStatus?.last_completed_job) ? (() => {
        const job = queueStatus!.active_job;
        const lastDone = queueStatus!.last_completed_job;
        const jobStatus = job?.status;
        const isQueued = jobStatus === "queued";
        const isRunning = jobStatus === "running";
        const isWaiting = jobStatus === "waiting_llm";
        const runningJobs = queueStatus!.running_jobs ?? 0;
        const activeJobs = queueStatus!.queued_jobs ?? 0;
        const percent = job && job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;
        const remaining = job ? Math.max(0, job.total - job.processed) : 0;
        const remainingBatches = job && job.batch_size > 0 ? Math.ceil(remaining / job.batch_size) : 0;
        const lastDuration = typeof job?.last_item_duration_ms === "number"
          ? (job.last_item_duration_ms / 1000).toFixed(1)
          : null;
        const avgDuration = typeof job?.avg_item_duration_ms === "number"
          ? (job.avg_item_duration_ms / 1000).toFixed(1)
          : null;
        const yieldSeconds = typeof job?.yield_interval_seconds === "number"
          ? job.yield_interval_seconds.toFixed(job.yield_interval_seconds >= 10 ? 0 : 1)
          : null;
        const effectiveYieldSeconds = typeof job?.effective_yield_seconds === "number"
          ? job.effective_yield_seconds.toFixed(job.effective_yield_seconds >= 10 ? 0 : 1)
          : null;
        const yieldMode = job?.yield_mode === "adaptive"
          ? t("knowledge.queueYieldModeAdaptive")
          : t("knowledge.queueYieldModeFixed");
        const dispatchAgeSeconds = typeof job?.dispatch_age_seconds === "number"
          ? job.dispatch_age_seconds.toFixed(1)
          : "-";
        const inferredRunningSourceId = (() => {
          if (!job || !Array.isArray(job.source_ids) || job.source_ids.length === 0) {
            return null;
          }
          const cursor = typeof job.cursor === "number" ? job.cursor : 0;
          if (cursor >= 0 && cursor < job.source_ids.length) {
            return job.source_ids[cursor];
          }
          if (cursor > 0 && cursor - 1 < job.source_ids.length) {
            return job.source_ids[cursor - 1];
          }
          return null;
        })();
        const runningSourceId =
          job?.current_source_id ?? job?.last_processed_source_id ?? inferredRunningSourceId;
        const yieldReasonText = (() => {
          const reason = job?.yield_reason;
          if (reason === "burst_window") {
            return t("knowledge.queueYieldReasonBurst");
          }
          if (reason === "active_window") {
            return t("knowledge.queueYieldReasonActive");
          }
          if (reason === "outside_active_window") {
            return t("knowledge.queueYieldReasonOutside");
          }
          if (reason === "invalid_dispatch_time") {
            return t("knowledge.queueYieldReasonInvalid");
          }
          if (reason === "yield_disabled") {
            return t("knowledge.queueYieldReasonDisabled");
          }
          return t("knowledge.queueYieldReasonNoRecent");
        })();
        const lastDoneTime = lastDone?.updated_at
          ? new Date(lastDone.updated_at).toLocaleString()
          : null;
        return (
          <div className={`${styles.queueBanner} ${isWaiting ? styles.queueBannerWaiting : ""} ${!job && lastDone ? styles.queueBannerDone : ""}`}>
            <div className={styles.queueBannerLeft}>
              <SyncOutlined spin={isRunning} className={styles.queueBannerIcon} />
              <div className={styles.queueBannerText}>
                {job ? (
                  <Typography.Text >
                    {isQueued
                      ? t("knowledge.queueStatusQueued", {
                          total: job.total,
                          remainingBatches,
                        })
                      : isWaiting
                      ? t("knowledge.queueStatusWaiting")
                      : t("knowledge.queueStatusRunning", {
                          processed: job.processed,
                          total: job.total,
                          remainingBatches,
                        })}
                  </Typography.Text>
                ) : lastDone ? (
                  <Typography.Text >
                    {t("knowledge.queueStatusCompleted", { updated: lastDone.updated, total: lastDone.total })}
                  </Typography.Text>
                ) : null}
                <div className={styles.queueBannerMeta}>
                  <Tag color={activeJobs > 0 ? "processing" : "default"} style={{ marginInlineEnd: 4 }}>
                    {t("knowledge.queueActiveCount", { count: activeJobs })}
                  </Tag>
                  <Tag color={runningJobs > 0 ? "processing" : "default"} style={{ marginInlineEnd: 4 }}>
                    {t("knowledge.queueRunningCount", { count: runningJobs })}
                  </Tag>
                  {runningSourceId ? (
                    <Tag color="gold" style={{ marginInlineEnd: 4 }}>
                      {t("knowledge.queueRunningSourceIdShort", {
                        id: runningSourceId,
                      })}
                    </Tag>
                  ) : null}
                  {job && (
                    <Typography.Text className={styles.queueBannerSub}>
                      {t("knowledge.queueStatusDetail", {
                        batchSize: job.batch_size,
                        updated: job.updated,
                      })}
                    </Typography.Text>
                  )}
                  {job && (lastDuration || avgDuration || yieldSeconds) && (
                    <div className={styles.queueBannerMetaAction}>
                      <Typography.Text className={styles.queueBannerSub}>
                        {t("knowledge.queueLlmTiming", {
                          last: lastDuration ?? "-",
                          avg: avgDuration ?? "-",
                          wait: yieldSeconds ?? "-",
                        })}
                      </Typography.Text>
                      <Typography.Text className={styles.queueBannerSub}>
                        {t("knowledge.queueYieldMode", {
                          mode: yieldMode,
                          effective: effectiveYieldSeconds ?? yieldSeconds ?? "-",
                        })}
                      </Typography.Text>
                      <Typography.Text className={styles.queueBannerSub}>
                        {t("knowledge.queueYieldReason", {
                          reason: yieldReasonText,
                          age: dispatchAgeSeconds,
                        })}
                      </Typography.Text>
                      <Button
                        type="link"
                        size="small"
                        className={styles.queueBannerActionButton}
                        onClick={() => navigate("/agent-config")}
                      >
                        {t("knowledge.queueAdjustYield")}
                      </Button>
                    </div>
                  )}
                  {lastDoneTime && (
                    <Typography.Text className={styles.queueBannerSub}>
                      {t("knowledge.queueLastCompleted", {
                        time: lastDoneTime,
                        updated: lastDone!.updated,
                        total: lastDone!.total,
                        useLlm: lastDone!.use_llm ? "LLM" : t("knowledge.queueLocalRule"),
                      })}
                    </Typography.Text>
                  )}
                </div>
              </div>
            </div>
            <div className={styles.queueBannerRight}>
              {job && (
                <Progress
                  percent={percent}
                  size="small"
                  style={{ width: 160, margin: 0 }}
                  status={isWaiting ? "exception" : isRunning ? "active" : "normal"}
                  strokeColor={isWaiting ? "#faad14" : isQueued ? "#91a3c0" : undefined}
                />
              )}
            </div>
          </div>
        );
      })() : null}

      <Card>
        <div className={styles.policyCard}>
          <div className={styles.policyHeader}>
            <div>
              <Typography.Text >
                {t("knowledge.automationSummaryTitle")}
              </Typography.Text>
              <Typography.Paragraph className={styles.policyDescription}>
                {t("knowledge.automationSummaryDesc")}
              </Typography.Paragraph>
            </div>
            <Space>
              <Button type="text" onClick={() => setPolicyCollapsed((prev) => !prev)}>
                {policyCollapsed
                  ? t("knowledge.expandPolicy")
                  : t("knowledge.collapsePolicy")}
              </Button>
              <Button onClick={() => navigate("/agent-config")}>
                {t("knowledge.goToRuntimeConfig")}
              </Button>
            </Space>
          </div>

          {!policyCollapsed ? (
            <div className={styles.policyGrid}>
              <div className={styles.policyItem}>
                <Typography.Text>{t("agentConfig.autoCollectChatFiles")}</Typography.Text>
                <Tag
                  color={
                    runningConfig?.auto_collect_chat_files ? "green" : "default"
                  }
                >
                  {runningConfig?.auto_collect_chat_files
                    ? t("common.enabled")
                    : t("common.disabled")}
                </Tag>
              </div>
              <div className={styles.policyItem}>
                <Typography.Text>{t("agentConfig.autoCollectChatUrls")}</Typography.Text>
                <Tag
                  color={runningConfig?.auto_collect_chat_urls ? "green" : "default"}
                >
                  {runningConfig?.auto_collect_chat_urls
                    ? t("common.enabled")
                    : t("common.disabled")}
                </Tag>
              </div>
              <div className={styles.policyItem}>
                <Typography.Text>{t("agentConfig.autoCollectLongText")}</Typography.Text>
                <Tag
                  color={runningConfig?.auto_collect_long_text ? "green" : "default"}
                >
                  {runningConfig?.auto_collect_long_text
                    ? t("common.enabled")
                    : t("common.disabled")}
                </Tag>
              </div>
              <div className={styles.policyItem}>
                <Typography.Text>{t("agentConfig.longTextMinChars")}</Typography.Text>
                <Tag color="blue">{runningConfig?.long_text_min_chars ?? 2000}</Tag>
              </div>
              <div className={styles.policyItem}>
                <Typography.Text>{t("agentConfig.knowledgeChunkSize")}</Typography.Text>
                <Tag color="blue">{runningConfig?.knowledge_chunk_size ?? 1200}</Tag>
              </div>
              <div className={styles.policyItem}>
                <Typography.Text>{t("agentConfig.knowledgeMaintenanceLlmYieldSeconds")}</Typography.Text>
                <Tag color="blue">
                  {runningConfig?.knowledge_maintenance_llm_yield_seconds ?? 2.0}s
                </Tag>
              </div>
              <div className={styles.policyItem}>
                <Typography.Text>{t("agentConfig.knowledgeTitleRegenAdaptiveActiveWindowSeconds")}</Typography.Text>
                <Tag color="blue">
                  {runningConfig?.knowledge_title_regen_adaptive_active_window_seconds ?? 60}s
                </Tag>
              </div>
              <div className={styles.policyItem}>
                <Typography.Text>{t("agentConfig.knowledgeTitleRegenAdaptiveBurstWindowSeconds")}</Typography.Text>
                <Tag color="blue">
                  {runningConfig?.knowledge_title_regen_adaptive_burst_window_seconds ?? 15}s
                </Tag>
              </div>
              <div className={styles.policyItem}>
                <Typography.Text>{t("agentConfig.knowledgeTitleRegenAdaptiveActiveMultiplier")}</Typography.Text>
                <Tag color="blue">
                  {runningConfig?.knowledge_title_regen_adaptive_active_multiplier ?? 2.0}x
                </Tag>
              </div>
              <div className={styles.policyItem}>
                <Typography.Text>{t("agentConfig.knowledgeTitleRegenAdaptiveBurstMultiplier")}</Typography.Text>
                <Tag color="blue">
                  {runningConfig?.knowledge_title_regen_adaptive_burst_multiplier ?? 3.0}x
                </Tag>
              </div>
              <div className={styles.policyItem}>
                <Typography.Text>{t("agentConfig.knowledgeTitleRegenPrompt")}</Typography.Text>
                <Tag color="blue">
                  {runningConfig?.knowledge_title_regen_prompt ?? "给以下内容起一个标题，一般10个字到20个字。"}
                </Tag>
              </div>
            </div>
          ) : null}
        </div>
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
          <Space.Compact className={styles.fullWidth}>
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
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("knowledge.searchPlaceholder")}
              onPressEnter={handleSearch}
            />
            <Button
              type="primary"
              icon={<SearchOutlined />}
              loading={searching}
              onClick={handleSearch}
            >
              {t("knowledge.search")}
            </Button>
          </Space.Compact>
        </Space>
        <div className={styles.searchResultsWrap}>
          {hits.length === 0 ? (
            <Empty description={t("knowledge.searchEmpty")} />
          ) : (
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
          )}
        </div>
      </Card>

      <Card loading={loading}>
        <Space className={styles.sourceToolbar} align="center">
          <Typography.Text>{t("knowledge.sourceOriginFilter")}</Typography.Text>
          <Select
            value={sourceOriginFilter}
            onChange={(value) => setSourceOriginFilter(value as SourceOriginFilter)}
            options={[
              { label: t("knowledge.originAll"), value: "all" },
              { label: t("knowledge.originManual"), value: "manual" },
              { label: t("knowledge.originAuto"), value: "auto" },
            ]}
            className={styles.originSelect}
          />
          <Typography.Text>{t("knowledge.sourceTypeFilter")}</Typography.Text>
          <Select
            value={sourceTypeFilter}
            onChange={(value) => setSourceTypeFilter(value as KnowledgeSourceType | "all")}
            options={[
              { label: t("knowledge.allTypes"), value: "all" },
              ...SOURCE_TYPE_OPTIONS,
            ]}
            className={styles.originSelect}
          />
        </Space>
        {filteredSources.length === 0 ? (
          <Empty description={t("knowledge.empty")} />
        ) : (
          <div className={styles.sourceCards}>
            {filteredSources.map((record) => {
              const originText = getSourceOriginText(record, t);
              const remoteLine = formatRemoteStatus(record, t);
              const queueRunningSourceId =
                queueStatus?.active_job?.current_source_id ??
                queueStatus?.active_job?.last_processed_source_id ??
                (() => {
                  const activeJob = queueStatus?.active_job;
                  if (!activeJob || !Array.isArray(activeJob.source_ids) || activeJob.source_ids.length === 0) {
                    return null;
                  }
                  const cursor = typeof activeJob.cursor === "number" ? activeJob.cursor : 0;
                  if (cursor >= 0 && cursor < activeJob.source_ids.length) {
                    return activeJob.source_ids[cursor];
                  }
                  if (cursor > 0 && cursor - 1 < activeJob.source_ids.length) {
                    return activeJob.source_ids[cursor - 1];
                  }
                  return null;
                })();
              const queueJobStatus = queueStatus?.active_job?.status;
              const isQueueActiveCard =
                (queueJobStatus === "running" || queueJobStatus === "waiting_llm") &&
                queueRunningSourceId === record.id;
              const isActiveCard = indexingId === record.id || isQueueActiveCard;
              const indexedCountText = record.status.indexed
                ? t("knowledge.indexedCount", {
                    documents: record.status.document_count,
                    chunks: record.status.chunk_count,
                  })
                : "-";
              return (
                <div key={record.id} className={styles.copawCard}>
                  <div className={styles.copawCardBody}>
                    <div className={styles.copawSparkCardWrapper}>
                      <div
                        className={`${styles.copawSparkContent} ${isActiveCard ? styles.copawSparkContentActive : ""}`}
                        aria-busy={isActiveCard}
                      >
                        <div className={styles.sourceCardBody}>
                          <div className={styles.sourceCardHeader}>
                            <div className={styles.sourceMainInfo}>
                              <div className={styles.sourceHeaderTopRow}>
                                <Typography.Text type="secondary" className={styles.sourceHeaderId}>
                                  {record.id}
                                </Typography.Text>
                                {isQueueActiveCard ? (
                                  <span className={styles.sourceRunningTag}>
                                    {t("knowledge.queueCardRunning")}
                                  </span>
                                ) : null}
                                <span className={`${styles.sourceTypeTag} ${styles.sourceHeaderTypeTag}`}>
                                  {record.type}
                                </span>
                                <span className={styles.sourceOriginTag}>{originText}</span>
                              </div>
                            </div>
                          </div>

                          <div className={styles.sourceMeta}>
                            <div className={styles.sourceInfoSection}>
                              <div className={styles.sourceInfoLabel}>
                                {t("knowledge.table.source")}
                              </div>
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => openDetailDrawer(record)}
                                onKeyDown={(event) =>
                                  handleDetailDrawerValueKeyDown(event, record)
                                }
                                className={`${styles.sourceInfoBlock} ${styles.sourceLocationButton}`}
                                title={record.name}
                              >
                                <Typography.Text
                                  
                                  className={styles.sourceTitle}
                                  title={record.name}
                                >
                                  {record.name}
                                </Typography.Text>
                              </div>
                            </div>

                            <div className={styles.sourceInfoSection}>
                              <div className={styles.sourceInfoLabel}>
                                {t("knowledge.table.location")}
                              </div>
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => openDetailDrawer(record)}
                                onKeyDown={(event) =>
                                  handleDetailDrawerValueKeyDown(event, record)
                                }
                                className={`${styles.sourceInfoBlock} ${styles.sourceSingleLineValue} ${styles.sourceLocationButton}`}
                                title={record.location || record.description || t("knowledge.inlineText")}
                              >
                                {record.location || record.description || t("knowledge.inlineText")}
                              </div>
                            </div>

                            <div className={styles.sourceInfoSection}>
                              <div className={styles.sourceInfoLabel}>
                                {t("knowledge.statusAndStats")}
                              </div>
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => openDetailDrawer(record)}
                                onKeyDown={(event) =>
                                  handleDetailDrawerValueKeyDown(event, record)
                                }
                                className={`${styles.sourceInfoBlock} ${styles.sourceLocationButton}`}
                              >
                                <div className={styles.sourceStatusStatsRow}>
                                  <div className={styles.sourceInfoTagWrap}>
                                    <span
                                      className={
                                        record.status.indexed
                                          ? styles.sourceIndexedTag
                                          : styles.sourceNotIndexedTag
                                      }
                                    >
                                      {record.status.indexed
                                        ? t("knowledge.indexed")
                                        : t("knowledge.notIndexed")}
                                    </span>
                                  </div>
                                  <Typography.Text type="secondary" className={styles.sourceStatsText}>
                                    {indexedCountText}
                                  </Typography.Text>
                                </div>
                                {remoteLine ? (
                                  <div className={styles.sourceStatusStatsSubRow}>
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
                        </div>

                        <div className={styles.sourceCardFooter}>
                          <div className={styles.sourceActions}>
                            <Button
                              type="link"
                              size="small"
                              className={styles.sourceActionButton}
                              loading={indexingId === record.id}
                              onClick={() => handleIndexSource(record.id)}
                            >
                              {record.status.indexed
                                ? t("knowledge.reindex")
                                : t("knowledge.indexNow")}
                            </Button>
                            <Button
                              type="text"
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              className={styles.sourceDeleteButton}
                              onClick={() =>
                                handleConfirmDeleteSource(record.id, record.name)
                              }
                              title={t("common.delete")}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

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
        destroyOnClose
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
            description: "",
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
          <Form.Item name="description" label={t("knowledge.form.description")}>
            <Input placeholder={t("knowledge.form.descriptionPlaceholder")} />
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
        destroyOnClose={false}
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
              name="auto_collect_chat_files"
              valuePropName="checked"
              tooltip={t("agentConfig.autoCollectChatFilesTooltip")}
            >
              <Switch />
            </Form.Item>
            <Form.Item
              label={t("agentConfig.autoCollectChatUrls")}
              name="auto_collect_chat_urls"
              valuePropName="checked"
              tooltip={t("agentConfig.autoCollectChatUrlsTooltip")}
            >
              <Switch />
            </Form.Item>
            <Form.Item
              label={t("agentConfig.autoCollectLongText")}
              name="auto_collect_long_text"
              valuePropName="checked"
              tooltip={t("agentConfig.autoCollectLongTextTooltip")}
            >
              <Switch />
            </Form.Item>
            <Form.Item
              label={t("agentConfig.longTextMinChars")}
              name="long_text_min_chars"
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
            <Form.Item
              label={t("agentConfig.knowledgeMaintenanceLlmYieldSeconds")}
              name="knowledge_maintenance_llm_yield_seconds"
              rules={[
                {
                  required: true,
                  message: t("agentConfig.knowledgeMaintenanceLlmYieldSecondsRequired"),
                },
                {
                  type: "number",
                  min: 0,
                  message: t("agentConfig.knowledgeMaintenanceLlmYieldSecondsMin"),
                },
              ]}
              tooltip={t("agentConfig.knowledgeMaintenanceLlmYieldSecondsTooltip")}
            >
              <InputNumber
                style={{ width: "100%" }}
                min={0}
                max={30}
                step={0.5}
                placeholder={t("agentConfig.knowledgeMaintenanceLlmYieldSecondsPlaceholder")}
              />
            </Form.Item>
            <Form.Item
              label={t("agentConfig.knowledgeTitleRegenAdaptiveActiveWindowSeconds")}
              name="knowledge_title_regen_adaptive_active_window_seconds"
              rules={[
                {
                  required: true,
                  message: t("agentConfig.knowledgeTitleRegenAdaptiveActiveWindowSecondsRequired"),
                },
                {
                  type: "number",
                  min: 0,
                  message: t("agentConfig.knowledgeTitleRegenAdaptiveActiveWindowSecondsMin"),
                },
              ]}
              tooltip={t("agentConfig.knowledgeTitleRegenAdaptiveActiveWindowSecondsTooltip")}
            >
              <InputNumber
                style={{ width: "100%" }}
                min={0}
                max={600}
                step={1}
                placeholder={t("agentConfig.knowledgeTitleRegenAdaptiveActiveWindowSecondsPlaceholder")}
              />
            </Form.Item>
            <Form.Item
              label={t("agentConfig.knowledgeTitleRegenAdaptiveBurstWindowSeconds")}
              name="knowledge_title_regen_adaptive_burst_window_seconds"
              rules={[
                {
                  required: true,
                  message: t("agentConfig.knowledgeTitleRegenAdaptiveBurstWindowSecondsRequired"),
                },
                {
                  type: "number",
                  min: 0,
                  message: t("agentConfig.knowledgeTitleRegenAdaptiveBurstWindowSecondsMin"),
                },
              ]}
              tooltip={t("agentConfig.knowledgeTitleRegenAdaptiveBurstWindowSecondsTooltip")}
            >
              <InputNumber
                style={{ width: "100%" }}
                min={0}
                max={300}
                step={1}
                placeholder={t("agentConfig.knowledgeTitleRegenAdaptiveBurstWindowSecondsPlaceholder")}
              />
            </Form.Item>
            <Form.Item
              label={t("agentConfig.knowledgeTitleRegenAdaptiveActiveMultiplier")}
              name="knowledge_title_regen_adaptive_active_multiplier"
              rules={[
                {
                  required: true,
                  message: t("agentConfig.knowledgeTitleRegenAdaptiveActiveMultiplierRequired"),
                },
                {
                  type: "number",
                  min: 1,
                  message: t("agentConfig.knowledgeTitleRegenAdaptiveActiveMultiplierMin"),
                },
              ]}
              tooltip={t("agentConfig.knowledgeTitleRegenAdaptiveActiveMultiplierTooltip")}
            >
              <InputNumber
                style={{ width: "100%" }}
                min={1}
                max={10}
                step={0.1}
                placeholder={t("agentConfig.knowledgeTitleRegenAdaptiveActiveMultiplierPlaceholder")}
              />
            </Form.Item>
            <Form.Item
              label={t("agentConfig.knowledgeTitleRegenAdaptiveBurstMultiplier")}
              name="knowledge_title_regen_adaptive_burst_multiplier"
              rules={[
                {
                  required: true,
                  message: t("agentConfig.knowledgeTitleRegenAdaptiveBurstMultiplierRequired"),
                },
                {
                  type: "number",
                  min: 1,
                  message: t("agentConfig.knowledgeTitleRegenAdaptiveBurstMultiplierMin"),
                },
              ]}
              tooltip={t("agentConfig.knowledgeTitleRegenAdaptiveBurstMultiplierTooltip")}
            >
              <InputNumber
                style={{ width: "100%" }}
                min={1}
                max={10}
                step={0.1}
                placeholder={t("agentConfig.knowledgeTitleRegenAdaptiveBurstMultiplierPlaceholder")}
              />
            </Form.Item>
            <Form.Item
              label={t("agentConfig.knowledgeTitleRegenPrompt")}
              name="knowledge_title_regen_prompt"
              rules={[
                {
                  required: true,
                  message: t("agentConfig.knowledgeTitleRegenPromptRequired"),
                },
              ]}
              tooltip={t("agentConfig.knowledgeTitleRegenPromptTooltip")}
            >
              <Input.TextArea
                autoSize={{ minRows: 2, maxRows: 4 }}
                maxLength={500}
                placeholder={t("agentConfig.knowledgeTitleRegenPromptPlaceholder")}
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
        width={520}
        placement="right"
        title={selectedSource?.name || t("knowledge.form.name")}
        open={detailDrawerOpen}
        onClose={() => setDetailDrawerOpen(false)}
        destroyOnClose
      >
        {selectedSource ? (
          <Space direction="vertical" size={12} className={styles.fullWidth}>
            <div className={styles.detailTagRow}>
              <span className={styles.sourceOriginTag}>{selectedSourceOriginText}</span>
              <span className={styles.sourceTypeTag}>{selectedSource.type}</span>
            </div>

            <div className={styles.sourceInfoSection}>
              <div className={styles.sourceInfoLabel}>{t("knowledge.form.id")}</div>
              <div className={`${styles.sourceInfoBlock} ${styles.sourceSingleLineValue}`}>
                {selectedSource.id}
              </div>
            </div>

            <div className={styles.sourceInfoSection}>
              <div className={styles.sourceInfoLabel}>{t("knowledge.table.location")}</div>
              <div className={styles.sourceInfoBlock}>
                {selectedSource.location || selectedSource.description || t("knowledge.inlineText")}
              </div>
            </div>

            <div className={styles.sourceInfoSection}>
              <div className={styles.sourceInfoLabel}>{t("knowledge.table.chunkStats")}</div>
              <div className={`${styles.sourceInfoBlock} ${styles.sourceSingleLineValue}`}>
                {selectedSourceIndexedCountText}
              </div>
            </div>

            <div className={styles.sourceInfoSection}>
              <div className={styles.sourceInfoLabel}>{t("knowledge.table.status")}</div>
              <div className={styles.sourceInfoTagWrap}>
                <span
                  className={
                    selectedSource.status.indexed
                      ? styles.sourceIndexedTag
                      : styles.sourceNotIndexedTag
                  }
                >
                  {selectedSource.status.indexed
                    ? t("knowledge.indexed")
                    : t("knowledge.notIndexed")}
                </span>
              </div>
            </div>

            {selectedSourceRemoteLine ? (
              <div className={styles.sourceInfoSection}>
                <div className={styles.sourceInfoLabel}>Remote</div>
                <div className={styles.sourceInfoBlock}>{selectedSourceRemoteLine}</div>
              </div>
            ) : null}

            {selectedSource.status.remote_last_error ? (
              <Typography.Text type="secondary" className={styles.remoteError}>
                {t("knowledge.remoteLastError", {
                  error: selectedSource.status.remote_last_error,
                })}
              </Typography.Text>
            ) : null}

            {selectedSource.description ? (
              <div className={styles.sourceInfoSection}>
                <div className={styles.sourceInfoLabel}>{t("knowledge.form.description")}</div>
                <div className={styles.sourceInfoBlock}>{selectedSource.description}</div>
              </div>
            ) : null}

            <Divider style={{ margin: "4px 0" }} />

            <div className={styles.sourceInfoSection}>
              <div className={styles.sourceInfoLabel}>{t("knowledge.documentContent")}</div>
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
                      <pre className={styles.documentText}>{doc.text}</pre>
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
      </Space>
    </div>
  );
}

export default KnowledgePage;