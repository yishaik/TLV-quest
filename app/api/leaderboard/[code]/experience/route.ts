import { getLeaderboardExperience } from "@/lib/experience-meta";
import { handleRouteError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await context.params;
    return jsonOk(await getLeaderboardExperience(code));
  } catch (error) {
    return handleRouteError(error);
  }
}
