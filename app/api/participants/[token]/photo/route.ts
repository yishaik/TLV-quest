import { randomUUID } from "node:crypto";
import { deliverCheckpointToTeam } from "@/lib/checkpoint-delivery";
import { finalizePhotoUpload } from "@/lib/photo-uploads";
import { getParticipantState } from "@/lib/repository";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const body = await readJson<{ uploadId?: unknown }>(request);
    const finalized = await finalizePhotoUpload({
      token,
      uploadId: body.uploadId,
      idempotencyKey:
        request.headers.get("idempotency-key") ?? `photo:${randomUUID()}`
    });

    if (finalized.result.approved && !finalized.replayed) {
      const state = await getParticipantState(token);
      if (state.checkpoint) {
        await deliverCheckpointToTeam({
          runId: state.run.id,
          teamId: state.team.id,
          slug: state.checkpoint.slug
        });
      }
    }

    return jsonOk(finalized.result);
  } catch (error) {
    return handleRouteError(error);
  }
}
