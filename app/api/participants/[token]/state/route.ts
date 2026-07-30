import { getParticipantExperienceState } from "@/lib/experience-meta";
import { handleRouteError, jsonOk } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    await enforceRateLimit({
      scope: "participant-state",
      identifier: token,
      limit: 60,
      windowSeconds: 60
    });
    return jsonOk(await getParticipantExperienceState(token));
  } catch (error) {
    return handleRouteError(error);
  }
}
