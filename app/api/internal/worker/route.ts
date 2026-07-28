import { runMaintenanceWorker } from "@/lib/maintenance";
import { handleRouteError, jsonOk, requireBearer } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    requireBearer(request, process.env.WORKER_SECRET);
    return jsonOk(await runMaintenanceWorker());
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function GET(request: Request) {
  return POST(request);
}
