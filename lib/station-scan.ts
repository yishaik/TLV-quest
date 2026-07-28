import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getParticipantState } from "@/lib/repository";

export const recordStationScan = async ({
  token,
  stationSlug,
  idempotencyKey
}: {
  token: string;
  stationSlug: string;
  idempotencyKey: string;
}) => {
  const state = await getParticipantState(token);
  if (state.run.status !== "active") throw new Error("Game is not active");
  if (!state.checkpoint) throw new Error("No active checkpoint");
  if (state.checkpoint.slug !== stationSlug) throw new Error("Checkpoint is locked");

  const supabase = createAdminClient();
  const { error } = await supabase.from("game_events").upsert(
    {
      run_id: state.run.id,
      team_id: state.team.id,
      participant_id: state.participant.id,
      event_type: "STATION_SCANNED",
      idempotency_key: idempotencyKey,
      payload: { checkpoint_slug: stationSlug }
    },
    { onConflict: "idempotency_key", ignoreDuplicates: true }
  );
  if (error) throw error;

  await supabase
    .from("teams")
    .update({ status: "solving", last_progress_at: new Date().toISOString() })
    .eq("id", state.team.id);

  return {
    verified: true,
    stationSlug,
    playUrl: `/play/${token}`
  };
};
