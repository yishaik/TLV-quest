import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { processOutbox } from "@/lib/providers";

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
  const [outbox, purge] = await Promise.all([
    processOutbox(30),
    purgeExpiredRunsWithStorage()
  ]);

  return {
    outbox: {
      processed: outbox.length,
      failed: outbox.filter((result) => result.status === "failed").length
    },
    purge
  };
};
