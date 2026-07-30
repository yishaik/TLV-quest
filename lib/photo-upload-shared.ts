export const PHOTO_UPLOAD_BUCKET = "game-media";
export const PHOTO_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_UPLOAD_AUTH_TTL_MS = 2 * 60 * 60 * 1000;

export const PHOTO_UPLOAD_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp"
] as const;

export type PhotoUploadMimeType = (typeof PHOTO_UPLOAD_MIME_TYPES)[number];

export const isPhotoUploadMimeType = (
  value: unknown
): value is PhotoUploadMimeType =>
  typeof value === "string" &&
  PHOTO_UPLOAD_MIME_TYPES.includes(value as PhotoUploadMimeType);

export const photoExtension = (mimeType: PhotoUploadMimeType) =>
  mimeType === "image/png"
    ? "png"
    : mimeType === "image/webp"
      ? "webp"
      : "jpg";

export const detectPhotoMimeType = (
  bytes: Uint8Array
): PhotoUploadMimeType | null => {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
};
