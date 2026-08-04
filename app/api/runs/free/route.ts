import { createFreeRun } from "@/lib/free-booking";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";
import { enforceIpRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public, unauthenticated run creation for the promotional free window.
 *
 * Two independent limits apply: this transport limit, which bounds how fast
 * one network origin can call it at all, and the per-person cap inside
 * `createFreeRun`, which is the one that actually matters and cannot be
 * evaded by changing address.
 */
export async function POST(request: Request) {
  try {
    await enforceIpRateLimit("freeBooking", request);
    const body = await readJson<Record<string, unknown>>(request);

    const run = await createFreeRun({
      email: String(body.email ?? ""),
      name: String(body.name ?? ""),
      templateSlug: String(body.templateSlug ?? ""),
      scheduledAt:
        typeof body.scheduledAt === "string" && body.scheduledAt.trim()
          ? body.scheduledAt
          : null,
      maxParticipants: Number(body.maxParticipants),
      checkpointCount: Number(body.checkpointCount),
      locale: body.locale === "en" ? "en" : "he"
    });

    // The organizer token is the only way back into the run, and it is shown
    // once. Everything returned here is safe to display to the person who
    // just created it and to nobody else.
    return jsonOk(
      {
        joinUrl: run.joinUrl,
        manageUrl: run.manageUrl,
        liveUrl: run.liveUrl,
        publicCode: run.publicCode,
        route: run.route,
        remainingFreeRuns: run.remainingFreeRuns
      },
      { status: 201, headers: { "cache-control": "private, no-store" } }
    );
  } catch (error) {
    return handleRouteError(error, { route: "runs.free" });
  }
}
