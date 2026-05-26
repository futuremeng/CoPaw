import { useCallback, useState } from "react";
import { message } from "antd";
import { useTranslation } from "react-i18next";
import { agentsApi } from "../../../../api/modules/agents";
import type { AgentProjectSummary, AgentSummary } from "../../../../api/types/agents";
import {
  buildProjectRequestCandidates,
  resolveProjectRequestCandidate,
} from "../utils/projectRequestResolver";

interface UseProjectUploadControllerParams {
  currentAgent?: AgentSummary;
  selectedProject?: AgentProjectSummary;
  resolvedProjectRequestId: string;
  setResolvedProjectRequestId: (value: string) => void;
  onUploadCompleted: (
    agentId: string,
    project: AgentProjectSummary,
  ) => Promise<void>;
}

export default function useProjectUploadController({
  currentAgent,
  selectedProject,
  resolvedProjectRequestId,
  setResolvedProjectRequestId,
  onUploadCompleted,
}: UseProjectUploadControllerParams) {
  const { t } = useTranslation();
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<File[]>([]);
  const [uploadTargetDir, setUploadTargetDir] = useState("");

  const resetUploadState = useCallback(() => {
    setUploadModalOpen(false);
    setPendingUploads([]);
    setUploadTargetDir("");
  }, []);

  const handleUploadFiles = useCallback(async () => {
    if (!currentAgent || !selectedProject || pendingUploads.length === 0) {
      return;
    }

    setUploadingFiles(true);
    let preferredProjectRequestId = resolvedProjectRequestId;

    try {
      let uploadedCount = 0;
      for (const file of pendingUploads) {
        const resolved = await resolveProjectRequestCandidate({
          projectRequestIds: buildProjectRequestCandidates(selectedProject, {
            preferredProjectRequestId,
          }),
          loader: async (projectRequestId) => {
            await agentsApi.uploadProjectFile(
              currentAgent.id,
              projectRequestId,
              file,
              uploadTargetDir,
            );
            return undefined;
          },
        });
        preferredProjectRequestId = resolved.projectRequestId;
        setResolvedProjectRequestId(resolved.projectRequestId);
        uploadedCount += 1;
      }

      await onUploadCompleted(currentAgent.id, selectedProject);
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
    currentAgent,
    onUploadCompleted,
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