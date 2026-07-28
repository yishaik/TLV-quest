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
  const message = error instanceof Error ? error.message : "Unexpected error";
  const status =
    /not found|invalid|expired/i.test(message)
      ? 404
      : /closed|full|not active|locked|cannot/i.test(message)
        ? 409
        : 400;
  return jsonError(message, status);
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
