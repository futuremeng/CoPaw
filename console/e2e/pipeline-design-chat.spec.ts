import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

type ApiMockOptions = {
  conflictScenario?: boolean;
  projectTemplateSteps?: Array<{
    id: string;
    name: string;
    kind: string;
    description: string;
  }>;
};

function buildRuntimeStatusSnapshot(chatId: string) {
  return {
    scope_level: "chat",
    snapshot_source: "runtime_push",
    snapshot_stage: "pre_model_call",
    agent_id: "default",
    session_id: chatId,
    user_id: "default",
    chat_id: chatId,
    context_window_tokens: 32000,
    used_tokens: 4000,
    used_ratio: 0.125,
    reserved_response_tokens: 2048,
    remaining_tokens: 25952,
    model_id: "qwen3.5:27b",
    provider_id: "ollama",
    profile_label: "Local runtime",
    breakdown: [
      { key: "system-instructions", label: "System Instructions", tokens: 1200, ratio: 0.0375, section: "system" },
      { key: "tool-definitions", label: "Tool Definitions", tokens: 1800, ratio: 0.05625, section: "system" },
      { key: "messages", label: "Messages", tokens: 1000, ratio: 0.03125, section: "user" },
      { key: "tool-results", label: "Tool Results", tokens: 0, ratio: 0, section: "user" },
      { key: "files", label: "Files", tokens: 0, ratio: 0, section: "user" },
    ],
  };
}

