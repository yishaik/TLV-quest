import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getParticipantState } from "@/lib/repository";

export async function getParticipantExperienceState(token: string) {
  const state = await getParticipantState(token);
  const supabase = createAdminClient();
  const { count, error } = await supabase
    .from("run_checkpoints")
    .select("id", { count: "exact", head: true })
    .eq("run_id", state.run.id)
    .eq("is_disabled", false);
  if (error) throw error;

  return {
    ...state,
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
