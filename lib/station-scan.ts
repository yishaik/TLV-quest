import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getParticipantState } from "@/lib/repository";
import { verifyStationScan } from "@/lib/physical-actions";

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

  if (state.checkpoint.kind === "scan") {
    const completion = await verifyStationScan({
      token,
      stationSlug,
      idempotencyKey
    });
    return {
      verified: true,
      completed: true,
      stationSlug,
      playUrl: `/play/${token}`,
      completion
    };
  }

  if (state.checkpoint.kind !== "hybrid") {
    throw new Error("This checkpoint does not accept a station scan");
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("game_events").upsert(
    {
      run_id: state.run.id,
      team_id: state.team.id,
      participant_id: state.participant.id,
      event_type: "STATION_SCANNED",
      idempotency_key: idempotencyKey,
      payload: { checkpoint_slug: stationSlug, verified: true }
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
    completed: false,
    requiresAnswer: true,
    stationSlug,
    playUrl: `/play/${token}`
  };
};
