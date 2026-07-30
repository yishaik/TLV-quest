"use client";

import { getBrowserClient } from "@/lib/supabase/browser";
import {
  isPhotoUploadMimeType,
  PHOTO_UPLOAD_MAX_BYTES,
  type PhotoUploadMimeType
} from "@/lib/photo-upload-shared";
import {
  PhotoUploadClientError,
  photoUploadCopy,
  readPhotoApiData
} from "@/lib/photo-upload-response";

type Locale = "he" | "en";

type UploadAuthorization = {
  uploadId: string;
  bucket: string;
  path: string;
  uploadToken: string;
  expiresAt: string;
  maxBytes: number;
  uploaded?: boolean;
};

export type PhotoUploadResult = {
  approved: boolean;
  confidence: number;
  reason: string;
  hasFallback?: boolean;
  fallbackPrompt?: string | null;
};

const validateFile = (
  file: File,
  locale: Locale
): PhotoUploadMimeType => {
  if (!isPhotoUploadMimeType(file.type)) {
    throw new PhotoUploadClientError(
      photoUploadCopy(locale, "unsupported"),
      415
    );
  }
  if (file.size <= 0 || file.size > PHOTO_UPLOAD_MAX_BYTES) {
    throw new PhotoUploadClientError(
      photoUploadCopy(locale, "tooLarge"),
      413
    );
  }
  return file.type;
};

const storageStatus = (error: unknown) => {
  if (!error || typeof error !== "object") return undefined;
  const value =
    "statusCode" in error
      ? (error as { statusCode?: unknown }).statusCode
      : "status" in error
        ? (error as { status?: unknown }).status
        : undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

type ParticipantPhotoUploadInput = {
  token: string;
  file: File;
  locale: Locale;
  idempotencyKey: string;
};

const performParticipantPhotoUpload = async ({
  token,
  file,
  locale,
  idempotencyKey
}: ParticipantPhotoUploadInput): Promise<PhotoUploadResult> => {
  const mimeType = validateFile(file, locale);
  const endpoint = `/api/participants/${encodeURIComponent(token)}/photo`;

  try {
    const authorizationResponse = await fetch(`${endpoint}/upload`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey
      },
      body: JSON.stringify({ mimeType, size: file.size })
    });
    const authorization = await readPhotoApiData<UploadAuthorization>(
      authorizationResponse,
      locale
    );

    if (!authorization.uploaded) {
      const { error: uploadError } = await getBrowserClient()
        .storage
        .from(authorization.bucket)
        .uploadToSignedUrl(
          authorization.path,
          authorization.uploadToken,
          file,
          {
            cacheControl: "0",
            contentType: mimeType,
            upsert: false
          }
        );

      if (uploadError) {
        const status = storageStatus(uploadError);
        if (status !== 409) {
          throw new PhotoUploadClientError(
            status === 413
              ? photoUploadCopy(locale, "tooLarge")
              : status === 415
                ? photoUploadCopy(locale, "unsupported")
                : photoUploadCopy(locale, "network"),
            status
          );
        }
      }
    }

    const finalizeResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey
      },
      body: JSON.stringify({ uploadId: authorization.uploadId })
    });
    return await readPhotoApiData<PhotoUploadResult>(
      finalizeResponse,
      locale
    );
  } catch (error) {
    if (error instanceof PhotoUploadClientError) throw error;
    throw new PhotoUploadClientError(photoUploadCopy(locale, "network"));
  }
};

const activePhotoUploads = new Map<
  string,
  Promise<PhotoUploadResult>
>();

export const uploadParticipantPhoto = async (
  input: ParticipantPhotoUploadInput
): Promise<PhotoUploadResult> => {
  const active = activePhotoUploads.get(input.idempotencyKey);
  if (active) return active;

  const operation = performParticipantPhotoUpload(input);
  activePhotoUploads.set(input.idempotencyKey, operation);
  try {
    return await operation;
  } finally {
    if (activePhotoUploads.get(input.idempotencyKey) === operation) {
      activePhotoUploads.delete(input.idempotencyKey);
    }
  }
};
