import { runMaintenanceWorker } from "@/lib/maintenance";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { authorizeWorkerRequest } from "@/lib/worker-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    await enforceIpRateLimit("worker", request);
    // Accepts WORKER_SECRET or a single-use token minted inside Postgres, so
    // the five-minute pg_cron schedule needs no long-lived secret in the
    // database. See docs/scheduled-workers.md.
    if (!(await authorizeWorkerRequest(request))) {
      return jsonError("Unauthorized", 401);
    }
    return jsonOk(await runMaintenanceWorker());
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function GET(request: Request) {
  return POST(request);
}
