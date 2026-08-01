import { requireAdmin } from "@/lib/admin-auth";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";
import {
  appendGalleryEntry,
  galleryEntries,
  removeGalleryEntry,
  type GalleryVerdict
} from "@/lib/station-gallery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const verdicts = new Set<GalleryVerdict>(["accept", "reject", "reference"]);

/**
 * Appends one photo to a station's gallery.
 *
 * Distinct from the hero-image route, which replaces the single hero and
 * deletes the previous file. Field verification needs the opposite: many
 * photos accumulated per station, each labelled with the verdict a human
 * expects from it, so the Gemini threshold can be tuned against real
 * accept/reject pairs rather than guessed.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ stationId: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { stationId } = await context.params;

    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File)) throw new Error("Image is required");
    if (!allowedTypes.has(file.type)) {
      throw new Error("Use a JPG, PNG or WebP image");
    }
    if (file.size > 8 * 1024 * 1024) {
      throw new Error("Image must be smaller than 8 MB");
    }

    const rawVerdict = String(form.get("verdict") ?? "reference");
    const verdict = verdicts.has(rawVerdict as GalleryVerdict)
      ? (rawVerdict as GalleryVerdict)
      : "reference";
    const note = String(form.get("note") ?? "").trim().slice(0, 280);

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

    const extension =
      file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `stations/${stationId}/gallery/${crypto.randomUUID()}.${extension}`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from("content-media")
      .upload(path, bytes, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage
      .from("content-media")
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

    // The row is the record; a file with no row pointing at it is invisible
    // and un-deletable through the UI, so roll the upload back.
    if (error || !data) {
      await supabase.storage.from("content-media").remove([path]);
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
    // orphaned object rather than a broken gallery entry.
    await supabase.storage.from("content-media").remove([path]);

    return jsonOk(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
