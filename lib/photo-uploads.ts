import "server-only";

import { randomUUID } from "node:crypto";
import { submitStoredPhoto } from "@/lib/physical-actions";
import {
  detectPhotoMimeType,
  isPhotoUploadMimeType,
  photoExtension,
  PHOTO_UPLOAD_AUTH_TTL_MS,
  PHOTO_UPLOAD_BUCKET,
  PHOTO_UPLOAD_MAX_BYTES,
  type PhotoUploadMimeType
} from "@/lib/photo-upload-shared";
import { getParticipantState } from "@/lib/repository";
import { createAdminClient } from "@/lib/supabase/admin";

type PhotoUploadRow = {
  id: string;
  run_id: string;
  team_id: string;
  participant_id: string;
  checkpoint_id: string;
  storage_path: string;
  expected_mime_type: string;
  expected_size: number | string;
  idempotency_key: string;
  status: string;
  processing_started_at: string | null;
  expires_at: string;
  result: unknown;
};

const processingLeaseMs = 5 * 60 * 1000;

const isExpired = (value: string) =>
  !Number.isFinite(new Date(value).getTime()) ||
  new Date(value).getTime() <= Date.now();

const isStaleProcessing = (value: string | null) =>
  !value ||
  new Date(value).getTime() <= Date.now() - processingLeaseMs;

const asResult = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (
    typeof result.approved !== "boolean" ||
    typeof result.confidence !== "number" ||
    typeof result.reason !== "string"
  ) {
    return null;
  }
  return {
    approved: result.approved,
    confidence: result.confidence,
    reason: result.reason,
    hasFallback:
      typeof result.hasFallback === "boolean" ? result.hasFallback : undefined,
    fallbackPrompt:
      typeof result.fallbackPrompt === "string" ||
      result.fallbackPrompt === null
        ? result.fallbackPrompt
        : undefined
  };
};

const scopedPath = ({
  runId,
  teamId,
  participantId,
  checkpointId,
  mimeType
}: {
  runId: string;
  teamId: string;
  participantId: string;
  checkpointId: string;
  mimeType: PhotoUploadMimeType;
}) =>
  `${runId}/${teamId}/${participantId}/${checkpointId}/${randomUUID()}.${photoExtension(mimeType)}`;

const authorizeRow = async (row: PhotoUploadRow) => {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(PHOTO_UPLOAD_BUCKET)
    .createSignedUploadUrl(row.storage_path, { upsert: false });
  if (error || !data) {
    throw error ?? new Error("photo_upload_authorization_failed");
  }

  return {
    uploadId: row.id,
    bucket: PHOTO_UPLOAD_BUCKET,
    path: row.storage_path,
    uploadToken: data.token,
    expiresAt: row.expires_at,
    maxBytes: PHOTO_UPLOAD_MAX_BYTES
  };
};

export const issuePhotoUpload = async ({
  token,
  mimeType,
  size,
  idempotencyKey
}: {
  token: string;
  mimeType: unknown;
  size: unknown;
  idempotencyKey: string;
}) => {
  if (!isPhotoUploadMimeType(mimeType)) {
    throw new Error("photo_upload_unsupported_format");
  }
  if (
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > PHOTO_UPLOAD_MAX_BYTES
  ) {
    throw new Error("photo_upload_too_large");
  }
  if (
    !idempotencyKey.trim() ||
    idempotencyKey.length > 200
  ) {
    throw new Error("photo_upload_invalid_request");
  }

  const state = await getParticipantState(token);
  if (
    state.run.status !== "active" ||
    !state.checkpoint ||
    state.checkpoint.kind !== "photo"
  ) {
    throw new Error("photo_checkpoint_changed");
  }

  const supabase = createAdminClient();
  const { data: existing, error: existingError } = await supabase
    .from("photo_uploads")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .eq("participant_id", state.participant.id)
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing) {
    const row = existing as PhotoUploadRow;
    if (
      row.status !== "pending" ||
      isExpired(row.expires_at) ||
      row.checkpoint_id !== state.checkpoint.id ||
      row.expected_mime_type !== mimeType ||
      Number(row.expected_size) !== size
    ) {
      throw new Error("photo_upload_idempotency_conflict");
    }
    return authorizeRow(row);
  }

  const expiresAt = new Date(
    Date.now() + PHOTO_UPLOAD_AUTH_TTL_MS
  ).toISOString();
  const path = scopedPath({
    runId: state.run.id,
    teamId: state.team.id,
    participantId: state.participant.id,
    checkpointId: state.checkpoint.id,
    mimeType
  });
  const { data: inserted, error: insertError } = await supabase
    .from("photo_uploads")
    .insert({
      run_id: state.run.id,
      team_id: state.team.id,
      participant_id: state.participant.id,
      checkpoint_id: state.checkpoint.id,
      storage_path: path,
      expected_mime_type: mimeType,
      expected_size: size,
      idempotency_key: idempotencyKey,
      expires_at: expiresAt
    })
    .select("*")
    .single();
  if (insertError || !inserted) {
    if (insertError?.code === "23505") {
      throw new Error("photo_upload_idempotency_conflict");
    }
    throw insertError ?? new Error("photo_upload_authorization_failed");
  }

  try {
    return await authorizeRow(inserted as PhotoUploadRow);
  } catch (error) {
    await supabase.from("photo_uploads").delete().eq("id", inserted.id);
    throw error;
  }
};