async function setupApiMocks(page: Page, options: ApiMockOptions = {}) {
  const { conflictScenario = false, projectTemplateSteps } = options;
  let createdChatCount = 0;
  let boundPipelineId = "books-alignment-v1";
  let draftMtime = 1_800_000_000;
  let editableTemplateSteps = projectTemplateSteps || [];

  const remoteDraftSteps = [
    {
      id: "step-1-purpose",
      name: "远端用途步骤",
      kind: "analysis",
      description: "远端版本：用途定义",
    },
    {
      id: "step-remote-extra",
      name: "远端新增步骤",
      kind: "validation",
      description: "远端版本新增校验",
    },
  ];

  const remoteTemplateSteps = [
    {
      id: "step-1-purpose",
      name: "旧用途步骤",
      kind: "analysis",
      description: "旧版本用途定义",
    },
  ];

  const chats: Array<Record<string, unknown>> = [
    {
      id: "old-session-1",
      name: "Old Session",
      session_id: "old-session-1",
      user_id: "default",
      channel: "console",
      meta: {},
      status: "idle",
      created_at: "2026-03-20T00:00:00Z",
      updated_at: "2026-03-20T00:00:00Z",
    },
  ];

  page.on("pageerror", (error: Error) => {
    console.error("[e2e] pageerror:", error.message);
  });

  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname.replace(/^\/console(?=\/api\/)/, "");

    // Only mock backend API calls; let frontend module paths under /src/api/* pass through.
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
              projects: [
                {
                  id: "p1",
                  name: "Project One",
                  description: "",
                  status: "active",
                  workspace_dir: "/tmp/default",
                  data_dir: "/tmp/default/data",
                  metadata_file: "PROJECT.md",
                  tags: [],
                  updated_time: "2026-03-23T00:00:00Z",
                },
              ],
            },
          ],
        }),
      });
      return;
    }

    if (pathname === "/api/models") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "ollama",
            name: "Ollama",
            api_key_prefix: "",
            chat_model: "qwen3.5:27b",
            models: [{ id: "qwen3.5:27b", name: "qwen3.5:27b", supports_multimodal: false, supports_image: false, supports_video: false }],
            extra_models: [],
            is_custom: false,
            is_local: true,
            support_model_discovery: true,
            support_connection_check: true,
            freeze_url: false,
            require_api_key: false,
            api_key: "",
            base_url: "http://127.0.0.1:11434",
            generate_kwargs: { max_tokens: 4096 },
          },
        ]),
      });
      return;
    }

    if (pathname === "/api/models/active") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          active_llm: {
            provider_id: "ollama",
            model: "qwen3.5:27b",
          },
        }),
      });
      return;
    }

    if (pathname === "/api/agent/running-config") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          max_iters: 50,
          llm_retry_enabled: true,
          llm_max_retries: 2,
          llm_backoff_base: 1,
          llm_backoff_cap: 8,
          max_input_length: 30000,
          memory_compact_ratio: 0.8,
          memory_reserve_ratio: 0.9,
          tool_result_compact_recent_n: 4,
          tool_result_compact_old_threshold: 1200,
          tool_result_compact_recent_threshold: 2400,
          tool_result_compact_retention_days: 7,
          knowledge_enabled: true,
          knowledge_auto_collect_chat_files: true,
          knowledge_auto_collect_chat_urls: true,
          knowledge_auto_collect_long_text: true,
          knowledge_long_text_min_chars: 500,
          knowledge_chunk_size: 1000,
        }),
      });
      return;
    }

    if (pathname === "/api/agents/default/projects/p1/pipelines/templates") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "books-alignment-v1",
            name: "Books Alignment",
            version: "0.1.0",
            description: "",
            steps: editableTemplateSteps,
          },
        ]),
      });
      return;
    }

    if (pathname === "/api/agents/default/pipelines/templates") {
      const templates = conflictScenario
        ? [
            {
              id: boundPipelineId,
              name: "新流程",
              version: "0.1.0",
              description: "待补充流程说明",
              steps: remoteTemplateSteps,
              revision: 2,
              content_hash: "sha256:remote-hash",
            },
          ]
        : [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(templates),
      });
      return;
    }

    const draftMatch = pathname.match(
      /^\/api\/agents\/default\/pipelines\/templates\/([^/]+)\/draft$/,
    );
    if (draftMatch) {
      const templateId = decodeURIComponent(draftMatch[1]);
      draftMtime += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: templateId,
          revision: 2,
          content_hash: "sha256:remote-hash",
          status: "ready",
          md_mtime: draftMtime,
          md_relative_path: `pipelines/${templateId}/pipeline.md`,
          flow_memory_relative_path: `pipelines/${templateId}/flow-memory.md`,
          validation_errors: [],
          steps: conflictScenario ? remoteDraftSteps : editableTemplateSteps,
        }),
      });
      return;
    }

    const deleteStepMatch = pathname.match(
      /^\/api\/agents\/default\/pipelines\/templates\/([^/]+)\/steps\/([^/]+)$/,
    );
    if (deleteStepMatch && route.request().method() === "DELETE") {
      const templateId = decodeURIComponent(deleteStepMatch[1]);
      const stepId = decodeURIComponent(deleteStepMatch[2]);
      editableTemplateSteps = editableTemplateSteps.filter((step) => step.id !== stepId);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: templateId,
          name: "Books Alignment",
          version: "0.1.0",
          description: "",
          steps: editableTemplateSteps,
          revision: 3,
          content_hash: "sha256:after-delete",
        }),
      });
      return;
    }

    const saveStreamMatch = pathname.match(
      /^\/api\/agents\/default\/pipelines\/templates\/([^/]+)\/save\/stream$/,
    );
    if (saveStreamMatch && route.request().method() === "POST") {
      if (conflictScenario) {
        await route.fulfill({
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            Connection: "keep-alive",
            "Cache-Control": "no-cache",
          },
          body:
            'data: {"event":"validation_started","payload":{}}\n\n' +
            'data: {"event":"save_failed","payload":{"status_code":409,"detail":{"code":"pipeline_revision_conflict","expected_revision":1,"current_revision":2,"current_content_hash":"sha256:remote-hash"}}}\n\n' +
            'data: {"event":"done","payload":{"status":"failed"}}\n\n',
        });
      } else {
        await route.fulfill({
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            Connection: "keep-alive",
            "Cache-Control": "no-cache",
          },
          body:
            'data: {"event":"saved","payload":{}}\n\n' +
            'data: {"event":"done","payload":{"status":"ok"}}\n\n',
        });
      }
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

    if (pathname === "/api/chats" && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(chats),
      });
      return;
    }

    if (pathname === "/api/chats" && route.request().method() === "POST") {
      createdChatCount += 1;
      const bodyText = route.request().postData() || "{}";
      const body = JSON.parse(bodyText);
      const bodyMeta =
        body.meta && typeof body.meta === "object"
          ? (body.meta as Record<string, unknown>)
          : null;
      const pipelineId =
        bodyMeta && typeof bodyMeta.pipeline_id === "string"
          ? bodyMeta.pipeline_id
          : "";
      if (pipelineId) {
        boundPipelineId = pipelineId;
      }
      const createdId = `created-chat-${createdChatCount}`;
      const createdChat = {
        id: createdId,
        name: body.name || "Pipeline Design",
        session_id: body.session_id || createdId,
        user_id: body.user_id || "default",
        channel: body.channel || "console",
        meta: body.meta || {},
        status: "idle",
        created_at: "2026-03-25T00:00:00Z",
        updated_at: "2026-03-25T00:00:00Z",
      };
      chats.push(createdChat);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(createdChat),
      });
      return;
    }

    const runtimeStatusMatch = pathname.match(/^\/api\/console\/chats\/([^/]+)\/runtime-status$/);
    if (runtimeStatusMatch && route.request().method() === "GET") {
      const chatId = decodeURIComponent(runtimeStatusMatch[1]);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildRuntimeStatusSnapshot(chatId)),
      });
      return;
    }

    if (pathname.startsWith("/api/chats/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          messages: [],
          status: "idle",
          has_more: false,
          total: 0,
        }),
      });
      return;
    }

    if (pathname === "/api/providers/active-models") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          active_llm: {
            provider_id: "mock",
            model: "mock-model",
          },
        }),
      });
      return;
    }

    if (pathname === "/api/console/chat") {
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          Connection: "keep-alive",
          "Cache-Control": "no-cache",
        },
        body: "data: {\"status\":\"ok\"}\n\n",
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

