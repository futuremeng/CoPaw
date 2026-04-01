import { useEffect } from "react";
import type { AgentProjectFileInfo, ProjectPipelineArtifactRecord } from "../../../api/types/agents";
import { isPreviewablePath } from "./projectFileSelectionUtils";

interface UseArtifactSelectionGuardsParams {
  selectedStepId: string;
  setSelectedStepId: (value: string) => void;
  currentStepIds: string[];
  selectedFilePath: string;
  setSelectedFilePath: (value: string) => void;
  relatedArtifactPathsForSelectedStep: Set<string>;
  artifactRecords: ProjectPipelineArtifactRecord[];
  projectFiles: AgentProjectFileInfo[];
}

export default function useArtifactSelectionGuards({
  selectedStepId,
  setSelectedStepId,
  currentStepIds,
  selectedFilePath,
  setSelectedFilePath,
  relatedArtifactPathsForSelectedStep,
  artifactRecords,
  projectFiles,
}: UseArtifactSelectionGuardsParams) {
  useEffect(() => {
    if (!selectedStepId) {
      return;
    }
    if (!currentStepIds.includes(selectedStepId)) {
      setSelectedStepId("");
    }
  }, [currentStepIds, selectedStepId, setSelectedStepId]);

  useEffect(() => {
    if (!selectedStepId) {
      return;
    }
    if (selectedFilePath && relatedArtifactPathsForSelectedStep.has(selectedFilePath)) {
      return;
    }
    const firstRelatedPath = Array.from(relatedArtifactPathsForSelectedStep)[0];
    if (firstRelatedPath) {
      setSelectedFilePath(firstRelatedPath);
    }
  }, [
    relatedArtifactPathsForSelectedStep,
    selectedFilePath,
    selectedStepId,
    setSelectedFilePath,
  ]);

  useEffect(() => {
    if (!selectedFilePath) {
      return;
    }
    if (!isPreviewablePath(selectedFilePath)) {
      return;
    }
    const stillVisible =
      artifactRecords.some((item) => item.path === selectedFilePath)
      || projectFiles.some((item) => item.path === selectedFilePath);
    if (!stillVisible) {
      setSelectedFilePath("");
    }
  }, [artifactRecords, projectFiles, selectedFilePath, setSelectedFilePath]);
}