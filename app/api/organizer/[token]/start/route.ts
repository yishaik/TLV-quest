import { deliverCheckpointToRun } from "@/lib/checkpoint-delivery";
import { startRunByOrganizerToken } from "@/lib/repository";
import { handleRouteError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
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
    return handleRouteError(error, {
      operationalScope: "live_run",
      route: "organizer.start"
    });
  }
}