test("health: pipelines page renders design entry", async ({ page }) => {
  test.setTimeout(60_000);

  await setupApiMocks(page);
  await page.goto("/pipelines");

  const openDesignBtn = page.getByTestId("pipeline-open-design-chat");
  await expect(openDesignBtn).toBeVisible({ timeout: 30_000 });
});

test("behavior: pipeline design entry opens inline edit and keeps dedicated chat id", async ({ page }) => {
  test.setTimeout(90_000);

  await setupApiMocks(page);

  await page.goto("/pipelines");

  const openDesignBtn = page.getByTestId("pipeline-open-design-chat");
  try {
    await expect(openDesignBtn).toBeVisible({ timeout: 30_000 });
  } catch (error) {
    const currentUrl = page.url();
    const bodyText = (await page.locator("body").innerText()).slice(0, 500);
    console.error("[e2e] missing button url:", currentUrl);
    console.error("[e2e] missing button body(head):", bodyText);
    throw error;
  }

  const createChatRequest = page.waitForRequest((request) => {
    return request.method() === "POST" && request.url().includes("/api/chats");
  });
  await openDesignBtn.click();

  const request = await createChatRequest;
  expect(request.postDataJSON()).toMatchObject({
    name: "Pipeline Design",
    user_id: "default",
    channel: "console",
  });

  await expect(page).toHaveURL(/\/pipelines(?:\?.*)?$/);
  const openFullChatBtn = page.getByRole("button", {
    name: /Open Full Chat|完整聊天/i,
  });
  await expect(openFullChatBtn).toBeVisible({ timeout: 20_000 });

  await openFullChatBtn.click();
  await expect(page).toHaveURL(/\/chat\/[^/?]+/);

  const urlAfterCreate = page.url();
  const createdChatId = urlAfterCreate.match(/\/chat\/([^/?]+)/)?.[1] || "";
  expect(createdChatId).toBeTruthy();
  await page.waitForTimeout(1200);

  await expect(page).toHaveURL(new RegExp(`/chat/${createdChatId}(?:\\?.*)?$`));
  expect(urlAfterCreate).not.toContain("old-session-1");
});

