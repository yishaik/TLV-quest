import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getParticipantState } from "@/lib/repository";
import {
  calculateScoreDelta,
  distanceMeters,
  type ScoringConfig
} from "@/lib/game-engine";
import { validatePhotoWithGemini } from "@/lib/providers";

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const completeCheckpoint = async ({
  token,
  submissionType,
  idempotencyKey,
  payload,
  validationReason,
  scoreMultiplier = 1
}: {
  token: string;
  submissionType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  validationReason: string;
  scoreMultiplier?: number;
}) => {
  const state = await getParticipantState(token);
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
  const { error } = await supabase.from("game_events").upsert(
    {
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
    distanceMeters: Math.round(distance),
    allowedRadiusMeters: state.checkpoint.radiusMeters
  };
};

export const submitPhoto = async ({
  token,
  bytes,
  mimeType,
  idempotencyKey
}: {
  token: string;
  bytes: Uint8Array;
  mimeType: string;
  idempotencyKey: string;
}) => {
  const state = await getParticipantState(token);
  if (state.run.status !== "active" || !state.checkpoint) {
    throw new Error("No active checkpoint");
  }
  if (state.checkpoint.kind !== "photo") {
    throw new Error("This checkpoint does not accept a photo");
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    throw new Error("Unsupported image format");
  }
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("Image is too large");

  const validation = asObject(state.checkpoint.validation);
  const criteria =
    typeof validation.criteria === "string"
      ? validation.criteria
      : "The image clearly satisfies the checkpoint task.";
  const threshold =
    typeof validation.confidenceThreshold === "number"
      ? validation.confidenceThreshold
      : 0.86;

  const supabase = createAdminClient();
  const extension =
    mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const path = `${state.run.id}/${state.team.id}/${state.checkpoint.slug}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("game-media")
    .upload(path, bytes, { contentType: mimeType, upsert: false });
  if (uploadError) throw uploadError;

  const assessment = await validatePhotoWithGemini({
    base64: Buffer.from(bytes).toString("base64"),
    mimeType,
    criteria
  });

  const { data: media, error: mediaError } = await supabase
    .from("media_assets")
    .insert({
      run_id: state.run.id,
      team_id: state.team.id,
      participant_id: state.participant.id,
      checkpoint_id: state.checkpoint.id,
      storage_path: path,
      mime_type: mimeType,
      source: "web",
      validation: assessment
    })
    .select("id")
    .single();
  if (mediaError || !media) throw mediaError ?? new Error("Failed to save photo");

  if (!assessment.approved || assessment.confidence < threshold) {
    return {
      approved: false,
      confidence: assessment.confidence,
      reason: assessment.reason,
      fallback: state.checkpoint.fallback
    };
  }

  const completion = await completeCheckpoint({
    token,
    submissionType: "photo",
    idempotencyKey,
    payload: {
      mediaAssetId: media.id,
      confidence: assessment.confidence
    },
    validationReason: "gemini_photo_approved"
  });

  return {
    approved: true,
    confidence: assessment.confidence,
    reason: assessment.reason,
    completion
  };
};
