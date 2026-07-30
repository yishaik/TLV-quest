import { readFileSync } from "node:fs";
import * as Sentry from "@sentry/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppError,
  handleRouteError,
  readJson,
  requireBearer
} from "../lib/http";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  metrics: {
    count: vi.fn()
  }
}));

const httpSource = readFileSync("lib/http.ts", "utf8");

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(Sentry.captureException).mockClear();
  vi.mocked(Sentry.metrics.count).mockClear();
});

describe("HTTP error boundary", () => {
  it("redacts unknown database errors and attaches a correlation id", async () => {
    const databaseError = {
      message: "unsupported Unicode escape sequence",
      code: "22P05",
      details: "schema marketing_leads contains a rejected value"
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = handleRouteError(databaseError);
    const body = await response.json();
    const correlationId = response.headers.get("x-correlation-id");

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(body).toMatchObject({
      ok: false,
      error: {
        message:
          "אירעה תקלה זמנית. נסו שוב בעוד רגע. / A temporary error occurred. Please try again.",
        details: {
          code: "internal_error",
          correlationId
        }
      }
    });
    expect(JSON.stringify(body)).not.toContain(databaseError.message);
    expect(JSON.stringify(body)).not.toContain(databaseError.details);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      databaseError,
      expect.objectContaining({
        tags: expect.objectContaining({
          correlation_id: correlationId,
          error_code: "internal_error"
        })
      })
    );
    expect(Sentry.metrics.count).toHaveBeenCalledWith(
      "tlv_quest.api.errors",
      1,
      expect.objectContaining({
        attributes: expect.objectContaining({
          error_code: "internal_error",
          status_code: 500
        })
      })
    );
  });

  it("tags unexpected live-run failures for the rate alert", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("provider unavailable");

    const response = handleRouteError(error, {
      operationalScope: "live_run",
      route: "participant.answer"
    });

    expect(response.status).toBe(500);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        tags: expect.objectContaining({
          operational_scope: "live_run",
          route: "participant.answer",
          status_code: "500"
        })
      })
    );
  });

  it("does not infer public status from substrings in unknown errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = handleRouteError(
      new Error("cannot query invalid_table after Unauthorized column")
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { details: { code: "internal_error" } }
    });
  });

  it("returns explicit AppError contracts without leaking 5xx messages", async () => {
    const validation = handleRouteError(
      new AppError({
        message: "The submitted field is invalid",
        status: 422,
        code: "validation_failed",
        details: { field: "name" }
      })
    );
    expect(validation.status).toBe(422);
    await expect(validation.json()).resolves.toMatchObject({
      error: {
        message: "The submitted field is invalid",
        details: {
          code: "validation_failed",
          field: "name"
        }
      }
    });

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const internal = handleRouteError(
      new AppError({
        message: "Database password appeared here",
        status: 503,
        code: "dependency_failed"
      })
    );
    expect(internal.status).toBe(503);
    const internalBody = await internal.json();
    expect(internalBody).toMatchObject({
      error: { details: { code: "internal_error" } }
    });
    expect(JSON.stringify(internalBody)).not.toContain("dependency_failed");
    expect(JSON.stringify(internalBody)).not.toContain(
      "Database password appeared here"
    );
  });

  it("preserves explicitly allowlisted legacy and domain errors", async () => {
    const auth = handleRouteError(new Error("Unauthorized"));
    expect(auth.status).toBe(401);
    await expect(auth.json()).resolves.toMatchObject({
      error: { details: { code: "unauthorized" } }
    });

    const location = handleRouteError(
      new Error("location_verification_required")
    );
    expect(location.status).toBe(409);
    await expect(location.json()).resolves.toMatchObject({
      error: {
        details: { code: "location_verification_required" }
      }
    });
  });

  it("uses explicit errors for malformed JSON and bearer auth", async () => {
    await expect(
      readJson(
        new Request("https://example.test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{"
        })
      )
    ).rejects.toMatchObject({
      status: 400,
      code: "invalid_json"
    });

    await expect(
      readJson(
        new Request("https://example.test", {
          method: "POST",
          body: "name=value"
        })
      )
    ).rejects.toMatchObject({
      status: 415,
      code: "invalid_content_type"
    });

    expect(() =>
      requireBearer(new Request("https://example.test"), undefined)
    ).toThrow(
      expect.objectContaining({
        status: 500,
        code: "server_configuration_error",
        expose: false
      })
    );
    expect(() =>
      requireBearer(new Request("https://example.test"), "expected")
    ).toThrow(
      expect.objectContaining({
        status: 401,
        code: "unauthorized"
      })
    );
  });

  it("contains no broad substring status classifier", () => {
    expect(httpSource).not.toContain("/not found|invalid|expired/i");
    expect(httpSource).not.toContain(
      "/closed|full|not active|locked|cannot|not optional|not_optional/i"
    );
  });
});