test("behavior: each pipeline create opens a new chat id", async ({ page }) => {
  test.setTimeout(90_000);

  await setupApiMocks(page);

  await page.goto("/pipelines");

  const openDesignBtn = page.getByTestId("pipeline-open-design-chat");
  await expect(openDesignBtn).toBeVisible({ timeout: 30_000 });

  const createChatRequestFirst = page.waitForRequest((request) => {
    return request.method() === "POST" && request.url().includes("/api/chats");
  });
  await openDesignBtn.click();
  await createChatRequestFirst;
  const openFullChatBtnFirst = page.getByRole("button", {
    name: /Open Full Chat|完整聊天/i,
  });
  await expect(openFullChatBtnFirst).toBeVisible({ timeout: 20_000 });
  await openFullChatBtnFirst.click();
  await expect(page).toHaveURL(/\/chat\/[^/?]+/);
  const firstChatId = page.url().match(/\/chat\/([^/?]+)/)?.[1] || "";
  expect(firstChatId).toBeTruthy();

  await page.goto("/pipelines");
  await expect(openDesignBtn).toBeVisible({ timeout: 30_000 });
  const createChatRequestSecond = page.waitForRequest((request) => {
    return request.method() === "POST" && request.url().includes("/api/chats");
  });
  await openDesignBtn.click();
  await createChatRequestSecond;
  const openFullChatBtnSecond = page.getByRole("button", {
    name: /Open Full Chat|完整聊天/i,
  });
  await expect(openFullChatBtnSecond).toBeVisible({ timeout: 20_000 });
  await openFullChatBtnSecond.click();
  await expect(page).toHaveURL(/\/chat\/[^/?]+/);
  const secondChatId = page.url().match(/\/chat\/([^/?]+)/)?.[1] || "";
  expect(secondChatId).toBeTruthy();

  expect(secondChatId).not.toBe(firstChatId);
});

test("behavior: runtime status panel does not reuse previous chat ownership after new chat", async ({ page }) => {
  test.setTimeout(90_000);

  await setupApiMocks(page);

  await page.goto("/pipelines");

  const openDesignBtn = page.getByTestId("pipeline-open-design-chat");
  await expect(openDesignBtn).toBeVisible({ timeout: 30_000 });

  const createChatRequestFirst = page.waitForRequest((request) => {
    return request.method() === "POST" && request.url().includes("/api/chats");
  });
  await openDesignBtn.click();
  await createChatRequestFirst;

  const runtimeStatusTrigger = page.getByTestId("runtime-status-trigger");
  await expect(runtimeStatusTrigger).toBeVisible({ timeout: 20_000 });
  await runtimeStatusTrigger.click();

  await expect(page.getByTestId("runtime-status-meta-chat")).toHaveText("created-chat-1", { timeout: 20_000 });
  await expect(page.getByTestId("runtime-status-meta-agent")).toHaveText("default", { timeout: 20_000 });
  await expect(page.getByTestId("runtime-status-meta-source")).toHaveText("runtime_push", { timeout: 20_000 });

  const createChatRequestSecond = page.waitForRequest((request) => {
    return request.method() === "POST" && request.url().includes("/api/chats");
  });
  await page.getByRole("button", { name: /New Chat/i }).click();
  await createChatRequestSecond;

  await expect(page.getByTestId("runtime-status-meta-chat")).toHaveText("created-chat-2", { timeout: 20_000 });
  await expect(page.getByTestId("runtime-status-meta-agent")).toHaveText("default", { timeout: 20_000 });
  await expect(page.getByTestId("runtime-status-meta-chat")).not.toHaveText("created-chat-1", { timeout: 20_000 });
});

