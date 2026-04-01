import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

type ArtifactSkill = {
  id: string;
  name: string;
  kind: "skill";
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
  artifactSkills: ArtifactSkill[],
  artifactDistillMode: "file_scan" | "conversation_evidence" = "file_scan",
) {
  return {
    id: "p1",
    name: "Project One",
    description: "Artifact workflow e2e",
    status: "active",
    workspace_dir: "/tmp/default/projects/p1",
    data_dir: "/tmp/default/projects/p1/data",
    metadata_file: "PROJECT.md",
    tags: [],
    artifact_distill_mode: artifactDistillMode,
    artifact_profile: {
      skills: artifactSkills,
      scripts: [],
      flows: [],
      cases: [],
    },
    updated_time: "2026-03-23T00:00:00Z",
  };
}

async function setupProjectWorkflowApiMocks(page: Page) {
  const artifactSkills: ArtifactSkill[] = [];

  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname.replace(/^\/console(?=\/api\/)/, "");
    const method = route.request().method();

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
              projects: [buildProject(artifactSkills)],
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
        body: JSON.stringify([]),
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
        body: JSON.stringify([]),
      });
      return;
    }

    if (
      pathname === "/api/agents/default/projects/p1/artifacts/skills/distill-draft" &&
      method === "POST"
    ) {
      if (artifactSkills.length === 0) {
        artifactSkills.push({
          id: "quick_start",
          name: "Quick Start",
          kind: "skill",
          origin: "project-distilled",
          status: "draft",
          version: "v0-draft",
          artifact_file_path: "skills/quick_start.md",
          version_history: [{ version: "v0-draft", file_path: "skills/quick_start.md" }],
          tags: ["auto-draft"],
          derived_from_ids: [],
          distillation_note: "Auto drafted from file.",
          market_source_id: null,
          market_item_id: null,
        });
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          drafted_count: 1,
          skipped_count: 0,
          drafted_ids: ["quick_start"],
          project: buildProject(artifactSkills),
        }),
      });
      return;
    }

    const confirmStableMatch = pathname.match(
      /^\/api\/agents\/default\/projects\/p1\/artifacts\/skills\/([^/]+)\/confirm-stable$/,
    );
    if (confirmStableMatch && method === "POST") {
      const artifactId = decodeURIComponent(confirmStableMatch[1]);
      const skill = artifactSkills.find((item) => item.id === artifactId);
      if (!skill) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ detail: "not found" }),
        });
        return;
      }
      skill.status = "stable";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          confirmed: true,
          artifact_id: artifactId,
          status: "stable",
          project: buildProject(artifactSkills),
        }),
      });
      return;
    }

    const promoteMatch = pathname.match(
      /^\/api\/agents\/default\/projects\/p1\/artifacts\/skills\/([^/]+)\/promote$/,
    );
    if (promoteMatch && method === "POST") {
      const artifactId = decodeURIComponent(promoteMatch[1]);
      const body = JSON.parse(route.request().postData() || "{}");
      const targetName = String(body.target_name || "quick_start_promoted");
      const skill = artifactSkills.find((item) => item.id === artifactId);
      if (!skill) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ detail: "not found" }),
        });
        return;
      }
      if (skill.status !== "stable") {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Only stable skill artifacts can be promoted." }),
        });
        return;
      }
      skill.origin = "project-promoted";
      skill.market_item_id = targetName;

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          promoted: true,
          artifact_kind: "skill",
          artifact_id: artifactId,
          target_name: targetName,
          target_path: `/tmp/default/skills/${targetName}/SKILL.md`,
          project: buildProject(artifactSkills),
        }),
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

async function setupConversationDistillSuggestionMocks(page: Page) {
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
              projects: [buildProject([], "conversation_evidence")],
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
        body: JSON.stringify([]),
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

test("artifact workflow: auto draft -> confirm stable -> promote", async ({ page }) => {
  test.setTimeout(90_000);

  await setupProjectWorkflowApiMocks(page);
  await page.goto("/projects/p1");

  const manageBtn = page.getByRole("button", { name: /Manage Artifacts|管理产物/i });
  await expect(manageBtn).toBeVisible({ timeout: 30_000 });
  await manageBtn.click();

  const autoDraftRequest = page.waitForRequest((request) => {
    return (
      request.method() === "POST" &&
      request.url().includes("/api/agents/default/projects/p1/artifacts/skills/distill-draft")
    );
  });
  const autoDraftBtn = page.getByRole("button", { name: /Auto Draft from Files|从文件自动草拟/i });
  await autoDraftBtn.click();
  await autoDraftRequest;

  await expect(page.locator('input[value="Quick Start"]')).toBeVisible({ timeout: 20_000 });

  const confirmRequest = page.waitForRequest((request) => {
    return (
      request.method() === "POST" &&
      request.url().includes("/api/agents/default/projects/p1/artifacts/skills/quick_start/confirm-stable")
    );
  });
  const confirmBtn = page.getByRole("button", { name: /Confirm Stable|确认为 stable/i });
  await confirmBtn.click();
  await confirmRequest;

  const promoteRequest = page.waitForRequest((request) => {
    return (
      request.method() === "POST" &&
      request.url().includes("/api/agents/default/projects/p1/artifacts/skills/quick_start/promote")
    );
  });
  const promoteBtn = page.getByRole("button", { name: /Promote to Agent|晋升为智能体技能/i });
  await promoteBtn.click();

  const promoteConfirmBtn = page.getByRole("button", { name: /Promote|确认晋升/i });
  await expect(promoteConfirmBtn).toBeVisible({ timeout: 10_000 });
  await promoteConfirmBtn.click();
  await promoteRequest;

  await expect(page.getByText(/Promoted|已晋升/i)).toBeVisible({ timeout: 20_000 });
});

test("artifact workflow: conversation mode shows suggested run_id", async ({ page }) => {
  test.setTimeout(90_000);

  await setupConversationDistillSuggestionMocks(page);
  await page.goto("/projects/p1");

  const manageBtn = page.getByRole("button", { name: /Manage Artifacts|管理产物/i });
  await expect(manageBtn).toBeVisible({ timeout: 30_000 });
  await manageBtn.click();

  await expect(
    page.getByRole("button", {
      name: /Auto Draft from Conversation|从对话自动草拟/i,
    }),
  ).toBeVisible({ timeout: 20_000 });

  await expect(
    page.getByText(/Suggested run_id: run-42|建议 run_id：run-42/i),
  ).toBeVisible({ timeout: 20_000 });
});
