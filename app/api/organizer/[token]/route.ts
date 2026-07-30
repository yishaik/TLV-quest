import { getOrganizerRun } from "@/lib/repository";
import { hashSecret } from "@/lib/crypto";
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
      scope: "organizer-state",
      identifier: hashSecret(token),
      limit: 20,
      windowSeconds: 60
    });
    return jsonOk(await getOrganizerRun(token));
  } catch (error) {
    return handleRouteError(error);
  }
}
