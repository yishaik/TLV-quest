import "server-only";

import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { processOutbox } from "@/lib/providers";
import { sendDueHints, startDueRuns } from "@/lib/automation";
import { cleanupAbandonedPhotoUploads } from "@/lib/photo-uploads";
import { cleanupRateLimitBuckets } from "@/lib/rate-limit";

export const MAINTENANCE_MONITOR_SLUG = "tlv-quest-maintenance";

export const MAINTENANCE_MONITOR_CONFIG = {
  schedule: {
    type: "crontab" as const,
    value: "*/5 * * * *"
  },
  checkinMargin: 2,
  maxRuntime: 2,
  timezone: "Etc/UTC",
  failureIssueThreshold: 1,
  recoveryThreshold: 1
};

export const purgeExpiredRunsWithStorage = async () => {
  const supabase = createAdminClient();
  const { data: runs, error: runError } = await supabase
    .from("game_runs")
    .select("id")
    .in("status", ["finished", "cancelled"])
    .not("retention_until", "is", null)
    .lte("retention_until", new Date().toISOString())
    .limit(50);
  if (runError) throw runError;

  const runIds = (runs ?? []).map((run) => run.id);
  if (!runIds.length) return { runsDeleted: 0, filesDeleted: 0 };

  const { data: media, error: mediaError } = await supabase
    .from("media_assets")
    .select("storage_path")
    .in("run_id", runIds);
  if (mediaError) throw mediaError;

  const paths = (media ?? []).map((asset) => asset.storage_path);
  let filesDeleted = 0;
  for (let index = 0; index < paths.length; index += 100) {
    const batch = paths.slice(index, index + 100);
    const { error } = await supabase.storage.from("game-media").remove(batch);
    if (error) throw error;
    filesDeleted += batch.length;
  }

  const { data: runsDeleted, error: purgeError } = await supabase.rpc(
    "purge_expired_run_data"
  );
  if (purgeError) throw purgeError;

  return { runsDeleted: runsDeleted ?? 0, filesDeleted };
};

export const runMaintenanceWorker = async () => {
  const startedAt = Date.now();
  const checkInId = Sentry.captureCheckIn(
    {
      monitorSlug: MAINTENANCE_MONITOR_SLUG,
      status: "in_progress"
    },
    MAINTENANCE_MONITOR_CONFIG
  );

  try {
    const starts = await startDueRuns();
    const hints = await sendDueHints();
    const outbox = await processOutbox(30);
    const photoUploads = await cleanupAbandonedPhotoUploads(50);
    const rateLimits = await cleanupRateLimitBuckets();
    const purge = await purgeExpiredRunsWithStorage();
    const failedOutbox = outbox.filter(
      (result) => result.status === "failed"
    ).length;

    Sentry.metrics.gauge("tlv_quest.worker.outbox_failures", failedOutbox, {
      attributes: {
        operational_scope: "background_worker"
      }
    });
    Sentry.captureCheckIn({
      monitorSlug: MAINTENANCE_MONITOR_SLUG,
      checkInId,
      status: "ok",
      duration: (Date.now() - startedAt) / 1000
    });

    return {
      starts,
      hints,
      outbox: {
        processed: outbox.length,
        failed: failedOutbox
      },
      photoUploads,
      rateLimits,
      purge
    };
  } catch (error) {
    Sentry.captureCheckIn({
      monitorSlug: MAINTENANCE_MONITOR_SLUG,
      checkInId,
      status: "error",
      duration: (Date.now() - startedAt) / 1000
    });
    throw error;
  }
};
