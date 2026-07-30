import { getOrganizerRun } from "@/lib/repository";
import { handleRouteError, jsonOk } from "@/lib/http";
import { enforceOrganizerRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    await enforceOrganizerRateLimit("organizerState", token);
    return jsonOk(await getOrganizerRun(token));
  } catch (error) {
    return handleRouteError(error, {
      operationalScope: "live_run",
      route: "organizer.state"
    });
  }
}
