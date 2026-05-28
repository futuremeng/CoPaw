import { describe, expect, it } from "vitest";
import { normalizeProjectApiError } from "../utils/projectApiError";

describe("normalizeProjectApiError", () => {
  it("infers invalid path code from 400 response detail", () => {
    const normalized = normalizeProjectApiError({
      response: {
        status: 400,
        data: {
          detail: "invalid path: ../unsafe",
        },
      },
    });

    expect(normalized.status).toBe(400);
    expect(normalized.code).toBe("INVALID_PATH");
    expect(normalized.message).toBe("invalid path: ../unsafe");
  });

  it("returns explicit backend code when available", () => {
    const normalized = normalizeProjectApiError({
      response: {
        status: 403,
        data: {
          code: "permission_denied",
          detail: "forbidden",
        },
      },
    });

    expect(normalized.status).toBe(403);
    expect(normalized.code).toBe("PERMISSION_DENIED");
    expect(normalized.message).toBe("forbidden");
  });

  it("parses structured detail from request.ts formatted error message", () => {
    const normalized = normalizeProjectApiError(
      new Error(
        "Request failed: 409 Conflict - {\"detail\":{\"code\":\"project_path_conflict\",\"message\":\"target path already exists\"}}",
      ),
    );

    expect(normalized.status).toBe(409);
    expect(normalized.code).toBe("PROJECT_PATH_CONFLICT");
    expect(normalized.message).toBe("target path already exists");
  });

  it("falls back to inferred code when parsed detail has no code", () => {
    const normalized = normalizeProjectApiError(
      new Error("Request failed: 404 Not Found - {\"detail\":\"project not found\"}"),
    );

    expect(normalized.status).toBe(404);
    expect(normalized.code).toBe("NOT_FOUND");
    expect(normalized.message).toBe("project not found");
  });
});
