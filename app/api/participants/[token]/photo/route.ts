import { deliverCheckpointToTeam } from "@/lib/checkpoint-delivery";
import { submitPhoto } from "@/lib/physical-actions";
import { getParticipantState } from "@/lib/repository";
import { handleRouteError, jsonOk, requireIdempotencyKey } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    await enforceRateLimit({
      scope: "participant-photo",
      identifier: token,
      limit: 6,
      windowSeconds: 60
    });
    const form = await request.formData();
    const file = form.get("photo");
    if (!(file instanceof File)) throw new Error("Photo is required");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await submitPhoto({
      token,
      bytes,
      mimeType: file.type,
      idempotencyKey: requireIdempotencyKey(request)
    });

    if (result.approved) {
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