test("behavior: new pipeline edit starts clean and does not restore legacy prefilled steps", async ({ page }) => {
  test.setTimeout(90_000);

  await setupApiMocks(page);

  await page.goto("/pipelines");

  const openDesignBtn = page.getByTestId("pipeline-open-design-chat");
  await expect(openDesignBtn).toBeVisible({ timeout: 30_000 });
  await openDesignBtn.click();

  await expect(
    page.getByText(/Describe your goal first|先描述你的目标/),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByText(/Start by describing the goal and key steps|先描述流程目标和关键步骤/),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByText(/Only one node is generated at a time|每次只生成一个节点/),
  ).toBeVisible({ timeout: 20_000 });

  await expect(
    page.getByText(/This column updates automatically from the backend draft|这里会根据后端 draft 自动更新/),
  ).toBeVisible({ timeout: 20_000 });

  await expect(page.getByText(/已根据最新对话更新节点草稿|Updated from the latest chat/i)).toHaveCount(0);
  await expect(page.getByText("明确流程用途", { exact: true })).toHaveCount(0);
  await expect(page.getByText("step-1-purpose", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/逐步生成中：第|Generating step/i)).toHaveCount(0);
});

test("behavior: pipeline design entry lands on plain chat url without query params", async ({ page }) => {
  test.setTimeout(90_000);

  await setupApiMocks(page);

  await page.goto("/pipelines");

  const openDesignBtn = page.getByTestId("pipeline-open-design-chat");
  await expect(openDesignBtn).toBeVisible({ timeout: 30_000 });

  const createChatRequest = page.waitForRequest((request) => {
    return request.method() === "POST" && request.url().includes("/api/chats");
  });
  await openDesignBtn.click();
  await createChatRequest;
  const openFullChatBtn = page.getByRole("button", {
    name: /Open Full Chat|完整聊天/i,
  });
  await expect(openFullChatBtn).toBeVisible({ timeout: 20_000 });
  await openFullChatBtn.click();
  await expect(page).toHaveURL(/\/chat\/[^/?]+$/);

  const currentUrl = new URL(page.url());
  expect(currentUrl.pathname).toMatch(/^\/chat\/[^/]+$/);
  expect(currentUrl.search).toBe("");
});

test("behavior: edit pipeline restores bound chat after reload", async ({ page }) => {
  test.setTimeout(90_000);

  await setupApiMocks(page);

  await page.goto("/pipelines");

  const editBtn = page.getByRole("button", {
    name: /Edit Pipeline|编辑流程/i,
  });
  await expect(editBtn).toBeVisible({ timeout: 30_000 });

  const firstCreateRequest = page.waitForRequest((request) => {
    return request.method() === "POST" && request.url().includes("/api/chats");
  });

  await editBtn.click();
  const firstCreate = await firstCreateRequest;
  expect(firstCreate.postDataJSON()).toMatchObject({
    meta: {
      binding_type: "pipeline_edit",
      pipeline_binding_key: "books-alignment-v1@0.1.0",
      pipeline_id: "books-alignment-v1",
      pipeline_version: "0.1.0",
    },
  });

  const exitEditBtn = page.getByRole("button", { name: /Exit Edit|退出编辑/i });
  await expect(exitEditBtn).toBeVisible({ timeout: 20_000 });
  await exitEditBtn.click();

  await page.goto("/pipelines");
  await expect(editBtn).toBeVisible({ timeout: 30_000 });

  let createCount = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/chats")) {
      createCount += 1;
    }
  });

  await editBtn.click();
  await expect(exitEditBtn).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);

  expect(createCount).toBe(0);
});

