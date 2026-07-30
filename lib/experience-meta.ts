import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { getParticipantState } from "@/lib/repository";
import { evaluateDifficulty } from "@/lib/difficulty";

const ACTIVITY_EVENT_TYPES = [
  "PLAYER_JOINED",
  "PLAYER_CONFIRMED_WHATSAPP",
  "RUN_STARTED",
  "HINT_REQUESTED",
  "LOCATION_VERIFIED",
  "STATION_SCANNED",
  "ANSWER_ACCEPTED",
  "ANSWER_REJECTED",
  "OPTIONAL_CHECKPOINT_SKIPPED",
  "PHOTO_APPROVED",
  "PHOTO_REJECTED"
];

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const checkpointSlugFromPayload = (value: unknown) => {
  const payload = objectValue(value);
  const candidate = payload.checkpoint_slug ?? payload.checkpointSlug;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
};

const safeColor = (value: unknown, fallback: string) =>
  typeof value === "string" &&
  (/^#[0-9a-f]{3,8}$/i.test(value) ||
    /^hsl\(\s*\d{1,3}(?:\.\d+)?(?:deg)?\s+\d{1,3}%\s+\d{1,3}%\s*\)$/i.test(
      value
    ))
    ? value
    : fallback;

const safeAssetUrl = (value: unknown, fallback: string) =>
  typeof value === "string" &&
  (value.startsWith("/") || /^https:\/\/[^'"<>\s]+$/i.test(value))
    ? value
    : fallback;

const participantCheckpoint = ({
  checkpoint,
  language,
  isOptional,
  scanVerified,
  photoFallbackAvailable
}: {
  checkpoint: NonNullable<Awaited<ReturnType<typeof getParticipantState>>["checkpoint"]>;
  language: "he" | "en";
  isOptional: boolean;
  scanVerified: boolean;
  photoFallbackAvailable: boolean;
}) => {
  const choiceOptions =
    checkpoint.validation.type === "choice" &&
    Array.isArray(checkpoint.validation.options)
      ? checkpoint.validation.options.filter(
          (option): option is string =>
            typeof option === "string" && Boolean(option.trim())
        )
      : [];
  const fallback = checkpoint.fallback;
  const fallbackPrompt =
    fallback && typeof fallback[language] === "string"
      ? fallback[language].trim() || null
      : null;
  const hasFallback = Boolean(
    fallbackPrompt &&
      fallback &&
      Array.isArray(fallback.accepted) &&
      fallback.accepted.some(
        (answer) => typeof answer === "string" && Boolean(answer.trim())
      )
  );

  return {
    id: checkpoint.id,
    slug: checkpoint.slug,
    sequenceNo: checkpoint.sequenceNo,
    kind: checkpoint.kind,
    content: checkpoint.content,
    choiceOptions,
    fallbackPrompt,
    hasFallback,
    latitude: checkpoint.latitude,
    longitude: checkpoint.longitude,
    radiusMeters: checkpoint.radiusMeters,
    isOptional,
    scanVerified,
    photoFallbackAvailable
  };
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
    bannersResult,
    tenantResult,
    versionResult
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
      .limit(5),
    supabase
      .from("organizer_tenants")
      .select("name,branding")
      .eq("id", state.run.tenantId)
      .single(),
    supabase
      .from("template_versions")
      .select("theme,route_config")
      .eq("template_id", state.run.templateId)
      .eq("version", state.run.templateVersion)
      .single()
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
  if (tenantResult.error) throw tenantResult.error;
  if (versionResult.error) throw versionResult.error;

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
    const localizedBody =
      typeof body[state.participant.language] === "string"
        ? String(body[state.participant.language])
        : typeof body.he === "string"
          ? body.he
          : typeof body.en === "string"
            ? body.en
            : "";
    return {
      id: banner.id,
      body: localizedBody,
      activeUntil: banner.active_until,
      createdAt: banner.created_at
    };
  }).filter((banner) => Boolean(banner.body));

  let checkpoint = state.checkpoint
    ? participantCheckpoint({
        checkpoint: state.checkpoint,
        language: state.participant.language,
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

    checkpoint = participantCheckpoint({
      checkpoint: currentCheckpoint,
      language: state.participant.language,
      isOptional: checkpointMeta.is_optional === true,
      scanVerified,
      photoFallbackAvailable
    });
  }

  const hintIndex = state.team.hintsUsed;
  const nextHint = state.checkpoint
    ? objectValue(state.checkpoint.hints[hintIndex])
    : {};
  const hasNextHint = Object.keys(nextHint).length > 0;
  const hintReference =
    state.team.lastProgressAt ?? state.team.startedAt ?? new Date().toISOString();
  const minutesSinceProgress = Math.max(
    0,
    Math.floor((Date.now() - new Date(hintReference).getTime()) / 60_000)
  );
  const adaptiveSettings = objectValue(state.run.settings.adaptiveDifficulty);
  const difficulty = evaluateDifficulty({
    enabled: adaptiveSettings.enabled !== false,
    wrongAttempts: state.team.wrongAttempts,
    hintsUsed: state.team.hintsUsed,
    completedCount: state.team.completedCount,
    minutesSinceProgress
  });
  const adaptiveHintUnlockAt = new Date(
    new Date(hintReference).getTime() +
      difficulty.inactivityMinutesToUnlock * 60_000
  );
  const adaptiveSecondsUntilHint = Math.max(
    0,
    Math.ceil((adaptiveHintUnlockAt.getTime() - Date.now()) / 1000)
  );
  const adaptiveWrongAttemptsToUnlock = Math.max(
    0,
    difficulty.wrongAttemptsToUnlock - state.team.wrongAttempts
  );
  const hintOffer = hasNextHint
    ? {
        available:
          state.team.wrongAttempts >= difficulty.wrongAttemptsToUnlock ||
          adaptiveSecondsUntilHint === 0,
        reason:
          state.team.wrongAttempts >= difficulty.wrongAttemptsToUnlock
            ? "wrong_attempts"
            : adaptiveSecondsUntilHint === 0
              ? "inactivity"
              : "locked",
        penalty:
          typeof nextHint.penalty === "number"
            ? Math.max(0, Math.round(nextHint.penalty))
            : 10,
        index: hintIndex + 1,
        total: state.checkpoint?.hints.length ?? 0,
        wrongAttemptsToUnlock: adaptiveWrongAttemptsToUnlock,
        unlockAt: adaptiveHintUnlockAt.toISOString(),
        secondsUntilUnlock: adaptiveSecondsUntilHint
      }
    : null;

  const tenantBranding = objectValue(tenantResult.data.branding);
  const versionTheme = objectValue(versionResult.data.theme);
  const productName =
    typeof tenantBranding.productName === "string" &&
    tenantBranding.productName.trim().length <= 80
      ? tenantBranding.productName.trim()
      : tenantResult.data.name;
  const branding = {
    productName,
    primaryColor: safeColor(
      versionTheme.primaryColor ?? tenantBranding.primaryColor,
      "#f6c35b"
    ),
    surfaceColor: safeColor(
      versionTheme.surfaceColor ?? tenantBranding.surfaceColor,
      "#08131f"
    ),
    logoUrl: safeAssetUrl(
      versionTheme.logoUrl ?? tenantBranding.logoUrl,
      "/visuals/quest-mark.svg"
    )
  };

  return {
    participant: {
      id: state.participant.id,
      firstName: state.participant.firstName,
      language: state.participant.language,
      whatsappConnected: state.participant.whatsappConnected,
      recoveryUrl: `${publicEnv.appUrl}/resume?run=${encodeURIComponent(
        state.run.publicCode
      )}`
    },
    run: {
      id: state.run.id,
      publicCode: state.run.publicCode,
      status: state.run.status,
      scheduledAt: state.run.scheduledAt,
      totalCheckpoints: checkpointCount.count ?? 0
    },
    team: {
      id: state.team.id,
      name: state.team.name,
      status: state.team.status,
      score: state.team.score,
      completedCount: state.team.completedCount
    },
    members: state.members,
    activity,
    presence,
    banners,
    branding,
    difficulty,
    hintOffer,
    checkpoint,
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
