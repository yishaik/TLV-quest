import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getParticipantState } from "@/lib/repository";

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export async function getParticipantExperienceState(token: string) {
  const state = await getParticipantState(token);
  const supabase = createAdminClient();
  const { count, error } = await supabase
    .from("run_checkpoints")
    .select("id", { count: "exact", head: true })
    .eq("run_id", state.run.id)
    .eq("is_disabled", false);
  if (error) throw error;

  let checkpoint = state.checkpoint
    ? {
        ...state.checkpoint,
        isOptional: false,
        scanVerified: false,
        photoFallbackAvailable: false
      }
    : null;

  if (state.checkpoint) {
    const currentCheckpoint = state.checkpoint;
    const { data: checkpointMeta, error: checkpointMetaError } = await supabase
      .from("run_checkpoints")
      .select("is_optional")
      .eq("id", currentCheckpoint.id)
      .single();
    if (checkpointMetaError) throw checkpointMetaError;

    let scanVerified = false;
    if (currentCheckpoint.kind === "hybrid") {
      const { data: scanEvent, error: scanError } = await supabase
        .from("game_events")
        .select("id")
        .eq("team_id", state.team.id)
        .eq("event_type", "STATION_SCANNED")
        .contains("payload", { checkpoint_slug: currentCheckpoint.slug })
        .limit(1)
        .maybeSingle();
      if (scanError) throw scanError;
      scanVerified = Boolean(scanEvent);
    }

    let photoFallbackAvailable = false;
    if (currentCheckpoint.kind === "photo") {
      const { data: assets, error: assetsError } = await supabase
        .from("media_assets")
        .select("validation")
        .eq("team_id", state.team.id)
        .eq("checkpoint_id", currentCheckpoint.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (assetsError) throw assetsError;

      const threshold =
        typeof currentCheckpoint.validation.confidenceThreshold === "number"
          ? currentCheckpoint.validation.confidenceThreshold
          : 0.86;
      photoFallbackAvailable = (assets ?? []).some((asset) => {
        const validation = objectValue(asset.validation);
        const approved = validation.approved === true;
        const confidence =
          typeof validation.confidence === "number" ? validation.confidence : 0;
        return !approved || confidence < threshold;
      });
    }

    checkpoint = {
      ...currentCheckpoint,
      isOptional: checkpointMeta.is_optional === true,
      scanVerified,
      photoFallbackAvailable
    };
  }

  return {
    ...state,
    checkpoint,
    run: {
      ...state.run,
      totalCheckpoints: count ?? 0
    }
  };
}

export async function getLeaderboardExperience(publicCode: string) {
  const supabase = createAdminClient();
  const normalizedCode = publicCode.trim().toUpperCase();
  const { data: run, error: runError } = await supabase
    .from("game_runs")
    .select("id,public_code,status,started_at,finished_at")
    .eq("public_code", normalizedCode)
    .single();
  if (runError || !run) throw new Error("Game was not found");

  const [{ data: entries, error: entriesError }, { count, error: countError }] = await Promise.all([
    supabase
      .from("leaderboard_entries")
      .select("team_name,score,completed_count,status,last_progress_at,updated_at")
      .eq("run_public_code", normalizedCode)
      .order("score", { ascending: false })
      .order("completed_count", { ascending: false }),
    supabase
      .from("run_checkpoints")
      .select("id", { count: "exact", head: true })
      .eq("run_id", run.id)
      .eq("is_disabled", false)
  ]);
  if (entriesError) throw entriesError;
  if (countError) throw countError;

  return {
    run: {
      publicCode: run.public_code,
      status: run.status,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      totalCheckpoints: count ?? 0
    },
    entries: entries ?? []
  };
}
