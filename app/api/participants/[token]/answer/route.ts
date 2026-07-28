import { randomUUID } from "node:crypto";
import { submitTextAnswer } from "@/lib/repository";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const body = await readJson<Record<string, unknown>>(request);
    const answer = typeof body.answer === "string" ? body.answer.trim() : "";
    if (!answer) throw new Error("Answer is required");

    const idempotencyKey =
      request.headers.get("idempotency-key") ?? `web-answer:${randomUUID()}`;
    return jsonOk(await submitTextAnswer({ token, answer, idempotencyKey }));
  } catch (error) {
    return handleRouteError(error);
  }
}
