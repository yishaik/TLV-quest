import { randomUUID } from "node:crypto";
import { requestHint } from "@/lib/repository";
import { handleRouteError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const idempotencyKey =
      request.headers.get("idempotency-key") ?? `web-hint:${randomUUID()}`;
    return jsonOk(await requestHint({ token, idempotencyKey }));
  } catch (error) {
    return handleRouteError(error);
  }
}
