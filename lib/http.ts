import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { RateLimitExceededError } from "./rate-limit-core";

type ErrorDetails = Record<string, unknown>;

type AppErrorInput = {
  message: string;
  status?: number;
  code?: string;
  details?: ErrorDetails;
  expose?: boolean;
};

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
  }: AppErrorInput) {
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

const INTERNAL_ERROR_MESSAGE =
  "אירעה תקלה זמנית. נסו שוב בעוד רגע. / A temporary error occurred. Please try again.";

const DOMAIN_MESSAGES = {
  location_verification_required:
    "יש לאמת את המיקום בתחנה לפני שליחת התשובה. לחצו על ‘אימות מיקום’ ונסו שוב. / Verify your checkpoint location before answering.",
  scan_verification_required:
    "יש לסרוק את קוד התחנה לפני שליחת התשובה. / Scan the checkpoint code before answering.",
  photo_fallback_not_unlocked:
    "שאלת הגיבוי נפתחת רק לאחר ניסיון צילום שלא אושר. / The fallback unlocks after an unapproved photo.",
  inactive_content_sources:
    "לא ניתן לפרסם מסלול שמשתמש בתוכן שאינו פעיל. / A route using inactive content cannot be published.",
  unauthorized: "נדרשת התחברות. / Authentication is required.",
  forbidden: "אין הרשאה לפעולה זו. / This action is not allowed.",
  not_found:
    "הקישור או המשאב אינם זמינים. / The link or resource is unavailable.",
  conflict:
    "לא ניתן להשלים את הפעולה במצב הנוכחי. / This action is unavailable in the current state.",
  invalid_request:
    "הבקשה אינה תקינה. בדקו את הפרטים ונסו שוב. / Check the submitted details and try again."
} as const;

const CODED_DOMAIN_ERRORS = new Map<
  string,
  { status: number; message: string }
>([
  [
    "location_verification_required",
    { status: 409, message: DOMAIN_MESSAGES.location_verification_required }
  ],
  [
    "scan_verification_required",
    { status: 409, message: DOMAIN_MESSAGES.scan_verification_required }
  ],
  [
    "photo_fallback_not_unlocked",
    { status: 409, message: DOMAIN_MESSAGES.photo_fallback_not_unlocked }
  ],
  [
    "inactive_content_sources",
    { status: 409, message: DOMAIN_MESSAGES.inactive_content_sources }
  ],
  [
    "photo_upload_too_large",
    {
      status: 413,
      message:
        "התמונה גדולה מדי. ניתן להעלות עד 10MB. / The image is too large. Upload up to 10MB."
    }
  ],
  [
    "photo_upload_expired",
    {
      status: 410,
      message:
        "תוקף העלאת התמונה פג. בחרו אותה מחדש. / The photo upload expired. Select it again."
    }
  ],
  [
    "photo_upload_not_found",
    { status: 404, message: DOMAIN_MESSAGES.not_found }
  ]
]);

const UNSUPPORTED_PHOTO_CODES = new Set([
  "photo_upload_invalid_signature",
  "photo_upload_mime_mismatch",
  "photo_upload_unsupported_format"
]);

const PHOTO_CONFLICT_CODES = new Set([
  "photo_checkpoint_changed",
  "photo_upload_idempotency_conflict",
  "photo_upload_not_ready",
  "photo_upload_path_mismatch",
  "photo_upload_size_mismatch"
]);

const NOT_FOUND_CODES = new Set([
  "checkpoint_not_found",
  "participant_not_found",
  "run_not_found",
  "team_not_found"
]);

const CONFLICT_CODES = new Set([
  "checkpoint_changed",
  "checkpoint_locked",
  "checkpoint_not_optional",
  "game_not_active",
  "idempotency_key_conflict",
  "run_cannot_start",
  "run_has_no_checkpoints",
  "team_not_active"
]);

const INVALID_REQUEST_CODES = new Set([
  "invalid_idempotency_key",
  "invalid_skip_actor",
  "invalid_skip_deliveries",
  "invalid_skip_reason",
  "skip_participant_required"
]);

// Compatibility bridge for intentional errors that predate AppError. New call
// sites must throw AppError instead of adding heuristic message classifiers.
const exactRules = new Map<
  string,
  { status: number; code: string; message?: string }
>();

const addExactRules = (
  status: number,
  code: string,
  messages: string[],
  message?: string
) => {
  for (const rawMessage of messages) {
    exactRules.set(rawMessage, { status, code, message });
  }
};

addExactRules(401, "unauthorized", ["Unauthorized"], DOMAIN_MESSAGES.unauthorized);
addExactRules(
  403,
  "forbidden",
  ["Admin access is not allowed"],
  DOMAIN_MESSAGES.forbidden
);
addExactRules(404, "not_found", [
  "Active game template was not found",
  "Checkpoint was not found",
  "Game run was not found",
  "Game was not found",
  "Invalid resume link",
  "Organizer link is invalid or expired",
  "Participant link is invalid or expired",
  "Participant was not found",
  "Recovery code is invalid",
  "Resume link has expired",
  "Riddle was not found",
  "Route stop was not found",
  "Route was not found",
  "Source version was not found",
  "Station was not found",
  "Team was not found",
  "Template version was not found",
  "Template was not found",
  "The selected route is not published or no longer available"
]);
addExactRules(409, "conflict", [
  "A management link cannot be created for a closed game",
  "A route referenced by game runs cannot be deleted",
  "A route that has been published cannot be deleted",
  "Checkpoint is locked",
  "Game is full",
  "Game is not active",
  "No active checkpoint",
  "No more hints are available",
  "No team capacity available",
  "Only a draft or review version can be published",
  "Organizer invite has already been used",
  "Participant has no team",
  "Published content is immutable. Create a draft first.",
  "Published content is immutable. Create a new draft first.",
  "Registration is closed",
  "Riddle is used by one or more route versions and cannot be deleted",
  "Station is used by one or more route versions and cannot be deleted",
  "The active published version cannot be deleted",
  "The last version cannot be deleted. Delete the unpublished route instead.",
  "The selected route does not have a published active version",
  "The selected route has no active checkpoints",
  "This checkpoint does not accept a station scan",
  "This checkpoint does not accept a text answer",
  "This checkpoint does not accept an answer",
  "This checkpoint has no location requirement",
  "This checkpoint is not completed by scanning alone",
  "This phone is already registered",
  "This version is referenced by game runs and cannot be deleted"
]);
addExactRules(400, "invalid_request", [
  "A published route must be selected",
  "A valid organizer invite is required",
  "Answer is required",
  "At least one route title is required",
  "At least one station title is required",
  "Checkpoint id is required",
  "Checkpoint order must include every checkpoint exactly once",
  "Checkpoint slug already exists in this version",
  "Checkpoint slug is required and must use Latin letters or numbers",
  "Consent is required",
  "Delete or move the station riddles before deleting the station",
  "Every route stop must use a riddle from its selected station",
  "First name is required",
  "Health status update failed",
  "Image is required",
  "Invalid health status",
  "Invalid template version",
  "Message is required",
  "No checkpoint changes supplied",
  "No content changes supplied",
  "No route changes supplied",
  "Please enter a valid email address",
  "Please enter your name",
  "Riddle and route stop slug are required",
  "Riddle slug is required and must use Latin letters or numbers",
  "Route order must include every stop exactly once",
  "Route slug is required and must use Latin letters or numbers",
  "Station and riddle are required",
  "Station is required",
  "Station slug is required and must use Latin letters or numbers",
  "The selected riddle does not belong to the selected station",
  "The selected riddle does not belong to this station",
  "Unsupported checkpoint kind",
  "Unsupported organizer action",
  "Unsupported riddle kind",
  "Valid latitude and longitude are required",
  "runId is required",
  "יש להזין שם מלא",
  "כתובת האימייל אינה תקינה"
]);
addExactRules(
  413,
  "request_too_large",
  ["Image must be smaller than 8 MB", "Request is too large"]
);
addExactRules(
  415,
  "unsupported_media_type",
  ["Use a JPG, PNG or WebP image"]
);

const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";

const codedDomainError = (rawMessage: string): AppError | null => {
  const cooldown = rawMessage.match(/^answer_cooldown_active(?::(\d+))?$/i);
  if (cooldown) {
    const retryAfterSeconds = Math.max(1, Number(cooldown[1] ?? 30));
    return new AppError({
      message: `יותר מדי ניסיונות שגויים. נסו שוב בעוד ${retryAfterSeconds} שניות. Too many wrong attempts. Try again in ${retryAfterSeconds} seconds.`,
      status: 429,
      code: "answer_cooldown_active",
      details: { retryAfterSeconds }
    });
  }

  const direct = CODED_DOMAIN_ERRORS.get(rawMessage);
  if (direct) {
    return new AppError({
      message: direct.message,
      status: direct.status,
      code: rawMessage
    });
  }

  if (UNSUPPORTED_PHOTO_CODES.has(rawMessage)) {
    return new AppError({
      message:
        "אפשר להעלות JPG, PNG או WebP בלבד. / Upload a JPG, PNG, or WebP image.",
      status: 415,
      code: "photo_upload_unsupported_format"
    });
  }

  if (PHOTO_CONFLICT_CODES.has(rawMessage)) {
    return new AppError({
      message:
        "לא ניתן להשלים את העלאת התמונה. בחרו אותה מחדש. / The photo upload could not be completed. Select it again.",
      status: 409,
      code: "photo_upload_not_ready"
    });
  }

  if (NOT_FOUND_CODES.has(rawMessage)) {
    return new AppError({
      message: DOMAIN_MESSAGES.not_found,
      status: 404,
      code: rawMessage
    });
  }

  if (rawMessage === "participant_not_in_team") {
    return new AppError({
      message: DOMAIN_MESSAGES.forbidden,
      status: 403,
      code: rawMessage
    });
  }

  if (CONFLICT_CODES.has(rawMessage)) {
    return new AppError({
      message: DOMAIN_MESSAGES.conflict,
      status: 409,
      code: rawMessage
    });
  }

  if (INVALID_REQUEST_CODES.has(rawMessage)) {
    return new AppError({
      message: DOMAIN_MESSAGES.invalid_request,
      status: 400,
      code: rawMessage
    });
  }

  return null;
};

const intentionalError = (error: unknown): AppError | null => {
  if (error instanceof AppError) return error;

  if (error instanceof RateLimitExceededError) {
    return new AppError({
      message: `יותר מדי בקשות. נסו שוב בעוד ${error.retryAfterSeconds} שניות. Too many requests. Try again in ${error.retryAfterSeconds} seconds.`,
      status: 429,
      code: error.code,
      details: { retryAfterSeconds: error.retryAfterSeconds }
    });
  }

  const rawMessage = errorMessage(error).trim();
  const coded = codedDomainError(rawMessage);
  if (coded) return coded;

  const exact = exactRules.get(rawMessage);
  return exact
    ? new AppError({
        message: exact.message ?? rawMessage,
        status: exact.status,
        code: exact.code
      })
    : null;
};

export const handleRouteError = (error: unknown) => {
  const correlationId = randomUUID();
  const mapped = intentionalError(error);
  const safeError =
    mapped ??
    new AppError({
      message: INTERNAL_ERROR_MESSAGE,
      status: 500,
      code: "internal_error",
      expose: false
    });
  const expose = safeError.expose && safeError.status < 500;
  const message = expose ? safeError.message : INTERNAL_ERROR_MESSAGE;
  const publicCode = expose ? safeError.code : "internal_error";
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "x-correlation-id": correlationId
  };
  const retryAfterSeconds = safeError.details?.retryAfterSeconds;
  if (safeError.status === 429 && typeof retryAfterSeconds === "number") {
    headers["retry-after"] = String(
      Math.max(1, Math.ceil(retryAfterSeconds))
    );
  }

  if (!mapped || safeError.status >= 500) {
    Sentry.captureException(error, {
      tags: {
        correlation_id: correlationId,
        error_code: safeError.code
      }
    });
    console.error("api.route_error", {
      correlationId,
      code: safeError.code,
      error
    });
  }

  return jsonError(
    message,
    safeError.status,
    {
      code: publicCode,
      correlationId,
      ...(expose && safeError.details ? safeError.details : {})
    },
    headers
  );
};

export const readJson = async <T extends Record<string, unknown>>(
  request: Request
): Promise<T> => {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new AppError({
      message: "Expected application/json request body",
      status: 415,
      code: "invalid_content_type"
    });
  }
  try {
    return (await request.json()) as T;
  } catch {
    throw new AppError({
      message: "Request body must contain valid JSON",
      status: 400,
      code: "invalid_json"
    });
  }
};

const IDEMPOTENCY_KEY_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9:._-]{11,199}$/;

export const requireIdempotencyKey = (request: Request): string => {
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!key) {
    throw new AppError({
      message:
        "חסר מזהה פעולה. רעננו את הדף ונסו שוב. / The action identifier is missing. Refresh and try again.",
      status: 400,
      code: "missing_idempotency_key"
    });
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new AppError({
      message:
        "מזהה הפעולה אינו תקין. רעננו את הדף ונסו שוב. / The action identifier is invalid. Refresh and try again.",
      status: 400,
      code: "invalid_idempotency_key"
    });
  }
  return key;
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
      message: DOMAIN_MESSAGES.unauthorized,
      status: 401,
      code: "unauthorized"
    });
  }
};
