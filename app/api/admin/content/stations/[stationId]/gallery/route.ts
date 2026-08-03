import { requireAdmin } from "@/lib/admin-auth";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";
import {
  GALLERY_BUCKET,
  appendGalleryEntry,
  galleryEntries,
  galleryPrefix,
  removeGalleryEntry,
  type GalleryVerdict
} from "@/lib/station-gallery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const verdicts = new Set<GalleryVerdict>(["accept", "reject", "reference"]);

/**
 * Records an already-uploaded object against a station.
 *
 * The bytes never pass through here — the browser uploads to Storage with a
 * signed URL from `./upload`, because Vercel caps a function request body at
 * 4.5 MB and returns an HTML error page when it is exceeded. This endpoint
 * only takes the resulting path, so the request stays a few hundred bytes.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ stationId: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { stationId } = await context.params;
    const body = await readJson<Record<string, unknown>>(request);

    const path = String(body.path ?? "");
    // A signed URL is scoped to one object, but the caller still names the
    // station here. Without this check a token issued for station A could
    // attach its object to station B's gallery.
    if (!path.startsWith(galleryPrefix(stationId))) {
      throw new Error("Photo path does not belong to this station");
    }

    const rawVerdict = String(body.verdict ?? "reference");
    const verdict = verdicts.has(rawVerdict as GalleryVerdict)
      ? (rawVerdict as GalleryVerdict)
      : "reference";
    const note = String(body.note ?? "").trim().slice(0, 280);

    const { data: station, error: stationError } = await supabase
      .from("content_stations")
      .select("id,gallery")
      .eq("id", stationId)
      .single();
    if (stationError || !station) {
      throw stationError ?? new Error("Station was not found");
    }

    const existing = galleryEntries(station.gallery);
    if (existing.length >= 60) {
      throw new Error("This station already has 60 photos");
    }

    // Recording a path that was never uploaded would produce a gallery tile
    // that renders as a broken image and cannot be explained.
    const { data: found, error: listError } = await supabase.storage
      .from(GALLERY_BUCKET)
      .list(galleryPrefix(stationId).replace(/\/$/, ""), {
        search: path.split("/").pop() ?? ""
      });
    if (listError) throw listError;
    if (!found || found.length === 0) {
      throw new Error("The upload did not complete");
    }

    const { data: publicData } = supabase.storage
      .from(GALLERY_BUCKET)
      .getPublicUrl(path);

    const gallery = appendGalleryEntry(existing, {
      path,
      url: publicData.publicUrl,
      verdict,
      note,
      capturedAt: new Date().toISOString(),
      capturedBy: email
    });

    const { data, error } = await supabase
      .from("content_stations")
      .update({
        gallery,
        updated_at: new Date().toISOString(),
        updated_by: email
      })
      .eq("id", stationId)
      .select("*")
      .single();
    if (error || !data) {
      await supabase.storage.from(GALLERY_BUCKET).remove([path]);
      throw error ?? new Error("Failed to attach the photo");
    }

    return jsonOk(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ stationId: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { stationId } = await context.params;
    const body = await readJson<Record<string, unknown>>(request);
    const path = typeof body.path === "string" ? body.path : "";
    if (!path) throw new Error("Photo path is required");

    const { data: station, error: stationError } = await supabase
      .from("content_stations")
      .select("id,gallery")
      .eq("id", stationId)
      .single();
    if (stationError || !station) {
      throw stationError ?? new Error("Station was not found");
    }

    const existing = galleryEntries(station.gallery);
    const gallery = removeGalleryEntry(existing, path);
    if (gallery.length === existing.length) {
      throw new Error("Photo was not found on this station");
    }

    const { data, error } = await supabase
      .from("content_stations")
      .update({
        gallery,
        updated_at: new Date().toISOString(),
        updated_by: email
      })
      .eq("id", stationId)
      .select("*")
      .single();
    if (error || !data) throw error ?? new Error("Failed to remove the photo");

    // Storage last: if this fails the row is already clean, which leaves an
    // orphaned object rather than a gallery tile pointing at nothing.
    await supabase.storage.from(GALLERY_BUCKET).remove([path]);

    return jsonOk(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
