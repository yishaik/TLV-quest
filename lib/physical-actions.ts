import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  findParticipantIdempotencyEvent,
  idempotencyObject,
  throwIdempotencyConflict
} from "@/lib/idempotency";
import { getParticipantState } from "@/lib/repository";
import { publicFallbackSummary } from "@/lib/public-checkpoint";
import {
  calculateScoreDelta,
  distanceMeters,
  type ScoringConfig
} from "@/lib/game-engine";
import { validatePhotoWithGemini } from "@/lib/providers";
import {
  isPhotoUploadMimeType,
  PHOTO_UPLOAD_MAX_BYTES
} from "@/lib/photo-upload-shared";

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

type PhotoAssessment = {
  approved: boolean;
  confidence: number;
  reason: string;
};

const asPhotoAssessment = (value: unknown): PhotoAssessment | null => {
  const assessment = asObject(value);
  if (
    typeof assessment.approved !== "boolean" ||
    typeof assessment.confidence !== "number" ||
    typeof assessment.reason !== "string"
  ) {
    return null;
  }
  return {
    approved: assessment.approved,
    confidence: Math.max(0, Math.min(1, assessment.confidence)),
    reason: assessment.reason
  };
};

const completeCheckpoint = async ({
  token,
  participantState,
  submissionType,
  idempotencyKey,
  payload,
  validationReason,
  scoreMultiplier = 1
}: {
  token: string;
  participantState?: Awaited<ReturnType<typeof getParticipantState>>;
  submissionType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  validationReason: string;
  scoreMultiplier?: number;
}) => {
  const state = participantState ?? (await getParticipantState(token));
  if (state.run.status !== "active") throw new Error("Game is not active");
  if (!state.checkpoint) throw new Error("No active checkpoint");

  const supabase = createAdminClient();
  const { data: nextCheckpoint, error: nextError } = await supabase
    .from("run_checkpoints")
    .select("slug,sequence_no")
    .eq("run_id", state.run.id)
    .eq("is_disabled", false)
    .gt("sequence_no", state.checkpoint.sequenceNo)
    .order("sequence_no")
    .limit(1)
    .maybeSingle();
  if (nextError) throw nextError;

  const reference =
    state.team.lastProgressAt ?? state.team.startedAt ?? new Date().toISOString();
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(reference).getTime()) / 1000)
  );
  const scoreDelta = Math.round(
    calculateScoreDelta({
      correct: true,
      wrongAttempts: state.team.wrongAttempts,
      hintsUsed: state.team.hintsUsed,
      elapsedSeconds,
      scoring: state.checkpoint.scoring as ScoringConfig
    }) * scoreMultiplier
  );

  const isFinal = state.checkpoint.kind === "finale" || !nextCheckpoint;
  const { data: result, error } = await supabase.rpc("apply_submission", {
    p_team_id: state.team.id,
    p_participant_id: state.participant.id,
    p_checkpoint_id: state.checkpoint.id,
    p_submission_type: submissionType,
    p_normalized_answer: validationReason,
    p_payload: payload,
    p_is_correct: true,
    p_score_delta: scoreDelta,
    p_validation_reason: validationReason,
    p_idempotency_key: idempotencyKey,
    p_next_checkpoint_slug: nextCheckpoint?.slug ?? null,
    p_is_final: isFinal
  });
  if (error) throw error;

  return { state, scoreDelta, result };
};

export const verifyStationScan = async ({
  token,
  stationSlug,
  idempotencyKey
}: {
  token: string;
  stationSlug: string;
  idempotencyKey: string;
}) => {
  const state = await getParticipantState(token);
  if (!state.checkpoint) throw new Error("No active checkpoint");
  if (state.checkpoint.slug !== stationSlug) throw new Error("Checkpoint is locked");
  if (state.checkpoint.kind !== "scan") {
    throw new Error("This checkpoint is not completed by scanning alone");
  }

  return completeCheckpoint({
    token,
    participantState: state,
    submissionType: "scan",
    idempotencyKey,
    payload: { stationSlug },
    validationReason: "station_scan"
  });
};

