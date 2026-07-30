import { NextResponse } from "next/server";
import { RateLimitExceededError } from "./rate-limit-core";

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

export const handleRouteError = (error: unknown) => {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message ?? "Unexpected error")
        : "Unexpected error";

  const cooldownMatch = rawMessage.match(
    /answer_cooldown_active(?::(\d+))?/i
  );
  const rateLimited =
    error instanceof RateLimitExceededError || Boolean(cooldownMatch);
  if (rateLimited) {
    const retryAfterSeconds =
      error instanceof RateLimitExceededError
        ? error.retryAfterSeconds
        : Math.max(1, Number(cooldownMatch?.[1] ?? 30));
    const code =
      cooldownMatch ? "answer_cooldown_active" : "rate_limit_exceeded";
    const message =
      code === "answer_cooldown_active"
        ? `יותר מדי ניסיונות שגויים. נסו שוב בעוד ${retryAfterSeconds} שניות. Too many wrong attempts. Try again in ${retryAfterSeconds} seconds.`
        : `יותר מדי בקשות. נסו שוב בעוד ${retryAfterSeconds} שניות. Too many requests. Try again in ${retryAfterSeconds} seconds.`;
    return jsonError(
      message,
      429,
      { code, retryAfterSeconds },
      {
        "cache-control": "no-store",
        "retry-after": String(retryAfterSeconds)
      }
    );
  }

  if (/photo_upload_too_large/i.test(rawMessage)) {
    return jsonError(
      "התמונה גדולה מדי. ניתן להעלות תמונה בגודל של עד 10MB.",
      413,
      { code: "photo_upload_too_large" }
    );
  }

  if (
    /photo_upload_unsupported_format|photo_upload_mime_mismatch|photo_upload_invalid_signature/i.test(
      rawMessage
    )
  ) {
    return jsonError(
      "אפשר להעלות תמונה בפורמט JPG, PNG או WebP בלבד.",
      415,
      { code: "photo_upload_unsupported_format" }
    );
  }

  if (/photo_upload_expired/i.test(rawMessage)) {
    return jsonError(
      "תוקף העלאת התמונה פג. בחרו את התמונה מחדש ונסו שוב.",
      410,
      { code: "photo_upload_expired" }
    );
  }

  if (
    /photo_upload_not_ready|photo_upload_idempotency_conflict|photo_upload_path_mismatch|photo_upload_size_mismatch|photo_checkpoint_changed/i.test(
      rawMessage
    )
  ) {
    return jsonError(
      "לא ניתן להשלים את העלאת התמונה. בחרו אותה מחדש ונסו שוב.",
      409,
      { code: "photo_upload_not_ready" }
    );
  }

  if (/photo_upload_not_found/i.test(rawMessage)) {
    return jsonError(
      "העלאת התמונה לא נמצאה או שפג תוקפה.",
      404,
      { code: "photo_upload_not_found" }
    );
  }

  if (/location_verification_required/i.test(rawMessage)) {
    return jsonError(
      "יש לאמת את המיקום בתחנה לפני שליחת התשובה. לחצו על ‘אימות מיקום’ ונסו שוב.",
      409,
      { code: "location_verification_required" }
    );
  }

  if (/scan_verification_required/i.test(rawMessage)) {
    return jsonError(
      "יש לסרוק את קוד התחנה לפני שליחת התשובה.",
      409,
      { code: "scan_verification_required" }
    );
  }

  if (/photo_fallback_not_unlocked/i.test(rawMessage)) {
    return jsonError(
      "שאלת הגיבוי נפתחת רק לאחר ניסיון צילום שלא אושר.",
      409,
      { code: "photo_fallback_not_unlocked" }
    );
  }

  if (/inactive_content_sources/i.test(rawMessage)) {
    return jsonError(
      "לא ניתן לפרסם מסלול שמשתמש בתחנה או בחידה שאינן במצב פעיל.",
      409,
      { code: "inactive_content_sources" }
    );
  }

  const status =
    /unauthorized/i.test(rawMessage)
      ? 401
      : /access is not allowed|forbidden/i.test(rawMessage)
        ? 403
        : /not found|invalid|expired/i.test(rawMessage)
          ? 404
          : /closed|full|not active|locked|cannot|not optional|not_optional/i.test(rawMessage)
            ? 409
            : 400;
  return jsonError(rawMessage, status);
};

export const readJson = async <T extends Record<string, unknown>>(
  request: Request
): Promise<T> => {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("Expected application/json request body");
  }
  return (await request.json()) as T;
};

export const requireBearer = (request: Request, expected?: string) => {
  if (!expected) throw new Error("Server secret is not configured");
  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${expected}`) {
    throw new Error("Unauthorized");
  }
};
