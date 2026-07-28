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

  const status =
    /not found|invalid|expired/i.test(rawMessage)
      ? 404
      : /closed|full|not active|locked|cannot/i.test(rawMessage)
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
