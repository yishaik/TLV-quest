import { NextResponse } from "next/server";

export const jsonOk = <T>(data: T, init?: ResponseInit) =>
  NextResponse.json({ ok: true, data }, init);

export const jsonError = (
  message: string,
  status = 400,
  details?: unknown
) =>
  NextResponse.json(
    { ok: false, error: { message, details } },
    { status }
  );

export const handleRouteError = (error: unknown) => {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message ?? "Unexpected error")
        : "Unexpected error";

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
