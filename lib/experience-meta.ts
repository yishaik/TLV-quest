import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getParticipantState } from "@/lib/repository";
import { toPublicCheckpoint } from "@/lib/public-checkpoint";

const ACTIVITY_EVENT_TYPES = [
  "PLAYER_JOINED",
  "PLAYER_CONFIRMED_WHATSAPP",
  "RUN_STARTED",
  "HINT_REQUESTED",
  "LOCATION_VERIFIED",
  "STATION_SCANNED",
  "ANSWER_ACCEPTED",
  "ANSWER_REJECTED",
  "ORGANIZER_CHECKPOINT_SKIPPED",
  "OPTIONAL_CHECKPOINT_SKIPPED",
  "PHOTO_APPROVED",
  "PHOTO_REJECTED"
];

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const textValue = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

const checkpointSlugFromPayload = (value: unknown) => {
  const payload = objectValue(value);
  const candidate = payload.checkpoint_slug ?? payload.checkpointSlug;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
};

export async function getParticipantExperienceState(token: string) {
  const state = await getParticipantState(token);
  const supabase = createAdminClient();
  const [
    checkpointCount,
    teamRealtime,
    runRealtime,
    activityResult,
    presenceResult,
    bannersResult
  ] = await Promise.all([
    supabase
      .from("run_checkpoints")
      .select("id", { count: "exact", head: true })
      .eq("run_id", state.run.id)
      .eq("is_disabled", false),
    supabase
      .from("teams")
      .select("realtime_topic")
      .eq("id", state.team.id)
      .single(),
    supabase
      .from("game_runs")
      .select("realtime_topic")
      .eq("id", state.run.id)
      .single(),
    supabase
      .from("game_events")
      .select("id,event_type,participant_id,payload,created_at")
      .eq("team_id", state.team.id)
      .in("event_type", ACTIVITY_EVENT_TYPES)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("quest_presence")
      .select("participant_id,device_id,visible,online_at,expires_at")
      .eq("team_id", state.team.id)
      .gt("expires_at", new Date().toISOString()),
    supabase
      .from("in_app_banners")
      .select("id,team_id,body,active_until,created_at")
      .eq("run_id", state.run.id)
      .is("revoked_at", null)
      .gt("active_until", new Date().toISOString())
      .or(`team_id.is.null,team_id.eq.${state.team.id}`)
      .order("created_at", { ascending: false })
      .limit(5)
  ]);
  if (checkpointCount.error) throw checkpointCount.error;
  if (teamRealtime.error || !teamRealtime.data?.realtime_topic) {
    throw teamRealtime.error ?? new Error("Team realtime topic is unavailable");
  }
  if (runRealtime.error || !runRealtime.data?.realtime_topic) {
    throw runRealtime.error ?? new Error("Run realtime topic is unavailable");
  }
  if (activityResult.error) throw activityResult.error;
  if (presenceResult.error) throw presenceResult.error;
  if (bannersResult.error) throw bannersResult.error;

  const memberNames = new Map(
    state.members.map((member) => [member.id, member.firstName])
  );
  const activity = (activityResult.data ?? []).map((event) => ({
    id: String(event.id),
    eventType: event.event_type,
    actorId: event.participant_id,
    actorName: event.participant_id
      ? memberNames.get(event.participant_id) ?? null
      : null,
    checkpointSlug: checkpointSlugFromPayload(event.payload),
    createdAt: event.created_at
  }));
  const presence = (presenceResult.data ?? []).map((device) => ({
    participantId: device.participant_id,
    deviceId: device.device_id,
    visible: device.visible,
    onlineAt: device.online_at,
    expiresAt: device.expires_at
  }));
  const banners = (bannersResult.data ?? []).map((banner) => {
    const body = objectValue(banner.body);
    return {
      id: banner.id,
      teamId: banner.team_id,
      body: textValue(
        body[state.participant.language],
        textValue(body.he, textValue(body.en))
      ),
      activeUntil: banner.active_until,
      createdAt: banner.created_at
    };
  });

  let checkpoint = state.checkpoint
    ? toPublicCheckpoint(state.checkpoint, {
        locale: state.participant.language,
        isOptional: false,
        scanVerified: false,
        photoFallbackAvailable: false
      })
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

    checkpoint = toPublicCheckpoint(currentCheckpoint, {
      locale: state.participant.language,
      isOptional: checkpointMeta.is_optional === true,
      scanVerified,
      photoFallbackAvailable
    });
  }

  return {
    ...state,
    activity,
    presence,
    banners,
    checkpoint,
    run: {
      ...state.run,
      totalCheckpoints: checkpointCount.count ?? 0
    },
    realtime: {
      teamTopic: `team:${teamRealtime.data.realtime_topic}`,
      runTopic: `run:${runRealtime.data.realtime_topic}`
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

  const [{ data: entries, error: entriesError }, { count, error: countError }] =
    await Promise.all([
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
