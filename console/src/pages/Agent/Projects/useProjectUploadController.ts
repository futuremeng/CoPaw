import { useCallback, useState } from "react";
import { message } from "antd";
import { useTranslation } from "react-i18next";
import { agentsApi } from "../../../api/modules/agents";
import type { AgentProjectSummary, AgentSummary } from "../../../api/types/agents";

interface UseProjectUploadControllerParams {
  currentAgent?: AgentSummary;
  selectedProject?: AgentProjectSummary;
  resolvedProjectRequestId: string;
  setResolvedProjectRequestId: (value: string) => void;
  buildProjectIdCandidates: (project?: AgentProjectSummary) => string[];
  loadProjectFiles: (agentId: string, project: AgentProjectSummary) => Promise<void>;
}

export default function useProjectUploadController({
  currentAgent,
  selectedProject,
  resolvedProjectRequestId,
  setResolvedProjectRequestId,
  buildProjectIdCandidates,
  loadProjectFiles,
}: UseProjectUploadControllerParams) {
  const { t } = useTranslation();
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<File[]>([]);
  const [uploadTargetDir, setUploadTargetDir] = useState("data");

  const resetUploadState = useCallback(() => {
    setUploadModalOpen(false);
    setPendingUploads([]);
    setUploadTargetDir("data");
  }, []);

  const handleUploadFiles = useCallback(async () => {
    if (!currentAgent || !selectedProject || pendingUploads.length === 0) {
      return;
    }

    setUploadingFiles(true);
    const projectIds = [resolvedProjectRequestId, ...buildProjectIdCandidates(selectedProject)]
      .map((item) => item.trim())
      .filter(Boolean);
    const uniqueProjectIds = Array.from(new Set(projectIds));

    try {
      let uploadedCount = 0;
      for (const file of pendingUploads) {
        let uploaded = false;
        for (const projectRequestId of uniqueProjectIds) {
          try {
            await agentsApi.uploadProjectFile(
              currentAgent.id,
              projectRequestId,
              file,
              uploadTargetDir || "data",
            );
            setResolvedProjectRequestId(projectRequestId);
            uploaded = true;
            uploadedCount += 1;
            break;
          } catch {
            // Try next id candidate.
          }
        }
        if (!uploaded) {
          throw new Error(`upload_failed:${file.name}`);
        }
      }

      await loadProjectFiles(currentAgent.id, selectedProject);
      resetUploadState();
      message.success(
        t("projects.upload.success", "Uploaded {{count}} file(s) to project.", {
          count: uploadedCount,
        }),
      );
    } catch (err) {
      console.error("failed to upload project files", err);
      message.error(t("projects.upload.failed", "Failed to upload project files."));
    } finally {
      setUploadingFiles(false);
    }
  }, [
    buildProjectIdCandidates,
    currentAgent,
    loadProjectFiles,
    pendingUploads,
    resolvedProjectRequestId,
    resetUploadState,
    selectedProject,
    setResolvedProjectRequestId,
    t,
    uploadTargetDir,
  ]);

  return {
    uploadModalOpen,
    setUploadModalOpen,
    uploadingFiles,
    pendingUploads,
    setPendingUploads,
    uploadTargetDir,
    setUploadTargetDir,
    resetUploadState,
    handleUploadFiles,
  };
}