const invalidateUpload = async (uploadId: string, errorCode: string) => {
  const supabase = createAdminClient();
  await supabase
    .from("photo_uploads")
    .update({
      status: "invalid",
      error_code: errorCode,
      processing_started_at: null,
      expires_at: new Date().toISOString()
    })
    .eq("id", uploadId)
    .in("status", ["pending", "processing"]);
};

const resetUpload = async (uploadId: string) => {
  const supabase = createAdminClient();
  await supabase
    .from("photo_uploads")
    .update({
      status: "pending",
      processing_started_at: null
    })
    .eq("id", uploadId)
    .eq("status", "processing");
};

const invalidUploadErrors = new Set([
  "photo_upload_path_mismatch",
  "photo_upload_size_mismatch",
  "photo_upload_mime_mismatch",
  "photo_upload_invalid_signature",
  "photo_checkpoint_changed"
]);

const errorCode = (error: unknown) =>
  error instanceof Error ? error.message : "photo_upload_finalize_failed";

export const finalizePhotoUpload = async ({
  token,
  uploadId,
  idempotencyKey
}: {
  token: string;
  uploadId: unknown;
  idempotencyKey: string;
}) => {
  if (typeof uploadId !== "string" || !uploadId.trim()) {
    throw new Error("photo_upload_invalid_request");
  }

  const state = await getParticipantState(token);
  const supabase = createAdminClient();
  const { data: uploadData, error: uploadError } = await supabase
    .from("photo_uploads")
    .select("*")
    .eq("id", uploadId)
    .eq("participant_id", state.participant.id)
    .eq("run_id", state.run.id)
    .eq("team_id", state.team.id)
    .limit(1)
    .maybeSingle();
  if (uploadError) throw uploadError;
  if (!uploadData) throw new Error("photo_upload_not_found");

  const upload = uploadData as PhotoUploadRow;
  if (upload.status === "completed") {
    const result = asResult(upload.result);
    if (!result) throw new Error("photo_upload_finalize_failed");
    return { result, replayed: true };
  }

  if (
    state.run.status !== "active" ||
    !state.checkpoint ||
    state.checkpoint.kind !== "photo" ||
    state.checkpoint.id !== upload.checkpoint_id
  ) {
    await invalidateUpload(upload.id, "photo_checkpoint_changed");
    throw new Error("photo_checkpoint_changed");
  }
  if (upload.idempotency_key !== idempotencyKey) {
    throw new Error("photo_upload_idempotency_conflict");
  }
  if (isExpired(upload.expires_at)) {
    await invalidateUpload(upload.id, "photo_upload_expired");
    throw new Error("photo_upload_expired");
  }
  if (
    upload.status !== "pending" &&
    !(upload.status === "processing" &&
      isStaleProcessing(upload.processing_started_at))
  ) {
    throw new Error("photo_upload_not_ready");
  }

  let claim = supabase
    .from("photo_uploads")
    .update({
      status: "processing",
      processing_started_at: new Date().toISOString(),
      error_code: null
    })
    .eq("id", upload.id)
    .eq("status", upload.status);
  if (upload.status === "processing" && upload.processing_started_at) {
    claim = claim.eq("processing_started_at", upload.processing_started_at);
  }
  const { data: claimed, error: claimError } = await claim
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) throw new Error("photo_upload_not_ready");

  try {
    const prefix = `${upload.run_id}/${upload.team_id}/${upload.participant_id}/${upload.checkpoint_id}/`;
    if (
      !upload.storage_path.startsWith(prefix) ||
      upload.storage_path.includes("..")
    ) {
      throw new Error("photo_upload_path_mismatch");
    }

    const storage = supabase.storage.from(PHOTO_UPLOAD_BUCKET);
    const { data: info, error: infoError } = await storage.info(
      upload.storage_path
    );
    if (infoError || !info) {
      throw new Error("photo_upload_not_ready");
    }

    const storedSize =
      typeof info.size === "number"
        ? info.size
        : typeof info.metadata?.size === "number"
          ? info.metadata.size
          : null;
    const storedMime =
      typeof info.contentType === "string"
        ? info.contentType
        : typeof info.metadata?.mimetype === "string"
          ? info.metadata.mimetype
          : "";

    if (
      info.bucketId !== PHOTO_UPLOAD_BUCKET ||
      info.name !== upload.storage_path
    ) {
      throw new Error("photo_upload_path_mismatch");
    }
    if (
      storedSize === null ||
      storedSize !== Number(upload.expected_size) ||
      storedSize <= 0 ||
      storedSize > PHOTO_UPLOAD_MAX_BYTES
    ) {
      throw new Error("photo_upload_size_mismatch");
    }
    if (
      !isPhotoUploadMimeType(storedMime) ||
      storedMime !== upload.expected_mime_type
    ) {
      throw new Error("photo_upload_mime_mismatch");
    }

    const { data: blob, error: downloadError } = await storage.download(
      upload.storage_path
    );
    if (downloadError || !blob) {
      throw downloadError ?? new Error("photo_upload_not_ready");
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (
      bytes.byteLength !== storedSize ||
      detectPhotoMimeType(bytes) !== storedMime
    ) {
      throw new Error("photo_upload_invalid_signature");
    }

    const result = await submitStoredPhoto({
      token,
      bytes,
      mimeType: storedMime,
      storagePath: upload.storage_path,
      checkpointId: upload.checkpoint_id,
      idempotencyKey: upload.idempotency_key
    });
    const safeResult = {
      approved: result.approved,
      confidence: result.confidence,
      reason: result.reason,
      hasFallback:
        "hasFallback" in result ? result.hasFallback : undefined,
      fallbackPrompt:
        "fallbackPrompt" in result ? result.fallbackPrompt : undefined
    };
    const { error: completeError } = await supabase
      .from("photo_uploads")
      .update({
        status: "completed",
        finalized_at: new Date().toISOString(),
        processing_started_at: null,
        result: safeResult,
        error_code: null
      })
      .eq("id", upload.id)
      .eq("status", "processing");
    if (completeError) throw completeError;

    console.info("Participant photo finalized", {
      uploadId: upload.id,
      runId: upload.run_id,
      teamId: upload.team_id,
      approved: safeResult.approved,
      byteSize: storedSize
    });
    return { result: safeResult, replayed: false };
  } catch (error) {
    const code = errorCode(error);
    if (invalidUploadErrors.has(code)) {
      await invalidateUpload(upload.id, code);
    } else {
      await resetUpload(upload.id);
    }
    throw error;
  }
};

export const cleanupAbandonedPhotoUploads = async (limit = 50) => {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("claim_expired_photo_uploads", {
    p_batch_size: Math.max(1, Math.min(limit, 100))
  });
  if (error) throw error;

  const rows = (data ?? []) as Array<{ id: string; storage_path: string }>;
  if (!rows.length) return { claimed: 0, deleted: 0 };

  const { error: removeError } = await supabase.storage
    .from(PHOTO_UPLOAD_BUCKET)
    .remove(rows.map((row) => row.storage_path));
  if (removeError) throw removeError;

  const { error: deleteError } = await supabase
    .from("photo_uploads")
    .delete()
    .in("id", rows.map((row) => row.id))
    .eq("status", "cleaning");
  if (deleteError) throw deleteError;

  return { claimed: rows.length, deleted: rows.length };
};
