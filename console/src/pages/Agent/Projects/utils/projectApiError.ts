import type { ProjectWorkspaceAdapterError } from "../adapters";
import { parseErrorDetail } from "../../../../utils/error";

interface ErrorLike {
  message?: unknown;
  status?: unknown;
  response?: {
    status?: unknown;
    data?: {
      code?: unknown;
      message?: unknown;
      detail?: unknown;
    };
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseStatusFromMessage(message: string): number | undefined {
  const matched = message.match(/\b(\d{3})\b/);
  if (!matched) {
    return undefined;
  }
  const status = Number(matched[1]);
  return Number.isFinite(status) && status >= 100 && status <= 599 ? status : undefined;
}

function inferCode(status?: number, message = "", detail = ""): string {
  const normalizedMessage = message.toLowerCase();
  const normalizedDetail = detail.toLowerCase();

  if (status === 409 || normalizedDetail.includes("conflict") || normalizedDetail.includes("exist")) {
    return "CONFLICT";
  }
  if (
    status === 400
    && (normalizedDetail.includes("path") || normalizedDetail.includes("invalid") || normalizedDetail.includes("unsafe"))
  ) {
    return "INVALID_PATH";
  }
  if (status === 403 || normalizedDetail.includes("permission") || normalizedDetail.includes("forbidden")) {
    return "PERMISSION_DENIED";
  }
  if (status === 404 || normalizedDetail.includes("not found")) {
    return "NOT_FOUND";
  }
  if (status === 413 || normalizedMessage.includes("too large") || normalizedDetail.includes("too large")) {
    return "PAYLOAD_TOO_LARGE";
  }
  if (status === 415 || normalizedDetail.includes("unsupported") || normalizedDetail.includes("mime")) {
    return "UNSUPPORTED_MEDIA_TYPE";
  }
  if (status === 408 || status === 504 || normalizedMessage.includes("timeout") || normalizedDetail.includes("timeout")) {
    return "TIMEOUT";
  }
  if (typeof status === "number" && status >= 500) {
    return "INTERNAL_ERROR";
  }
  return "UNKNOWN_ERROR";
}

export function normalizeProjectApiError(error: unknown): ProjectWorkspaceAdapterError {
  const errorLike = (error || {}) as ErrorLike;
  const parsedDetailRaw = parseErrorDetail(error);
  const parsedDetail = (typeof parsedDetailRaw === "object" && parsedDetailRaw)
    ? parsedDetailRaw
    : {};
  const parsedDetailText = asString(parsedDetailRaw);
  const parsedStatus = Number((parsedDetail as { status?: unknown }).status || 0) || undefined;
  const messageHint = asString(errorLike.message);
  const statusValue = Number(
    errorLike.response?.status
      ?? errorLike.status
      ?? parsedStatus
      ?? parseStatusFromMessage(messageHint)
      ?? 0,
  );
  const status = Number.isFinite(statusValue) && statusValue > 0 ? statusValue : undefined;

  const rawCode = asString(
    errorLike.response?.data?.code
      ?? (parsedDetail as { code?: unknown; error_code?: unknown }).code
      ?? (parsedDetail as { code?: unknown; error_code?: unknown }).error_code,
  ).toUpperCase();
  const detail = asString(
    errorLike.response?.data?.detail
      ?? (parsedDetail as { detail?: unknown }).detail
      ?? parsedDetailText,
  );
  const responseMessage = asString(
    errorLike.response?.data?.message
      ?? (parsedDetail as { message?: unknown }).message,
  );
  const directMessage = messageHint;
  const message = responseMessage || detail || directMessage || "Unknown adapter error";

  return {
    status,
    code: rawCode || inferCode(status, message, detail),
    message,
  };
}
