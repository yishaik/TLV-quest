import "server-only";

import {
  findParticipantIdempotencyEvent,
  isIdempotencyReplay,
  throwIdempotencyConflict
} from "@/lib/idempotency";
import { createAdminClient } from "@/lib/supabase/admin";
import { getParticipantState } from "@/lib/repository";
import { verifyStationScan } from "@/lib/physical-actions";

const textValue = (value: unknown): string =>
  typeof value === "string" ? value : "";

const replayStationScan = async ({
  state,
  stationSlug,
  idempotencyKey,
  token
}: {
  state: Awaited<ReturnType<typeof getParticipantState>>;
  stationSlug: string;
  idempotencyKey: string;
  token: string;
}) => {
  const event = await findParticipantIdempotencyEvent({
    idempotencyKey,
    teamId: state.team.id,
    participantId: state.participant.id,
    eventTypes: ["STATION_SCANNED", "ANSWER_ACCEPTED"]
  });
  if (!event) return null;
  if (textValue(event.payload.checkpoint_slug) !== stationSlug) {
    throwIdempotencyConflict();
  }

  if (event.eventType === "ANSWER_ACCEPTED") {
    const submissionId = textValue(event.payload.submission_id);
    if (!submissionId) throwIdempotencyConflict();
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("submissions")
      .select("submission_type")
      .eq("id", submissionId)
      .eq("team_id", state.team.id)
      .eq("participant_id", state.participant.id)
      .maybeSingle();
    if (error) throw error;
    if (data?.submission_type !== "scan") throwIdempotencyConflict();
  }

  return {
    verified: true,
    completed: event.eventType === "ANSWER_ACCEPTED",
    requiresAnswer: event.eventType === "STATION_SCANNED",
    stationSlug,
    playUrl: `/play/${token}`,
    replayed: true
  };
};

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
  const previous = await replayStationScan({
    state,
    stationSlug,
    idempotencyKey,
    token
  });
  if (previous) return previous;

  if (state.run.status !== "active") throw new Error("Game is not active");
  if (!state.checkpoint) throw new Error("No active checkpoint");
  if (state.checkpoint.slug !== stationSlug) throw new Error("Checkpoint is locked");

  if (state.checkpoint.kind === "scan") {
    const completion = await verifyStationScan({
      token,
      stationSlug,
      idempotencyKey
    });
    if (isIdempotencyReplay(completion.result)) {
      const replay = await replayStationScan({
        state,
        stationSlug,
        idempotencyKey,
        token
      });
      if (!replay) throwIdempotencyConflict();
      return replay;
    }
    return {
      verified: true,
      completed: true,
      stationSlug,
      playUrl: `/play/${token}`,
      completion,
      replayed: false
    };
  }

  if (state.checkpoint.kind !== "hybrid") {
    throw new Error("This checkpoint does not accept a station scan");
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("game_events").insert({
    run_id: state.run.id,
    team_id: state.team.id,
    participant_id: state.participant.id,
    event_type: "STATION_SCANNED",
    idempotency_key: idempotencyKey,
    payload: { checkpoint_slug: stationSlug, verified: true }
  });
  const inserted = !error;
  if (error && error.code !== "23505") throw error;

  const recorded = await replayStationScan({
    state,
    stationSlug,
    idempotencyKey,
    token
  });
  if (!recorded || recorded.completed) {
    throwIdempotencyConflict();
  }

  if (inserted) {
    const { error: teamError } = await supabase
      .from("teams")
      .update({ status: "solving", last_progress_at: new Date().toISOString() })
      .eq("id", state.team.id);
    if (teamError) throw teamError;
  }

  return {
    verified: true,
    completed: false,
    requiresAnswer: true,
    stationSlug,
    playUrl: `/play/${token}`,
    replayed: !inserted
  };
};
