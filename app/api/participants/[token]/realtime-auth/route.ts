import { handleRouteError, jsonOk } from "@/lib/http";
import { issueParticipantRealtimeAccess } from "@/lib/realtime-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    return jsonOk(await issueParticipantRealtimeAccess(token), {
      headers: {
        "cache-control": "no-store, max-age=0"
      }
    });
  } catch (error) {
    return handleRouteError(error, {
      operationalScope: "live_run",
      route: "participant.realtime_auth"
    });
  }
}
