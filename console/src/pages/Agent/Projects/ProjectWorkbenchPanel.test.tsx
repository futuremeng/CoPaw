import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ProjectWorkbenchPanel from "./ProjectWorkbenchPanel";

vi.mock("./ProjectArtifactsPanel", () => ({
  default: () => <div>artifacts</div>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      maybeFallback?: string | Record<string, unknown>,
      maybeOptions?: Record<string, unknown>,
    ) => {
      const fallback = typeof maybeFallback === "string" ? maybeFallback : key;
      const options = typeof maybeFallback === "object" ? maybeFallback : maybeOptions;
      if (options && "count" in options) {
        return fallback.replace("{{count}}", String(options.count));
      }
      if (options && "path" in options) {
        return fallback.replace("{{path}}", String(options.path));
      }
      return fallback;
    },
  }),
}));

describe("ProjectWorkbenchPanel", () => {
  it("shows a weak background sync notice without replacing the workbench content", async () => {
    const user = userEvent.setup();
    const onDismissSyncNotice = vi.fn();

    render(
      <ProjectWorkbenchPanel
        syncNotice={{
          changedPaths: ["original/new-file.md", "artifact/report.md"],
          updatedAt: Date.now(),
        }}
        filesLoading={false}
        contentLoading={false}
        artifactRecords={[]}
        selectedArtifactRecord={undefined}
        selectedFilePath="original/existing.md"
        knownProjectFilesByPath={{
          "original/existing.md": {
            filename: "existing.md",
            path: "original/existing.md",
            size: 1,
            modified_time: "2026-04-24 16:00:00",
          },
        }}
        projectFiles={[]}
        fileContent="content"
        selectedAttachPaths={[]}
        autoAnalyzeOnAttach={false}
        sendingSelectedFiles={false}
        onToggleAutoAnalyze={vi.fn()}
        onSendSelectedFilesToChat={vi.fn()}
        onDismissSyncNotice={onDismissSyncNotice}
        formatBytes={() => "1 B"}
      />, 
    );

    expect(screen.getByText("Background sync updated project files.")).toBeTruthy();
    expect(screen.getByText("existing.md")).toBeTruthy();
    expect(
      screen.getByText("2 files changed in the background. Workbench stays on your current selection."),
    ).toBeTruthy();
    expect(screen.getByText("artifacts")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismissSyncNotice).toHaveBeenCalledTimes(1);
  });
});