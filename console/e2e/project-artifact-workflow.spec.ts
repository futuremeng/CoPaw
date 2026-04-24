import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

type ArtifactItem = {
  id: string;
  name: string;
  kind: "skill" | "script" | "flow" | "case";
  origin: string;
  status: string;
  version: string;
  artifact_file_path: string;
  version_history: Array<{ version: string; file_path: string }>;
  tags: string[];
  derived_from_ids: string[];
  distillation_note: string;
  market_source_id: string | null;
  market_item_id: string | null;
};

function buildProject(
  artifactProfile: {
    skills: ArtifactItem[];
    scripts: ArtifactItem[];
    flows: ArtifactItem[];
    cases: ArtifactItem[];
  },
  artifactDistillMode: "file_scan" | "conversation_evidence" = "file_scan",
) {
  return {
    id: "p1",
    name: "Project One",
    description: "Artifact workflow e2e",
    status: "active",
    workspace_dir: "/tmp/default/projects/p1",
    data_dir: "/tmp/default/projects/p1/.data",
    metadata_file: "PROJECT.md",
    tags: [],
    artifact_distill_mode: artifactDistillMode,
    artifact_profile: artifactProfile,
    updated_time: "2026-03-23T00:00:00Z",
  };
}

async function setupProjectOverviewFilterMocks(page: Page) {
  const artifactProfile = {
    skills: [
      {
        id: "quick_start",
        name: "Quick Start",
        kind: "skill" as const,
        origin: "project-distilled",
        status: "stable",
        version: "v1",
        artifact_file_path: ".skills/quick_start.md",
        version_history: [{ version: "v1", file_path: ".skills/quick_start.md" }],
        tags: ["skill"],
        derived_from_ids: [],
        distillation_note: "Skill note",
        market_source_id: null,
        market_item_id: null,
      },
    ],
    scripts: [
      {
        id: "cleanup_script",
        name: "Cleanup Script",
        kind: "script" as const,
        origin: "project-distilled",
        status: "active",
        version: "v1",
        artifact_file_path: ".scripts/cleanup.py",
        version_history: [{ version: "v1", file_path: ".scripts/cleanup.py" }],
        tags: ["script"],
        derived_from_ids: [],
        distillation_note: "Script note",
        market_source_id: null,
        market_item_id: null,
      },
    ],
    flows: [
      {
        id: "review_flow",
        name: "Review Flow",
        kind: "flow" as const,
        origin: "project-distilled",
        status: "active",
        version: "v1",
        artifact_file_path: ".flows/review.flow.json",
        version_history: [{ version: "v1", file_path: ".flows/review.flow.json" }],
        tags: ["flow"],
        derived_from_ids: [],
        distillation_note: "Flow note",
        market_source_id: null,
        market_item_id: null,
      },
    ],
    cases: [
      {
        id: "case_a",
        name: "Case A",
        kind: "case" as const,
        origin: "project-distilled",
        status: "active",
        version: "v1",
        artifact_file_path: ".cases/case_a.md",
        version_history: [{ version: "v1", file_path: ".cases/case_a.md" }],
        tags: ["case"],
        derived_from_ids: [],
        distillation_note: "Case note",
        market_source_id: null,
        market_item_id: null,
      },
    ],
  };

  const projectFiles = [
    { filename: "brief.md", path: "original/brief.md", size: 123, modified_time: "2026-03-23T00:00:00Z" },
    { filename: "quick_start.md", path: ".skills/quick_start.md", size: 123, modified_time: "2026-03-23T00:00:00Z" },
    { filename: "cleanup.py", path: ".scripts/cleanup.py", size: 123, modified_time: "2026-03-23T00:00:00Z" },
    { filename: "review.flow.json", path: ".flows/review.flow.json", size: 123, modified_time: "2026-03-23T00:00:00Z" },
    { filename: "case_a.md", path: ".cases/case_a.md", size: 123, modified_time: "2026-03-23T00:00:00Z" },
    { filename: "design_notes.md", path: "notes/design_notes.md", size: 123, modified_time: "2026-03-23T00:00:00Z" },
    { filename: "PROJECT.md", path: "PROJECT.md", size: 123, modified_time: "2026-03-23T00:00:00Z" },
  ];

  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname.replace(/^\/console(?=\/api\/)/, "");

    if (!pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }

    if (pathname === "/api/auth/status") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enabled: false }),
      });
      return;
    }

    if (pathname === "/api/models") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
      return;
    }

    if (pathname === "/api/models/active") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ active_llm: null }),
      });
      return;
    }

    if (pathname === "/api/agent/running-config") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ knowledge_enabled: true }),
      });
      return;
    }

    if (pathname === "/api/chats") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
      return;
    }

    if (pathname.startsWith("/api/chats/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ messages: [], status: "idle", has_more: false, total: 0 }),
      });
      return;
    }

    if (pathname === "/api/agents") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          agents: [
            {
              id: "default",
              name: "Default",
              description: "",
              workspace_dir: "/tmp/default",
              projects: [buildProject(artifactProfile)],
            },
          ],
        }),
      });
      return;
    }

    if (pathname === "/api/agents/default/projects/p1/files") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(projectFiles),
      });
      return;
    }

    if (pathname === "/api/agents/default/projects/p1/pipelines/templates") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
      return;
    }

    if (pathname === "/api/agents/default/projects/p1/pipelines/runs") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "run-42",
            template_id: "",
            status: "succeeded",
            created_at: "2026-03-23T00:00:00Z",
            updated_at: "2026-03-23T00:10:00Z",
          },
        ]),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });
}

