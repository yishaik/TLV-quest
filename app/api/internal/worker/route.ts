import { runMaintenanceWorker } from "@/lib/maintenance";
import { handleRouteError, jsonOk, requireBearer } from "@/lib/http";
import { enforceIpRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    await enforceIpRateLimit("worker", request);
    requireBearer(request, process.env.WORKER_SECRET);
    return jsonOk(await runMaintenanceWorker());
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function GET(request: Request) {
  return POST(request);
}
