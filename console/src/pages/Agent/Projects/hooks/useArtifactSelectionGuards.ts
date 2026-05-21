import { useEffect } from "react";
import type { AgentProjectFileInfo, ProjectPipelineArtifactRecord } from "../../../../api/types/agents";
import { isPreviewablePath } from "../utils/projectFileSelectionUtils";

interface UseArtifactSelectionGuardsParams {
  selectedStepId: string;
  setSelectedStepId: (value: string) => void;
  currentStepIds: string[];
  selectedFilePath: string;
  setSelectedFilePath: (value: string) => void;
  relatedArtifactPathsForSelectedStep: Set<string>;
  artifactRecords: ProjectPipelineArtifactRecord[];
  filesLoading: boolean;
  knownProjectFilePaths: Set<string>;
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
  filesLoading,
  knownProjectFilePaths,
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
    if (filesLoading) {
      return;
    }
    const stillVisible =
      artifactRecords.some((item) => item.path === selectedFilePath)
      || knownProjectFilePaths.has(selectedFilePath)
      || projectFiles.some((item) => item.path === selectedFilePath);
    if (!stillVisible) {
      const rootLevelFallback = projectFiles.find((item) => (
        !item.path.includes("/") && isPreviewablePath(item.path)
      ))?.path || "";
      const projectFilesFallback = projectFiles.find((item) => isPreviewablePath(item.path))?.path || "";
      const artifactFallback = artifactRecords.find((item) => isPreviewablePath(item.path))?.path || "";
      const knownPathFallback = Array.from(knownProjectFilePaths)
        .sort((left, right) => left.localeCompare(right))
        .find((item) => isPreviewablePath(item)) || "";
      setSelectedFilePath(
        rootLevelFallback
        || projectFilesFallback
        || artifactFallback
        || knownPathFallback
        || "",
      );
    }
  }, [
    artifactRecords,
    filesLoading,
    knownProjectFilePaths,
    projectFiles,
    selectedFilePath,
    setSelectedFilePath,
  ]);
}