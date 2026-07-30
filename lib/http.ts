import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

type ErrorDetails = Record<string, unknown>;

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetails;
  readonly expose: boolean;

  constructor({
    message,
    status = 400,
    code = "bad_request",
    details,
    expose = true
  }: {
    message: string;
    status?: number;
    code?: string;
    details?: ErrorDetails;
    expose?: boolean;
  }) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = expose;
  }
}

export const jsonOk = <T>(data: T, init?: ResponseInit) =>
  NextResponse.json({ ok: true, data }, init);

export const jsonError = (
  message: string,
  status = 400,
  details?: unknown,
  headers?: HeadersInit
) =>
  NextResponse.json(
    { ok: false, error: { message, details } },
    { status, headers }
  );

const knownError = (rawMessage: string): AppError | null => {
  const normalizedMessage = rawMessage.trim() || "Unexpected error";
  const cases: Array<{
    pattern: RegExp;
    message: string;
    status: number;
    code: string;
  }> = [
    {
      pattern: /location_verification_required/i,
      message:
        "יש לאמת את המיקום בתחנה לפני שליחת התשובה. לחצו על ‘אימות מיקום’ ונסו שוב. / Verify your checkpoint location before answering.",
      status: 409,
      code: "location_verification_required"
    },
    {
      pattern: /scan_verification_required/i,
      message:
        "יש לסרוק את קוד התחנה לפני שליחת התשובה. / Scan the checkpoint code before answering.",
      status: 409,
      code: "scan_verification_required"
    },
    {
      pattern: /photo_fallback_not_unlocked/i,
      message:
        "שאלת הגיבוי נפתחת רק לאחר ניסיון צילום שלא אושר. / The fallback unlocks after an unapproved photo.",
      status: 409,
      code: "photo_fallback_not_unlocked"
    },
    {
      pattern: /hint_not_available(?::(\d+))?/i,
      message:
        "הרמז ייפתח אחרי שני ניסיונות או לאחר זמן חיפוש נוסף. / The hint unlocks after two attempts or more search time.",
      status: 409,
      code: "hint_not_available"
    },
    {
      pattern: /inactive_content_sources/i,
      message:
        "לא ניתן לפרסם מסלול עם תוכן שאינו פעיל. / A route with inactive content cannot be published.",
      status: 409,
      code: "inactive_content_sources"
    },
    {
      pattern: /answer_cooldown_active(?::(\d+))?/i,
      message:
        "נשלחו ניסיונות רבים מדי. המתינו מעט ונסו שוב. / Too many attempts. Wait briefly and try again.",
      status: 429,
      code: "answer_cooldown_active"
    },
    {
      pattern: /unauthorized/i,
      message: "נדרשת התחברות. / Authentication is required.",
      status: 401,
      code: "unauthorized"
    },
    {
      pattern: /access is not allowed|forbidden/i,
      message: "אין הרשאה לפעולה זו. / This action is not allowed.",
      status: 403,
      code: "forbidden"
    },
    {
      pattern: /not found|invalid|expired/i,
      message:
        "הקישור או המשאב אינם זמינים. / The link or resource is unavailable.",
      status: 404,
      code: "not_found"
    },
    {
      pattern: /closed|full|not active|locked|cannot|not optional|not_optional/i,
      message:
        "לא ניתן להשלים את הפעולה במצב הנוכחי. / This action is unavailable in the current state.",
      status: 409,
      code: "conflict"
    },
    {
      pattern:
        /required|expected application\/json|unsupported image|image is too large|request is too large|no more hints/i,
      message:
        "הבקשה אינה תקינה. בדקו את הפרטים ונסו שוב. / Check the submitted details and try again.",
      status: 400,
      code: "invalid_request"
    }
  ];
  const matched = cases.find((candidate) =>
    candidate.pattern.test(normalizedMessage)
  );
  return matched ? new AppError(matched) : null;
};

const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";

export const handleRouteError = (error: unknown) => {
  const correlationId = randomUUID();
  const mapped =
    error instanceof AppError ? error : knownError(errorMessage(error));
  const safeError =
    mapped ??
    new AppError({
      message:
        "אירעה תקלה זמנית. נסו שוב בעוד רגע. / A temporary error occurred. Please try again.",
      status: 500,
      code: "internal_error",
      expose: false
    });
  const responseHeaders: Record<string, string> = {
    "x-correlation-id": correlationId
  };
  const retryAfter = safeError.details?.retryAfter;
  if (safeError.status === 429 && typeof retryAfter === "number") {
    responseHeaders["retry-after"] = String(Math.max(1, Math.ceil(retryAfter)));
  }

  if (!mapped || safeError.status >= 500) {
    Sentry.captureException(error, {
      tags: { correlation_id: correlationId, error_code: safeError.code }
    });
    console.error("API route failed", {
      correlationId,
      code: safeError.code,
      error
    });
  }

  return jsonError(
    safeError.message,
    safeError.status,
    {
      code: safeError.code,
      correlationId,
      ...(safeError.expose && safeError.details ? safeError.details : {})
    },
    responseHeaders
  );
};

export const readJson = async <T extends Record<string, unknown>>(
  request: Request
): Promise<T> => {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new AppError({
      message: "Expected application/json request body",
      code: "invalid_content_type"
    });
  }
  try {
    return (await request.json()) as T;
  } catch {
    throw new AppError({
      message: "Request body must contain valid JSON",
      code: "invalid_json"
    });
  }
};

export const requireBearer = (request: Request, expected?: string) => {
  if (!expected) {
    throw new AppError({
      message: "Server secret is not configured",
      status: 500,
      code: "server_configuration_error",
      expose: false
    });
  }
  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${expected}`) {
    throw new AppError({
      message: "Unauthorized",
      status: 401,
      code: "unauthorized"
    });
  }
};

export const requireAnyBearer = (
  request: Request,
  expectedValues: Array<string | undefined>
) => {
  const configured = expectedValues.filter(
    (value): value is string => Boolean(value)
  );
  if (!configured.length) {
    throw new AppError({
      message: "Server secret is not configured",
      status: 500,
      code: "server_configuration_error",
      expose: false
    });
  }
  const authorization = request.headers.get("authorization");
  if (!configured.some((expected) => authorization === `Bearer ${expected}`)) {
    throw new AppError({
      message: "Unauthorized",
      status: 401,
      code: "unauthorized"
    });
  }
};

export const requireIdempotencyKey = (
  request: Request,
  expectedPrefix?: string
) => {
  const value = request.headers.get("idempotency-key")?.trim() ?? "";
  const valid =
    value.length >= 8 &&
    value.length <= 200 &&
    /^[a-zA-Z0-9._:-]+$/.test(value) &&
    (!expectedPrefix || value.startsWith(`${expectedPrefix}:`));
  if (!valid) {
    throw new AppError({
      message: "A valid idempotency-key header is required",
      status: 400,
      code: "idempotency_key_required"
    });
  }
  return value;
};
