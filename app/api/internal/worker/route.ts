import { runMaintenanceWorker } from "@/lib/maintenance";
import { handleRouteError, jsonOk, requireAnyBearer } from "@/lib/http";
import { enforceRateLimit, requestIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    requireAnyBearer(request, [
      process.env.WORKER_SECRET,
      process.env.CRON_SECRET
    ]);
    await enforceRateLimit({
      scope: "internal-worker",
      identifier: requestIp(request),
      limit: 12,
      windowSeconds: 60
    });
    return jsonOk(await runMaintenanceWorker());
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function GET(request: Request) {
  return POST(request);
}
