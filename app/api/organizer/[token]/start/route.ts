import { deliverCheckpointToRun } from "@/lib/checkpoint-delivery";
import { startRunByOrganizerToken } from "@/lib/repository";
import { hashSecret } from "@/lib/crypto";
import {
  handleRouteError,
  jsonOk,
  requireIdempotencyKey
} from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    requireIdempotencyKey(request, "organizer-start");
    await enforceRateLimit({
      scope: "organizer-start",
      identifier: hashSecret(token),
      limit: 3,
      windowSeconds: 60
    });
    const started = await startRunByOrganizerToken(token);
    const result =
      started.result && typeof started.result === "object" && !Array.isArray(started.result)
        ? (started.result as Record<string, unknown>)
        : {};
    const firstSlug = typeof result.first_checkpoint === "string" ? result.first_checkpoint : null;

    let delivery = { sent: 0, failed: 0 };
    if (firstSlug) {
      delivery = await deliverCheckpointToRun({
        runId: started.run.id,
        slug: firstSlug
      });
    }

    return jsonOk({ ...started, delivery });
  } catch (error) {
    return handleRouteError(error);
  }
}
