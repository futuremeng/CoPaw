import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNlp } from "./useNlp";

const { mockMessage, mockApi } = vi.hoisted(() => ({
  mockMessage: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
  mockApi: {
    getNlpStatus: vi.fn(),
    getNlpLocalModelsStatus: vi.fn(),
    getNlpMethodsCatalog: vi.fn(),
    installHanlp: vi.fn(),
    installSiameseSidecar: vi.fn(),
    downloadHanlpModel: vi.fn(),
    downloadMissingNlpLocalModels: vi.fn(),
    updateNlpStrategy: vi.fn(),
    updateNlpPreload: vi.fn(),
    triggerNlpPreload: vi.fn(),
    dryRunNlpStrategy: vi.fn(),
    runNlpProviderTaskDemo: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../../hooks/useAppMessage", () => ({
  useAppMessage: () => ({
    message: mockMessage,
  }),
}));

vi.mock("../../../api", () => ({
  default: mockApi,
}));

describe("useNlp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  const flushAsync = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  it("保留缓存状态并在首次静默刷新失败时不清空页面", async () => {
    window.localStorage.setItem(
      "copaw:nlp-status-snapshot:v1",
      JSON.stringify({
        ts: Date.now(),
        status: {
          provider: "hanlp",
          sidecar: {
            status: "ready",
            reason_code: "OK",
            reason: "ready",
            enabled: true,
            python_executable: "/usr/bin/python3",
            managed: false,
            uv_available: true,
            uv_executable: "uv",
          },
          model: {
            status: "ready",
            reason_code: "OK",
            reason: "ready",
            model_id: "demo-model",
          },
        },
        localModelsStatus: null,
      }),
    );
    mockApi.getNlpStatus.mockRejectedValueOnce(new Error("502"));
    mockApi.getNlpLocalModelsStatus.mockRejectedValueOnce(new Error("502"));
    mockApi.getNlpMethodsCatalog.mockRejectedValueOnce(new Error("502"));

    const { result } = renderHook(() => useNlp());

    await flushAsync();

    expect(mockApi.getNlpStatus).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.status?.sidecar.status).toBe("ready");
    expect(mockMessage.error).not.toHaveBeenCalled();
  });

  it("会在后台定时刷新 NLP 状态", async () => {
    mockApi.getNlpStatus
      .mockResolvedValueOnce({
        provider: "hanlp",
        sidecar: {
          status: "installing",
          reason_code: "BOOTING",
          reason: "booting",
          enabled: true,
          python_executable: "/usr/bin/python3",
          managed: false,
          uv_available: true,
          uv_executable: "uv",
        },
        model: {
          status: "loading",
          reason_code: "BOOTING",
          reason: "booting",
          model_id: "demo-model",
        },
      })
      .mockResolvedValueOnce({
        provider: "hanlp",
        sidecar: {
          status: "ready",
          reason_code: "OK",
          reason: "ready",
          enabled: true,
          python_executable: "/usr/bin/python3",
          managed: false,
          uv_available: true,
          uv_executable: "uv",
        },
        model: {
          status: "ready",
          reason_code: "OK",
          reason: "ready",
          model_id: "demo-model",
        },
      });
    mockApi.getNlpLocalModelsStatus.mockResolvedValue(null);
    mockApi.getNlpMethodsCatalog.mockResolvedValue(null);

    const { result } = renderHook(() => useNlp());

    await flushAsync();

    expect(result.current.status?.sidecar.status).toBe("installing");

    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await flushAsync();

    expect(mockApi.getNlpStatus).toHaveBeenCalledTimes(2);
    expect(result.current.status?.sidecar.status).toBe("ready");
  });

  it("会为 Siamese demo 使用更长的请求超时", async () => {
    mockApi.getNlpStatus.mockResolvedValue({
      provider: "siamese_uninlu",
      sidecar: {
        status: "ready",
        reason_code: "OK",
        reason: "ready",
        enabled: true,
        python_executable: "/usr/bin/python3",
        managed: false,
        uv_available: false,
        uv_executable: "",
      },
      model: {
        status: "ready",
        reason_code: "OK",
        reason: "ready",
        model_id: "demo-model",
      },
    });
    mockApi.getNlpLocalModelsStatus.mockResolvedValue(null);
    mockApi.getNlpMethodsCatalog.mockResolvedValue(null);
    mockApi.runNlpProviderTaskDemo.mockResolvedValue({
      status: "ready",
      reason_code: "SIAMESE_TASK_OK",
      reason: "ok",
      result: { output: [] },
      resolved_model: "demo-model",
      duration_ms: 1,
    });

    const { result } = renderHook(() => useNlp());

    await flushAsync();

    await act(async () => {
      await result.current.runMethodDemo(
        "sentiment_classification",
        "产品体验很好，我非常满意。",
        "siamese_uninlu",
      );
    });

    expect(mockApi.runNlpProviderTaskDemo).toHaveBeenCalledWith(
      "siamese_uninlu",
      "sentiment_classification",
      { text: "产品体验很好，我非常满意。" },
      { timeoutMs: 60_000 },
    );
    expect(mockMessage.success).toHaveBeenCalledWith("sentiment_classification demo finished");
  });

  it("会把 Siamese demo 的 schema 一并传给后端", async () => {
    mockApi.getNlpStatus.mockResolvedValue({
      provider: "siamese_uninlu",
      sidecar: {
        status: "ready",
        reason_code: "OK",
        reason: "ready",
        enabled: true,
        python_executable: "/usr/bin/python3",
        managed: false,
        uv_available: false,
        uv_executable: "",
      },
      model: {
        status: "ready",
        reason_code: "OK",
        reason: "ready",
        model_id: "demo-model",
      },
    });
    mockApi.getNlpLocalModelsStatus.mockResolvedValue(null);
    mockApi.getNlpMethodsCatalog.mockResolvedValue(null);
    mockApi.runNlpProviderTaskDemo.mockResolvedValue({
      status: "ready",
      reason_code: "SIAMESE_TASK_OK",
      reason: "ok",
      result: { output: [] },
      resolved_model: "demo-model",
      duration_ms: 1,
    });

    const { result } = renderHook(() => useNlp());

    await flushAsync();

    await act(async () => {
      await result.current.runMethodDemo(
        "named_entity_recognition",
        "北京九录科技有限公司推出产品 Copaw。",
        "siamese_uninlu",
        { 人物: null, 地点: null, 组织: null, 公司: null, 产品: null },
      );
    });

    expect(mockApi.runNlpProviderTaskDemo).toHaveBeenCalledWith(
      "siamese_uninlu",
      "named_entity_recognition",
      {
        text: "北京九录科技有限公司推出产品 Copaw。",
        schema: { 人物: null, 地点: null, 组织: null, 公司: null, 产品: null },
      },
      { timeoutMs: 60_000 },
    );
  });

  it("会为关系抽取等 schema 方法传递默认 schema", async () => {
    mockApi.getNlpStatus.mockResolvedValue({
      provider: "siamese_uninlu",
      sidecar: {
        status: "ready",
        reason_code: "OK",
        reason: "ready",
        enabled: true,
        python_executable: "/usr/bin/python3",
        managed: false,
        uv_available: false,
        uv_executable: "",
      },
      model: {
        status: "ready",
        reason_code: "OK",
        reason: "ready",
        model_id: "demo-model",
      },
    });
    mockApi.getNlpLocalModelsStatus.mockResolvedValue(null);
    mockApi.getNlpMethodsCatalog.mockResolvedValue(null);
    mockApi.runNlpProviderTaskDemo.mockResolvedValue({
      status: "ready",
      reason_code: "SIAMESE_TASK_OK",
      reason: "ok",
      result: { output: [] },
      resolved_model: "demo-model",
      duration_ms: 1,
    });

    const { result } = renderHook(() => useNlp());

    await flushAsync();

    await act(async () => {
      await result.current.runMethodDemo(
        "relation_extraction",
        "北京九录科技有限公司由孟繁永创立。",
        "siamese_uninlu",
        { 人物: { 所属组织: null, 职位: null } },
      );
    });

    expect(mockApi.runNlpProviderTaskDemo).toHaveBeenCalledWith(
      "siamese_uninlu",
      "relation_extraction",
      {
        text: "北京九录科技有限公司由孟繁永创立。",
        schema: { 人物: { 所属组织: null, 职位: null } },
      },
      { timeoutMs: 60_000 },
    );
  });

  it("会把 Siamese 的 JSON 示例解析为结构化入参", async () => {
    mockApi.getNlpStatus.mockResolvedValue({
      provider: "siamese_uninlu",
      sidecar: {
        status: "ready",
        reason_code: "OK",
        reason: "ready",
        enabled: true,
        python_executable: "/usr/bin/python3",
        managed: false,
        uv_available: false,
        uv_executable: "",
      },
      model: {
        status: "ready",
        reason_code: "OK",
        reason: "ready",
        model_id: "demo-model",
      },
    });
    mockApi.getNlpLocalModelsStatus.mockResolvedValue(null);
    mockApi.getNlpMethodsCatalog.mockResolvedValue(null);
    mockApi.runNlpProviderTaskDemo.mockResolvedValue({
      status: "ready",
      reason_code: "SIAMESE_TASK_OK",
      reason: "ok",
      result: { output: [] },
      resolved_model: "demo-model",
      duration_ms: 1,
    });

    const { result } = renderHook(() => useNlp());
    await flushAsync();

    const structuredInput = JSON.stringify(
      {
        text_a: "Copaw 是知识生产智能体。",
        text_b: "Copaw 用于知识加工与发布。",
        labels: ["匹配", "不匹配"],
      },
      null,
      2,
    );

    await act(async () => {
      await result.current.runMethodDemo(
        "text_matching",
        structuredInput,
        "siamese_uninlu",
        { 文本匹配: null },
      );
    });

    expect(mockApi.runNlpProviderTaskDemo).toHaveBeenCalledWith(
      "siamese_uninlu",
      "text_matching",
      {
        text_a: "Copaw 是知识生产智能体。",
        text_b: "Copaw 用于知识加工与发布。",
        labels: ["匹配", "不匹配"],
        schema: { 文本匹配: null },
      },
      { timeoutMs: 60_000 },
    );
  });

  it("会让阅读理解 schema 与 question 自动对齐", async () => {
    mockApi.getNlpStatus.mockResolvedValue({
      provider: "siamese_uninlu",
      sidecar: {
        status: "ready",
        reason_code: "OK",
        reason: "ready",
        enabled: true,
        python_executable: "/usr/bin/python3",
        managed: false,
        uv_available: false,
        uv_executable: "",
      },
      model: {
        status: "ready",
        reason_code: "OK",
        reason: "ready",
        model_id: "demo-model",
      },
    });
    mockApi.getNlpLocalModelsStatus.mockResolvedValue(null);
    mockApi.getNlpMethodsCatalog.mockResolvedValue(null);
    mockApi.runNlpProviderTaskDemo.mockResolvedValue({
      status: "ready",
      reason_code: "SIAMESE_TASK_OK",
      reason: "ok",
      result: { output: [] },
      resolved_model: "demo-model",
      duration_ms: 1,
    });

    const { result } = renderHook(() => useNlp());
    await flushAsync();

    const rcInput = JSON.stringify(
      {
        question: "谁推出了 Copaw？",
        context: "北京九录科技有限公司推出产品 Copaw，用于知识生产和加工。",
        choices: ["北京九录科技有限公司", "张三", "李四", "王五"],
        labels: ["A", "B", "C", "D"],
      },
      null,
      2,
    );

    await act(async () => {
      await result.current.runMethodDemo(
        "reading_comprehension_choice",
        rcInput,
        "siamese_uninlu",
        { "问题：在给定上下文中，正确答案是什么？": null },
      );
    });

    expect(mockApi.runNlpProviderTaskDemo).toHaveBeenCalledWith(
      "siamese_uninlu",
      "reading_comprehension_choice",
      {
        question: "谁推出了 Copaw？",
        context: "北京九录科技有限公司推出产品 Copaw，用于知识生产和加工。",
        choices: ["北京九录科技有限公司", "张三", "李四", "王五"],
        labels: ["A", "B", "C", "D"],
        schema: { "谁推出了 Copaw？": null },
      },
      { timeoutMs: 60_000 },
    );
  });

  it("不会把抽取式阅读理解的 schema 强制改写为 question", async () => {
    mockApi.getNlpStatus.mockResolvedValue({
      provider: "siamese_uninlu",
      sidecar: {
        status: "ready",
        reason_code: "OK",
        reason: "ready",
        enabled: true,
        python_executable: "/usr/bin/python3",
        managed: false,
        uv_available: false,
        uv_executable: "",
      },
      model: {
        status: "ready",
        reason_code: "OK",
        reason: "ready",
        model_id: "demo-model",
      },
    });
    mockApi.getNlpLocalModelsStatus.mockResolvedValue(null);
    mockApi.getNlpMethodsCatalog.mockResolvedValue(null);
    mockApi.runNlpProviderTaskDemo.mockResolvedValue({
      status: "ready",
      reason_code: "SIAMESE_TASK_OK",
      reason: "ok",
      result: { output: [] },
      resolved_model: "demo-model",
      duration_ms: 1,
    });

    const { result } = renderHook(() => useNlp());
    await flushAsync();

    const rcInput = JSON.stringify(
      {
        question: "文中提到的产品名是什么？",
        context: "该公司的产品名是 Copaw。",
        text: "该公司的产品名是 Copaw。",
      },
      null,
      2,
    );

    await act(async () => {
      await result.current.runMethodDemo(
        "reading_comprehension_extractive",
        rcInput,
        "siamese_uninlu",
        { 产品名: null },
      );
    });

    expect(mockApi.runNlpProviderTaskDemo).toHaveBeenCalledWith(
      "siamese_uninlu",
      "reading_comprehension_extractive",
      {
        question: "文中提到的产品名是什么？",
        context: "该公司的产品名是 Copaw。",
        text: "该公司的产品名是 Copaw。",
        schema: { 产品名: null },
      },
      { timeoutMs: 60_000 },
    );
  });
});