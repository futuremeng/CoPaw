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
    installHanlp: vi.fn(),
    downloadHanlpModel: vi.fn(),
    downloadMissingNlpLocalModels: vi.fn(),
    updateNlpStrategy: vi.fn(),
    updateNlpPreload: vi.fn(),
    triggerNlpPreload: vi.fn(),
    dryRunNlpStrategy: vi.fn(),
    runNlpTaskDemo: vi.fn(),
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
});