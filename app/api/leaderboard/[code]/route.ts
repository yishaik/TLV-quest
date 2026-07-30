import { getLeaderboard } from "@/lib/repository";
import { handleRouteError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await context.params;
    return jsonOk(await getLeaderboard(code));
  } catch (error) {
    return handleRouteError(error, {
      operationalScope: "live_run",
      route: "leaderboard.state"
    });
  }
}
