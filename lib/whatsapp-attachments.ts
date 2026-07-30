import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { findParticipantTokenlessByPhone } from "@/lib/repository";
import { getServerEnv } from "@/lib/env";
import {
  calculateScoreDelta,
  distanceMeters,
  type Locale,
  type ScoringConfig
} from "@/lib/game-engine";
import { validatePhotoWithGemini } from "@/lib/providers";
import {
  SUPPORTED_TWILIO_MEDIA_TYPES,
  TwilioMediaError,
  validatedTwilioMediaUrl
} from "@/lib/twilio-media-security";

type JsonRecord = Record<string, unknown>;

const TWILIO_MEDIA_MAX_BYTES = 10 * 1024 * 1024;
const TWILIO_MEDIA_TIMEOUT_MS = 10_000;

const asObject = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const downloadTwilioMedia = async ({
  mediaUrl,
  declaredContentType,
  accountSid,
  authToken
}: {
  mediaUrl: string;
  declaredContentType: string;
  accountSid: string;
  authToken: string;
}) => {
  const trustedUrl = validatedTwilioMediaUrl(mediaUrl, accountSid);
  const authorization = Buffer.from(`${accountSid}:${authToken}`).toString(
    "base64"
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TWILIO_MEDIA_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(trustedUrl, {
      headers: { authorization: `Basic ${authorization}` },
      redirect: "error",
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeout);
    throw new TwilioMediaError(
      error instanceof DOMException && error.name === "AbortError"
        ? "twilio_media_download_timeout"
        : "twilio_media_download_failed"
    );
  }

  try {
    if (!response.ok) {
      throw new TwilioMediaError("twilio_media_download_failed");
    }

    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (
      Number.isFinite(contentLength) &&
      contentLength > TWILIO_MEDIA_MAX_BYTES
    ) {
      throw new TwilioMediaError("twilio_media_too_large");
    }

    const responseContentType =
      response.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() ?? "";
    const declared =
      declaredContentType.split(";")[0]?.trim().toLowerCase() ?? "";
    const mimeType = responseContentType || declared;
    if (!SUPPORTED_TWILIO_MEDIA_TYPES.has(mimeType)) {
      throw new TwilioMediaError("twilio_media_type_rejected");
    }
    if (
      responseContentType &&
      declared &&
      SUPPORTED_TWILIO_MEDIA_TYPES.has(declared) &&
      responseContentType !== declared
    ) {
      throw new TwilioMediaError("twilio_media_type_mismatch");
    }
    if (!response.body) {
      throw new TwilioMediaError("twilio_media_download_failed");
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > TWILIO_MEDIA_MAX_BYTES) {
        await reader.cancel();
        throw new TwilioMediaError("twilio_media_too_large");
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, mimeType };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new TwilioMediaError("twilio_media_download_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const getContextByPhone = async (from: string) => {
  const participantRef = await findParticipantTokenlessByPhone(from);
  if (!participantRef) throw new Error("participant_not_found");

  const supabase = createAdminClient();
  const { data: participant, error: participantError } = await supabase
    .from("participants")
    .select("*")
    .eq("id", participantRef.id)
    .single();
  if (participantError || !participant?.team_id) throw new Error("participant_not_found");

  const [{ data: run }, { data: team }] = await Promise.all([
    supabase.from("game_runs").select("*").eq("id", participant.run_id).single(),
    supabase.from("teams").select("*").eq("id", participant.team_id).single()
  ]);
  if (!run || !team) throw new Error("game_context_not_found");

  const checkpoint = team.current_checkpoint_slug
    ? (
        await supabase
          .from("run_checkpoints")
          .select("*")
          .eq("run_id", run.id)
          .eq("slug", team.current_checkpoint_slug)
          .single()
      ).data
    : null;

  return { supabase, participant, run, team, checkpoint };
};

const queueTeamMessage = async ({
  runId,
  teamId,
  body
}: {
  runId: string;
  teamId: string;
  body: string;
}) => {
  const supabase = createAdminClient();
  const { data: participants, error } = await supabase
    .from("participants")
    .select("id,phone_ciphertext")
    .eq("team_id", teamId)
    .not("phone_ciphertext", "is", null);
  if (error) throw error;
  if (!participants?.length) return;

  const { error: insertError } = await supabase.from("message_outbox").insert(
    participants.map((participant) => ({
      run_id: runId,
      participant_id: participant.id,
      channel: "whatsapp" as const,
      recipient_ciphertext: participant.phone_ciphertext,
      payload: { body }
    }))
  );
  if (insertError) throw insertError;
};

const localizedSuccess = (
  contentValue: unknown,
  locale: Locale,
  fallback: string
): string => {
  const content = asObject(contentValue);
  const localized = asObject(content[locale]);
  return text(localized.success) || fallback;
};

export const handleWhatsappLocation = async ({
  from,
  latitude,
  longitude,
  messageSid
}: {
  from: string;
  latitude: number;
  longitude: number;
  messageSid: string;
}) => {
  const { supabase, participant, run, team, checkpoint } = await getContextByPhone(
    from
  );
  const locale = participant.language === "en" ? "en" : "he";

  if (run.status !== "active" || !checkpoint) {
    return locale === "he"
      ? "המשחק אינו פעיל כרגע."
      : "The game is not active right now.";
  }
  if (
    checkpoint.latitude === null ||
    checkpoint.longitude === null ||
    checkpoint.radius_meters === null
  ) {
    return locale === "he"
      ? "התחנה הנוכחית אינה דורשת מיקום."
      : "The current checkpoint does not require location verification.";
  }

  const distance = distanceMeters(
    { latitude, longitude },
    { latitude: checkpoint.latitude, longitude: checkpoint.longitude }
  );

  if (distance > checkpoint.radius_meters) {
    return locale === "he"
      ? `אתם עדיין רחוקים מדי מהתחנה — בערך ${Math.round(distance)} מטר.`
      : `You are still about ${Math.round(distance)} meters from the checkpoint.`;
  }

  const { error: eventError } = await supabase.from("game_events").upsert(
    {
      run_id: run.id,
      team_id: team.id,
      participant_id: participant.id,
      event_type: "LOCATION_VERIFIED",
      idempotency_key: `wa-location:${messageSid}`,
      payload: {
        checkpoint_slug: checkpoint.slug,
        verified: true,
        distance_bucket_meters: Math.ceil(distance / 10) * 10,
        source: "whatsapp"
      }
    },
    { onConflict: "idempotency_key", ignoreDuplicates: true }
  );
  if (eventError) throw eventError;

  const { error: teamError } = await supabase
    .from("teams")
    .update({ status: "solving", last_progress_at: new Date().toISOString() })
    .eq("id", team.id);
  if (teamError) throw teamError;

  return locale === "he"
    ? `המיקום אומת. אתם בטווח התחנה (${Math.round(distance)} מ׳). עכשיו פתרו את החידה.`
    : `Location verified (${Math.round(distance)}m from the checkpoint). Now solve the clue.`;
};

export const handleWhatsappPhoto = async ({
  from,
  mediaUrl,
  mediaContentType,
  messageSid
}: {
  from: string;
  mediaUrl: string;
  mediaContentType: string;
  messageSid: string;
}) => {
  const { supabase, participant, run, team, checkpoint } = await getContextByPhone(
    from
  );
  const locale = participant.language === "en" ? "en" : "he";

  if (run.status !== "active" || !checkpoint) {
    return locale === "he"
      ? "המשחק אינו פעיל כרגע."
      : "The game is not active right now.";
  }
  if (checkpoint.kind !== "photo") {
    return locale === "he"
      ? "התחנה הנוכחית אינה מקבלת תמונה."
      : "The current checkpoint does not accept a photo.";
  }
  if (!SUPPORTED_TWILIO_MEDIA_TYPES.has(mediaContentType.toLowerCase())) {
    return locale === "he"
      ? "פורמט התמונה אינו נתמך. שלחו JPG, PNG או WebP."
      : "Unsupported image format. Send JPG, PNG or WebP.";
  }

  const env = getServerEnv();
  if (!env.twilioAccountSid || !env.twilioAuthToken) {
    throw new Error("twilio_credentials_missing");
  }
  let download: Awaited<ReturnType<typeof downloadTwilioMedia>>;
  try {
    download = await downloadTwilioMedia({
      mediaUrl,
      declaredContentType: mediaContentType,
      accountSid: env.twilioAccountSid,
      authToken: env.twilioAuthToken
    });
  } catch (error) {
    if (error instanceof TwilioMediaError) {
      if (error.code === "twilio_media_too_large") {
        return locale === "he"
          ? "התמונה גדולה מדי. המגבלה היא 10MB."
          : "The image is too large. The limit is 10MB.";
      }
      if (
        error.code === "twilio_media_type_rejected" ||
        error.code === "twilio_media_type_mismatch"
      ) {
        return locale === "he"
          ? "פורמט התמונה אינו נתמך. שלחו JPG, PNG או WebP."
          : "Unsupported image format. Send JPG, PNG or WebP.";
      }
    }
    throw error;
  }
  const { bytes, mimeType } = download;

  const validation = asObject(checkpoint.validation);
  const criteria =
    text(validation.criteria) || "The image clearly satisfies the checkpoint task.";
  const threshold =
    typeof validation.confidenceThreshold === "number"
      ? validation.confidenceThreshold
      : 0.86;
  const assessment = await validatePhotoWithGemini({
    base64: Buffer.from(bytes).toString("base64"),
    mimeType: mediaContentType,
    criteria
  });

  const extension =
    mimeType === "image/png"
      ? "png"
      : mimeType === "image/webp"
        ? "webp"
        : "jpg";
  const storagePath = `${run.id}/${team.id}/${checkpoint.slug}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("game-media")
    .upload(storagePath, bytes, {
      contentType: mimeType,
      upsert: false
    });
  if (uploadError) throw uploadError;

  const { data: mediaAsset, error: mediaError } = await supabase
    .from("media_assets")
    .insert({
      run_id: run.id,
      team_id: team.id,
      participant_id: participant.id,
      checkpoint_id: checkpoint.id,
      storage_path: storagePath,
      mime_type: mimeType,
      source: "whatsapp",
      validation: assessment
    })
    .select("id")
    .single();
  if (mediaError || !mediaAsset) {
    throw mediaError ?? new Error("media_asset_insert_failed");
  }

  if (!assessment.approved || assessment.confidence < threshold) {
    const fallback = asObject(checkpoint.fallback_checkpoint);
    return (
      text(fallback[locale]) ||
      (locale === "he"
        ? "לא ניתן לאמת את התמונה. השתמשו בשאלת הגיבוי באתר."
        : "The photo could not be verified. Use the fallback question in the web app.")
    );
  }

  const { data: nextCheckpoint, error: nextError } = await supabase
    .from("run_checkpoints")
    .select("slug,sequence_no")
    .eq("run_id", run.id)
    .eq("is_disabled", false)
    .gt("sequence_no", checkpoint.sequence_no)
    .order("sequence_no")
    .limit(1)
    .maybeSingle();
  if (nextError) throw nextError;

  const reference = team.last_progress_at ?? team.started_at ?? new Date().toISOString();
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(reference).getTime()) / 1000)
  );
  const scoreDelta = calculateScoreDelta({
    correct: true,
    wrongAttempts: team.wrong_attempts,
    hintsUsed: team.hints_used,
    elapsedSeconds,
    scoring: asObject(checkpoint.scoring) as ScoringConfig
  });
  const isFinal = checkpoint.kind === "finale" || !nextCheckpoint;
  const { error: completionError } = await supabase.rpc("apply_submission", {
    p_team_id: team.id,
    p_participant_id: participant.id,
    p_checkpoint_id: checkpoint.id,
    p_submission_type: "whatsapp_photo",
    p_normalized_answer: "gemini_photo_approved",
    p_payload: {
      source: "whatsapp",
      mediaAssetId: mediaAsset.id,
      confidence: assessment.confidence
    },
    p_is_correct: true,
    p_score_delta: scoreDelta,
    p_validation_reason: "gemini_photo_approved",
    p_idempotency_key: `wa-photo:${messageSid}`,
    p_next_checkpoint_slug: nextCheckpoint?.slug ?? null,
    p_is_final: isFinal
  });
  if (completionError) throw completionError;

  const success = localizedSuccess(
    checkpoint.content,
    locale,
    locale === "he" ? "התמונה אושרה." : "Photo approved."
  );
  await queueTeamMessage({ runId: run.id, teamId: team.id, body: success });
  return success;
};
