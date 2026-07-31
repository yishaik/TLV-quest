import "server-only";

import { createHash } from "node:crypto";
import {
  buildQuestReplay,
  replayStats,
  type ReplayEvent
} from "@/lib/quest-replay";
import { createAdminClient } from "@/lib/supabase/admin";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const textValue = (value: unknown) =>
  typeof value === "string" ? value : null;

const numberValue = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const safeEventPayload = (payloadValue: unknown) => {
  const payload = objectValue(payloadValue);
  const afterValue = objectValue(payload.after);
  const after = {
    ...(typeof afterValue.status === "string"
      ? { status: afterValue.status }
      : {}),
    ...(typeof afterValue.score === "number" ? { score: afterValue.score } : {}),
    ...(typeof afterValue.completedCount === "number"
      ? { completedCount: afterValue.completedCount }
      : {}),
    ...(typeof afterValue.checkpoint === "string"
      ? { checkpoint: afterValue.checkpoint }
      : {})
  };
  return {
    ...(typeof payload.action === "string" ? { action: payload.action } : {}),
    ...(Object.keys(after).length ? { after } : {})
  };
};

export const getRecapByToken = async (token: string) => {
  const supabase = createAdminClient();
  const { data: share, error: shareError } = await supabase
    .from("recap_shares")
    .select("id,run_id,team_id,active_until,revoked_at")
    .eq("token_hash", sha256(token))
    .single();
  if (
    shareError ||
    !share ||
    share.revoked_at ||
    new Date(share.active_until).getTime() <= Date.now()
  ) {
    throw new Error("Recap link is invalid or expired");
  }

  const [
    runResult,
    teamsResult,
    participantsResult,
    checkpointsResult,
    eventsResult,
    mediaResult
  ] = await Promise.all([
    supabase
      .from("game_runs")
      .select("id,public_code,status,started_at,finished_at")
      .eq("id", share.run_id)
      .single(),
    supabase
      .from("teams")
      .select(
        "id,public_name,status,score,completed_count,started_at,finished_at"
      )
      .eq("run_id", share.run_id)
      .order("score", { ascending: false }),
    supabase
      .from("participants")
      .select("id,team_id,public_alias")
      .eq("run_id", share.run_id),
    supabase
      .from("run_checkpoints")
      .select("id,slug,sequence_no,content")
      .eq("run_id", share.run_id)
      .order("sequence_no"),
    supabase
      .from("game_events")
      .select("id,event_type,team_id,participant_id,payload,created_at")
      .eq("run_id", share.run_id)
      .order("created_at")
      .order("id")
      .limit(2000),
    supabase
      .from("media_assets")
      .select(
        "id,team_id,participant_id,checkpoint_id,storage_path,mime_type,validation,created_at"
      )
      .eq("run_id", share.run_id)
      .order("created_at")
      .limit(200)
  ]);
  for (const result of [
    runResult,
    teamsResult,
    participantsResult,
    checkpointsResult,
    eventsResult,
    mediaResult
  ]) {
    if (result.error) throw result.error;
  }
  if (!runResult.data) throw new Error("Recap run was not found");

  const teams = (teamsResult.data ?? []).filter(
    (team) => !share.team_id || team.id === share.team_id
  );
  const teamIds = new Set(teams.map((team) => team.id));
  const participants = (participantsResult.data ?? []).filter(
    (participant) => participant.team_id && teamIds.has(participant.team_id)
  );
  const participantNames = new Map(
    participants.map((participant) => [
      participant.id,
      participant.public_alias || "Player"
    ])
  );
  const checkpointSlugs = new Map(
    (checkpointsResult.data ?? []).map((checkpoint) => [
      checkpoint.id,
      checkpoint.slug
    ])
  );
  const events: ReplayEvent[] = (eventsResult.data ?? [])
    .filter((event) => !event.team_id || teamIds.has(event.team_id))
    .map((event) => {
      const payload = objectValue(event.payload);
      return {
        id: String(event.id),
        eventType: event.event_type,
        teamId: event.team_id,
        participantId: event.participant_id,
        actorName: event.participant_id
          ? participantNames.get(event.participant_id) ?? null
          : null,
        checkpointSlug:
          textValue(payload.checkpoint_slug) ??
          textValue(payload.checkpointSlug),
        scoreDelta: numberValue(payload.score_delta),
        penalty: numberValue(payload.penalty),
        createdAt: event.created_at,
        payload: safeEventPayload(payload)
      };
    });
  const replay = buildQuestReplay({
    teams: teams.map((team) => ({ id: team.id, name: team.public_name })),
    events
  });

  const photos = await Promise.all(
    (mediaResult.data ?? [])
      .filter((media) => media.team_id && teamIds.has(media.team_id))
      .map(async (media) => {
        const { data, error } = await supabase.storage
          .from("game-media")
          .createSignedUrl(media.storage_path, 60 * 60);
        if (error || !data?.signedUrl) return null;
        const validation = objectValue(media.validation);
        return {
          id: media.id,
          teamId: media.team_id,
          actorName: media.participant_id
            ? participantNames.get(media.participant_id) ?? null
            : null,
          checkpointSlug: media.checkpoint_id
            ? checkpointSlugs.get(media.checkpoint_id) ?? null
            : null,
          mimeType: media.mime_type,
          approved: validation.approved === true,
          createdAt: media.created_at,
          url: data.signedUrl
        };
      })
  );
  const finalPhotos = photos.filter(
    (photo): photo is NonNullable<typeof photo> => Boolean(photo)
  );
  const baseStats = replayStats(events);
  const totalDurationSeconds =
    runResult.data.started_at && runResult.data.finished_at
      ? Math.max(
          0,
          Math.round(
            (new Date(runResult.data.finished_at).getTime() -
              new Date(runResult.data.started_at).getTime()) /
              1000
          )
        )
      : baseStats.durationSeconds;

  return {
    share: {
      id: share.id,
      activeUntil: share.active_until,
      scope: share.team_id ? "team" : "run"
    },
    run: {
      publicCode: runResult.data.public_code,
      status: runResult.data.status,
      startedAt: runResult.data.started_at,
      finishedAt: runResult.data.finished_at
    },
    teams: teams.map((team) => ({
      id: team.id,
      name: team.public_name,
      status: team.status,
      score: team.score,
      completedCount: team.completed_count,
      startedAt: team.started_at,
      finishedAt: team.finished_at
    })),
    checkpoints: (checkpointsResult.data ?? []).map((checkpoint) => {
      const content = objectValue(checkpoint.content);
      const localized = objectValue(content.he);
      return {
        slug: checkpoint.slug,
        sequenceNo: checkpoint.sequence_no,
        title:
          textValue(localized.title) ??
          textValue(objectValue(content.en).title) ??
          checkpoint.slug
      };
    }),
    events,
    photos: finalPhotos,
    stats: {
      ...baseStats,
      durationSeconds: totalDurationSeconds,
      teamCount: teams.length,
      participantCount: participants.length,
      photoCount: finalPhotos.length,
      finalScore: teams.reduce((total, team) => total + team.score, 0)
    },
    replay: {
      version: 1,
      checksum: sha256(JSON.stringify(replay)),
      frames: replay
    }
  };
};
