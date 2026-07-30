import { authorizeOutboxWorker } from "@/lib/outbox-worker-auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";
import { cleanupAbandonedPhotoUploads } from "@/lib/photo-uploads";
import { processOutbox } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    if (!(await authorizeOutboxWorker(request))) {
      return jsonError("Unauthorized", 401);
    }

    const [results, photoCleanup] = await Promise.all([
      processOutbox(100),
      cleanupAbandonedPhotoUploads(50).catch((error: unknown) => {
        console.error("Abandoned photo cleanup failed", {
          errorCode: error instanceof Error ? error.name : "UnknownError"
        });
        return { claimed: 0, deleted: 0 };
      })
    ]);
    return jsonOk({
      processed: results.length,
      sent: results.filter(
        (result) => result.status === "sent" || result.status === "mocked"
      ).length,
      retryScheduled: results.filter(
        (result) => result.status === "retry_scheduled"
      ).length,
      failed: results.filter((result) => result.status === "failed").length,
      photoCleanup
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
