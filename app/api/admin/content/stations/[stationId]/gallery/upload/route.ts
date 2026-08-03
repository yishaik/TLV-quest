import { requireAdmin } from "@/lib/admin-auth";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";
import {
  GALLERY_BUCKET,
  GALLERY_MAX_BYTES,
  galleryExtension,
  galleryObjectPath,
  isGalleryMimeType
} from "@/lib/station-gallery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Issues a signed URL so the browser uploads straight to Storage.
 *
 * Posting the file through this function instead would hit Vercel's 4.5 MB
 * request-body limit, which is smaller than the 8 MB the bucket accepts and
 * smaller than a modern phone photo. Worse, that limit is enforced by the
 * platform before any handler runs, so it returns an HTML error page rather
 * than the JSON error contract — which is exactly how it first showed up in
 * the field, as "Unexpected token 'R'" while parsing "Request En…".
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ stationId: string }> }
) {
  try {
    const { supabase } = await requireAdmin(request);
    const { stationId } = await context.params;
    const body = await readJson<{ mimeType?: unknown; size?: unknown }>(request);

    const mimeType = String(body.mimeType ?? "");
    if (!isGalleryMimeType(mimeType)) {
      throw new Error("Use a JPG, PNG or WebP image");
    }
    const size = Number(body.size);
    if (!Number.isFinite(size) || size <= 0) {
      throw new Error("Image size is required");
    }
    if (size > GALLERY_MAX_BYTES) {
      throw new Error("Image must be smaller than 8 MB");
    }

    const { data: station, error: stationError } = await supabase
      .from("content_stations")
      .select("id")
      .eq("id", stationId)
      .single();
    if (stationError || !station) {
      throw stationError ?? new Error("Station was not found");
    }

    const path = galleryObjectPath(stationId, galleryExtension(mimeType));
    const { data, error } = await supabase.storage
      .from(GALLERY_BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    if (error || !data) {
      throw error ?? new Error("Failed to authorise the upload");
    }

    return jsonOk({
      bucket: GALLERY_BUCKET,
      path,
      uploadToken: data.token,
      maxBytes: GALLERY_MAX_BYTES
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