test("behavior: conflict panel offers remote recovery when local draft is empty", async ({ page }) => {
  test.setTimeout(90_000);

  await setupApiMocks(page, { conflictScenario: true });

  await page.goto("/pipelines");

  const openDesignBtn = page.getByTestId("pipeline-open-design-chat");
  await expect(openDesignBtn).toBeVisible({ timeout: 30_000 });
  await openDesignBtn.click();

  const saveBtn = page.getByRole("button", { name: /^(保存|Save)$/i });
  await expect(saveBtn).toBeVisible({ timeout: 30_000 });
  await saveBtn.click();

  await expect(page.getByText(/检测到并发冲突|concurrent conflict/i)).toBeVisible({ timeout: 30_000 });

  const refreshBtn = page.getByRole("button", { name: /刷新后重试|refresh/i });
  await refreshBtn.click();

  const mergeBtn = page.getByRole("button", { name: /按 step_id 合并|merge/i });
  const useRemoteBtn = page.getByRole("button", { name: /采用远端草稿|remote draft/i });
  const restoreLocalBtn = page.getByRole("button", { name: /恢复本地草稿|restore local/i });

  await expect(useRemoteBtn).toBeVisible({ timeout: 20_000 });
  await expect(mergeBtn).toHaveCount(0);
  await expect(restoreLocalBtn).toHaveCount(0);

  await expect(page.getByText("远端新增步骤")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("旧用途步骤")).toBeVisible({ timeout: 20_000 });

  await useRemoteBtn.click();
  await expect(page.getByText("远端用途步骤")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("远端新增步骤")).toBeVisible({ timeout: 20_000 });
});

test("behavior: edit pipeline applies delete step operation through page workflow", async ({ page }) => {
  test.setTimeout(90_000);

  await page.addInitScript(() => {
    (window as typeof window & { __COPAW_ENABLE_TEST_HOOKS__?: boolean }).__COPAW_ENABLE_TEST_HOOKS__ = true;
  });

  await setupApiMocks(page, {
    projectTemplateSteps: [
      {
        id: "step-1-purpose",
        name: "旧用途步骤",
        kind: "analysis",
        description: "旧版本用途定义",
      },
    ],
  });

  await page.goto("/pipelines");

  const editBtn = page.getByRole("button", {
    name: /Edit Pipeline|编辑流程/i,
  });
  await expect(editBtn).toBeVisible({ timeout: 30_000 });
  await editBtn.click();

  await expect(page.getByRole("button", { name: /Exit Edit|退出编辑/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("旧用途步骤")).toBeVisible({ timeout: 20_000 });

  await page.waitForFunction(() => Boolean((window as typeof window & { __COPAW_PIPELINES_TEST__?: unknown }).__COPAW_PIPELINES_TEST__));

  await page.evaluate(() => {
    (window as typeof window & {
      __COPAW_PIPELINES_TEST__?: { activateIncrementalModify: (input: Record<string, unknown>) => void };
    }).__COPAW_PIPELINES_TEST__?.activateIncrementalModify({
      totalStepsExpected: 1,
      currentStep: 1,
      userRequirements: "删除旧用途步骤",
      lastUserRequest: "删除旧用途步骤",
    });
  });

  const deleteRequest = page.waitForRequest((request) => {
    return (
      request.method() === "DELETE" &&
      request.url().includes("/api/agents/default/pipelines/templates/books-alignment-v1/steps/step-1-purpose")
    );
  }, { timeout: 10_000 });

  await page.evaluate(async () => {
    await (window as typeof window & {
      __COPAW_PIPELINES_TEST__?: { completeAssistantTurn: (text: string) => Promise<void> };
    }).__COPAW_PIPELINES_TEST__?.completeAssistantTurn(
      JSON.stringify({
        operation: "delete",
        step_id: "step-1-purpose",
      }),
    );
  });

  await deleteRequest;
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        return (window as typeof window & {
          __COPAW_PIPELINES_TEST__?: { getDraftStepIds: () => string[] };
        }).__COPAW_PIPELINES_TEST__?.getDraftStepIds() || [];
      });
    })
    .toEqual([]);
});
