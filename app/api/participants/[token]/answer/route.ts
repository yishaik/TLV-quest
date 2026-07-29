import { randomUUID } from "node:crypto";
import { deliverCheckpointToTeam } from "@/lib/checkpoint-delivery";
import { submitCheckpointAnswer } from "@/lib/answer-submission";
import { getParticipantState } from "@/lib/repository";
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
    const result = await submitCheckpointAnswer({ token, answer, idempotencyKey });

    if (result.evaluation.correct) {
      const state = await getParticipantState(token);
      if (state.checkpoint) {
        await deliverCheckpointToTeam({
          runId: state.run.id,
          teamId: state.team.id,
          slug: state.checkpoint.slug
        });
      }
    }

    return jsonOk(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
