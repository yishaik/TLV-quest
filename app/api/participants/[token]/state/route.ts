import { getParticipantExperienceState } from "@/lib/experience-meta";
import { handleRouteError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    return jsonOk(await getParticipantExperienceState(token));
  } catch (error) {
    return handleRouteError(error);
  }
}