function metricCard(page: Page, label: RegExp) {
  return page.locator('[class*="metricFilterCard"]', { hasText: label }).first();
}

function treeText(page: Page, text: string) {
  return page.getByRole("tree").getByText(text, { exact: true });
}

test("project overview: remove manage artifacts and filter workspace tree", async ({ page }) => {
  test.setTimeout(90_000);

  await setupProjectOverviewFilterMocks(page);
  await page.goto("/projects/p1");

  await expect(page.getByRole("button", { name: /Manage Artifacts|管理产物/i })).toHaveCount(0);

  const skillsCard = metricCard(page, /Skills|技能/i);
  const scriptsCard = metricCard(page, /Scripts|脚本/i);

  await skillsCard.click();
  await expect(skillsCard).toHaveAttribute("aria-pressed", "true");
  await expect(treeText(page, "quick_start.md")).toBeVisible();
  await expect(treeText(page, "brief.md")).toHaveCount(0);
  await expect(treeText(page, "cleanup.py")).toHaveCount(0);

  await scriptsCard.click();
  await expect(skillsCard).toHaveAttribute("aria-pressed", "false");
  await expect(scriptsCard).toHaveAttribute("aria-pressed", "true");
  await expect(treeText(page, "cleanup.py")).toBeVisible();
  await expect(treeText(page, "quick_start.md")).toHaveCount(0);
});

test("project overview: original and derived filters are mutually exclusive", async ({ page }) => {
  test.setTimeout(90_000);

  await setupProjectOverviewFilterMocks(page);
  await page.goto("/projects/p1");

  const originalCard = metricCard(page, /Original Files|原件文件/i);
  const derivedCard = metricCard(page, /Derived Files|衍生文件/i);

  await originalCard.click();
  await expect(originalCard).toHaveAttribute("aria-pressed", "true");
  await expect(treeText(page, "brief.md")).toBeVisible();
  await expect(treeText(page, "notes")).toHaveCount(0);

  await derivedCard.click();
  await expect(originalCard).toHaveAttribute("aria-pressed", "false");
  await expect(derivedCard).toHaveAttribute("aria-pressed", "true");
  await expect(treeText(page, "notes")).toBeVisible();
  await expect(treeText(page, "brief.md")).toHaveCount(0);
});
