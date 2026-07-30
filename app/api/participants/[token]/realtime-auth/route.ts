import { handleRouteError, jsonOk } from "@/lib/http";
import { issueParticipantRealtimeAccess } from "@/lib/realtime-auth";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    await enforceRateLimit({
      scope: "participant-realtime-auth",
      identifier: token,
      limit: 12,
      windowSeconds: 60
    });
    return jsonOk(await issueParticipantRealtimeAccess(token), {
      headers: {
        "cache-control": "no-store, max-age=0"
      }
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
