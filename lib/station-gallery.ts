/**
 * Station gallery entries.
 *
 * `content_stations.gallery` is a free-form `jsonb` array, so every read has to
 * assume the worst: rows predate this shape, and a hand-edited row can contain
 * anything. These helpers normalise on read rather than trusting the column,
 * which keeps the field-verification UI from crashing on a malformed entry.
 */

export const GALLERY_BUCKET = "content-media";
/** Matches the bucket's own `file_size_limit`; the browser checks it first. */
export const GALLERY_MAX_BYTES = 8 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export const isGalleryMimeType = (value: string): boolean =>
  Object.prototype.hasOwnProperty.call(MIME_EXTENSIONS, value);

export const galleryExtension = (mimeType: string): string =>
  MIME_EXTENSIONS[mimeType] ?? "jpg";

/**
 * Every gallery object lives under its own station. The attach step re-derives
 * this prefix and refuses anything outside it, so a signed URL for one station
 * cannot be used to graft an object onto another.
 */
export const galleryPrefix = (stationId: string): string =>
  `stations/${stationId}/gallery/`;

export const galleryObjectPath = (
  stationId: string,
  extension: string
): string => `${galleryPrefix(stationId)}${crypto.randomUUID()}.${extension}`;

export type GalleryVerdict = "accept" | "reject" | "reference";

export type GalleryEntry = {
  path: string;
  url: string;
  verdict: GalleryVerdict;
  note: string;
  capturedAt: string;
  capturedBy: string;
};

const VERDICTS: GalleryVerdict[] = ["accept", "reject", "reference"];

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

const asVerdict = (value: unknown): GalleryVerdict =>
  VERDICTS.includes(value as GalleryVerdict)
    ? (value as GalleryVerdict)
    : "reference";

/** Normalises the raw column into usable entries, dropping anything pathless. */
export const galleryEntries = (raw: unknown): GalleryEntry[] => {
  if (!Array.isArray(raw)) return [];
  const entries: GalleryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const path = asString(record.path);
    // An entry without a path cannot be deleted or resolved, so it is noise.
    if (!path) continue;
    entries.push({
      path,
      url: asString(record.url),
      verdict: asVerdict(record.verdict),
      note: asString(record.note),
      capturedAt: asString(record.capturedAt),
      capturedBy: asString(record.capturedBy)
    });
  }
  return entries;
};

export const appendGalleryEntry = (
  entries: GalleryEntry[],
  entry: GalleryEntry
): GalleryEntry[] => [...entries.filter((item) => item.path !== entry.path), entry];

export const removeGalleryEntry = (
  entries: GalleryEntry[],
  path: string
): GalleryEntry[] => entries.filter((entry) => entry.path !== path);

/**
 * Calibrating a photo threshold needs examples that should pass *and* examples
 * that should fail. A pile of only-good photos cannot tell you where the line
 * is, so the UI reports both counts and stays honest about the shortfall.
 */
export const calibrationProgress = (
  entries: GalleryEntry[],
  target = 15
) => {
  const accept = entries.filter((entry) => entry.verdict === "accept").length;
  const reject = entries.filter((entry) => entry.verdict === "reject").length;
  return {
    accept,
    reject,
    total: entries.length,
    // Both sides are required; the weaker side is what limits calibration.
    ready: accept >= Math.ceil(target / 2) && reject >= Math.ceil(target / 3),
    missingAccept: Math.max(0, Math.ceil(target / 2) - accept),
    missingReject: Math.max(0, Math.ceil(target / 3) - reject)
  };
};
