import { requireAdmin } from "@/lib/admin-auth";
import { normalizeContentSlug, numberOrNull, objectValue } from "@/lib/content-os";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];

export async function GET(
  request: Request,
  context: { params: Promise<{ stationId: string }> }
) {
  try {
    const { supabase } = await requireAdmin(request);
    const { stationId } = await context.params;
    const { data, error } = await supabase
      .from("content_stations")
      .select("*")
      .eq("id", stationId)
      .single();
    if (error || !data) throw error ?? new Error("Station was not found");
    return jsonOk(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ stationId: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { stationId } = await context.params;
    const body = await readJson<Record<string, unknown>>(request);
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by: email
    };

    if (body.slug !== undefined) {
      const slug = normalizeContentSlug(String(body.slug));
      if (!slug) throw new Error("Station slug is required and must use Latin letters or numbers");
      updates.slug = slug;
    }
    if (body.brandKey !== undefined) {
      const brandKey = String(body.brandKey).trim();
      updates.brand_key = brandKey || "tlv-quest";
    }
    if (body.title !== undefined) {
      const title = objectValue(body.title);
      if (!String(title.he ?? "").trim() && !String(title.en ?? "").trim()) {
        throw new Error("At least one station title is required");
      }
      updates.title = { he: String(title.he ?? "").trim(), en: String(title.en ?? "").trim() };
    }
    if (body.description !== undefined) {
      const description = objectValue(body.description);
      updates.description = {
        he: String(description.he ?? "").trim(),
        en: String(description.en ?? "").trim()
      };
    }
    if (body.address !== undefined) updates.address = objectValue(body.address);
    if (body.latitude !== undefined) updates.latitude = numberOrNull(body.latitude);
    if (body.longitude !== undefined) updates.longitude = numberOrNull(body.longitude);
    if (body.radiusMeters !== undefined) updates.radius_meters = numberOrNull(body.radiusMeters);
    if (body.tags !== undefined) updates.tags = strings(body.tags);
    if (body.accessibility !== undefined) updates.accessibility = objectValue(body.accessibility);
    if (typeof body.fieldVerificationRequired === "boolean") {
      updates.field_verification_required = body.fieldVerificationRequired;
      if (!body.fieldVerificationRequired) {
        updates.health_status = "not_required";
        updates.health_checklist = {};
        updates.health_notes = null;
        updates.last_checked_at = null;
        updates.verified_at = null;
        updates.verified_by = null;
      }
    }
    if (["draft", "active", "archived"].includes(String(body.status))) {
      updates.status = String(body.status);
    }
    if (["not_required", "pending", "verified", "needs_attention", "blocked"].includes(String(body.healthStatus))) {
      updates.health_status = String(body.healthStatus);
      updates.last_checked_at = new Date().toISOString();
      if (body.healthStatus === "verified") {
        updates.verified_at = new Date().toISOString();
        updates.verified_by = email;
      } else {
        updates.verified_at = null;
        updates.verified_by = null;
      }
    }
    if (body.healthChecklist !== undefined) updates.health_checklist = objectValue(body.healthChecklist);
    if (body.healthNotes !== undefined) {
      updates.health_notes = typeof body.healthNotes === "string" && body.healthNotes.trim()
        ? body.healthNotes.trim().slice(0, 4000)
        : null;
    }

    const { data, error } = await supabase
      .from("content_stations")
      .update(updates)
      .eq("id", stationId)
      .select("*")
      .single();
    if (error || !data) throw error ?? new Error("Station was not found");

    const { error: compileError } = await supabase.rpc("content_recompile_station_references", {
      p_station_id: stationId,
      p_actor: email
    });
    if (compileError) throw compileError;

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
    const { supabase } = await requireAdmin(request);
    const { stationId } = await context.params;
    const [{ count: stopCount, error: stopError }, { count: riddleCount, error: riddleError }] =
      await Promise.all([
        supabase
          .from("content_route_stops")
          .select("id", { count: "exact", head: true })
          .eq("station_id", stationId),
        supabase
          .from("content_riddles")
          .select("id", { count: "exact", head: true })
          .eq("station_id", stationId)
      ]);
    if (stopError) throw stopError;
    if (riddleError) throw riddleError;
    if ((stopCount ?? 0) > 0) throw new Error("Station is used by one or more route versions and cannot be deleted");
    if ((riddleCount ?? 0) > 0) throw new Error("Delete or move the station riddles before deleting the station");

    const { data: station, error: stationError } = await supabase
      .from("content_stations")
      .select("hero_image_path")
      .eq("id", stationId)
      .single();
    if (stationError) throw stationError;

    const { error } = await supabase.from("content_stations").delete().eq("id", stationId);
    if (error) throw error;
    if (station?.hero_image_path) {
      await supabase.storage.from("content-media").remove([station.hero_image_path]);
    }
    return jsonOk({ stationId });
  } catch (error) {
    return handleRouteError(error);
  }
}
