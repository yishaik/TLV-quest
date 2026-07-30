import { getParticipantExperienceState } from "@/lib/experience-meta";
import { handleRouteError, jsonOk } from "@/lib/http";
import { enforceParticipantRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    await enforceParticipantRateLimit("participantState", token);
    return jsonOk(await getParticipantExperienceState(token));
  } catch (error) {
    return handleRouteError(error);
  }
}