export const verifyLocation = async ({
  token,
  latitude,
  longitude,
  idempotencyKey
}: {
  token: string;
  latitude: number;
  longitude: number;
  idempotencyKey: string;
}) => {
  const state = await getParticipantState(token);
  const previous = await findParticipantIdempotencyEvent({
    idempotencyKey,
    teamId: state.team.id,
    participantId: state.participant.id,
    eventTypes: ["LOCATION_VERIFIED"]
  });
  if (previous) {
    const payload = idempotencyObject(previous.payload);
    return {
      verified: true,
      distanceMeters:
        typeof payload.distance_meters === "number"
          ? payload.distance_meters
          : typeof payload.distance_bucket_meters === "number"
            ? payload.distance_bucket_meters
            : 0,
      allowedRadiusMeters:
        state.checkpoint?.radiusMeters ?? 0,
      replayed: true
    };
  }

  if (state.run.status !== "active" || !state.checkpoint) {
    throw new Error("No active checkpoint");
  }
  if (
    state.checkpoint.latitude === null ||
    state.checkpoint.longitude === null ||
    state.checkpoint.radiusMeters === null
  ) {
    throw new Error("This checkpoint has no location requirement");
  }

  const distance = distanceMeters(
    { latitude, longitude },
    {
      latitude: state.checkpoint.latitude,
      longitude: state.checkpoint.longitude
    }
  );
  if (distance > state.checkpoint.radiusMeters) {
    return {
      verified: false,
      distanceMeters: Math.round(distance),
      allowedRadiusMeters: state.checkpoint.radiusMeters
    };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("game_events").insert({
    run_id: state.run.id,
    team_id: state.team.id,
    participant_id: state.participant.id,
    event_type: "LOCATION_VERIFIED",
    idempotency_key: idempotencyKey,
    payload: {
      checkpoint_slug: state.checkpoint.slug,
      verified: true,
      distance_bucket_meters: Math.ceil(distance / 10) * 10
    }
  });
  const inserted = !error;
  if (error && error.code !== "23505") throw error;

  const recorded = await findParticipantIdempotencyEvent({
    idempotencyKey,
    teamId: state.team.id,
    participantId: state.participant.id,
    eventTypes: ["LOCATION_VERIFIED"]
  });
  if (!recorded) throwIdempotencyConflict();
  const recordedEvent = recorded!;

  if (inserted) {
    const { error: teamError } = await supabase
      .from("teams")
      .update({ status: "solving", last_progress_at: new Date().toISOString() })
      .eq("id", state.team.id);
    if (teamError) throw teamError;
  }

  const recordedDistance =
    inserted
      ? Math.round(distance)
      : typeof recordedEvent.payload.distance_bucket_meters === "number"
        ? recordedEvent.payload.distance_bucket_meters
        : Math.round(distance);

  return {
    verified: true,
    distanceMeters: recordedDistance,
    allowedRadiusMeters: state.checkpoint.radiusMeters,
    replayed: !inserted
  };
};

export const submitStoredPhoto = async ({
  token,
  bytes,
  mimeType,
  storagePath,
  checkpointId,
  idempotencyKey
}: {
  token: string;
  bytes: Uint8Array;
  mimeType: string;
  storagePath: string;
  checkpointId: string;
  idempotencyKey: string;
}) => {
  const state = await getParticipantState(token);
  const supabase = createAdminClient();
  const [
    { data: existingEvent, error: eventError },
    { data: existingMedia, error: mediaLookupError }
  ] = await Promise.all([
    supabase
      .from("game_events")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .eq("event_type", "ANSWER_ACCEPTED")
      .eq("run_id", state.run.id)
      .eq("team_id", state.team.id)
      .eq("participant_id", state.participant.id)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("media_assets")
      .select("id,validation")
      .eq("storage_path", storagePath)
      .eq("participant_id", state.participant.id)
      .eq("team_id", state.team.id)
      .eq("checkpoint_id", checkpointId)
      .limit(1)
      .maybeSingle()
  ]);
  if (eventError) throw eventError;
  if (mediaLookupError) throw mediaLookupError;

  const recoveredAssessment = asPhotoAssessment(existingMedia?.validation);
  if (existingEvent) {
    if (!recoveredAssessment) throw new Error("photo_upload_recovery_failed");
    return {
      approved: true,
      confidence: recoveredAssessment.confidence,
      reason: recoveredAssessment.reason,
      recovered: true
    };
  }

  if (state.run.status !== "active" || !state.checkpoint) {
    throw new Error("photo_checkpoint_changed");
  }
  if (
    state.checkpoint.id !== checkpointId ||
    state.checkpoint.kind !== "photo"
  ) {
    throw new Error("photo_checkpoint_changed");
  }
  if (!isPhotoUploadMimeType(mimeType)) {
    throw new Error("photo_upload_unsupported_format");
  }
  if (
    bytes.byteLength <= 0 ||
    bytes.byteLength > PHOTO_UPLOAD_MAX_BYTES
  ) {
    throw new Error("photo_upload_too_large");
  }

  const validation = asObject(state.checkpoint.validation);
  const criteria =
    typeof validation.criteria === "string"
      ? validation.criteria
      : "The image clearly satisfies the checkpoint task.";
  const threshold =
    typeof validation.confidenceThreshold === "number"
      ? validation.confidenceThreshold
      : 0.86;

  let assessment = recoveredAssessment;
  let mediaId = existingMedia?.id ?? null;
  if (!assessment) {
    assessment = await validatePhotoWithGemini({
      base64: Buffer.from(bytes).toString("base64"),
      mimeType,
      criteria
    });

    if (mediaId) {
      const { error: mediaUpdateError } = await supabase
        .from("media_assets")
        .update({ validation: assessment, mime_type: mimeType })
        .eq("id", mediaId);
      if (mediaUpdateError) throw mediaUpdateError;
    } else {
      const { data: media, error: mediaError } = await supabase
        .from("media_assets")
        .insert({
          run_id: state.run.id,
          team_id: state.team.id,
          participant_id: state.participant.id,
          checkpoint_id: state.checkpoint.id,
          storage_path: storagePath,
          mime_type: mimeType,
          source: "web",
          validation: assessment
        })
        .select("id")
        .single();
      if (mediaError || !media) {
        throw mediaError ?? new Error("Failed to save photo");
      }
      mediaId = media.id;
    }
  }
  if (!mediaId) throw new Error("Failed to save photo");

  if (!assessment.approved || assessment.confidence < threshold) {
    const fallback = publicFallbackSummary(
      state.checkpoint.fallback,
      state.participant.language
    );
    return {
      approved: false,
      confidence: assessment.confidence,
      reason: assessment.reason,
      hasFallback: fallback.hasFallback,
      fallbackPrompt: fallback.hasFallback ? fallback.fallbackPrompt : null
    };
  }

  const completion = await completeCheckpoint({
    token,
    participantState: state,
    submissionType: "photo",
    idempotencyKey,
    payload: {
      mediaAssetId: mediaId,
      confidence: assessment.confidence
    },
    validationReason: "gemini_photo_approved"
  });

  return {
    approved: true,
    confidence: assessment.confidence,
    reason: assessment.reason,
    completion: completion.result
  };
};
