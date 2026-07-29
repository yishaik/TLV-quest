import { requireAdmin } from "@/lib/admin-auth";
import { handleRouteError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

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
    if (!allowedTypes.has(file.type)) throw new Error("Use a JPG, PNG or WebP image");
    if (file.size > 8 * 1024 * 1024) throw new Error("Image must be smaller than 8 MB");

    const { data: station, error: stationError } = await supabase
      .from("content_stations")
      .select("id,hero_image_path")
      .eq("id", stationId)
      .single();
    if (stationError || !station) throw stationError ?? new Error("Station was not found");

    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `stations/${stationId}/${crypto.randomUUID()}.${extension}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from("content-media")
      .upload(path, bytes, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage.from("content-media").getPublicUrl(path);
    const publicUrl = publicData.publicUrl;
    const { data, error } = await supabase
      .from("content_stations")
      .update({
        hero_image_path: path,
        hero_image_url: publicUrl,
        updated_at: new Date().toISOString(),
        updated_by: email
      })
      .eq("id", stationId)
      .select("*")
      .single();
    if (error || !data) {
      await supabase.storage.from("content-media").remove([path]);
      throw error ?? new Error("Failed to attach station image");
    }

    if (station.hero_image_path) {
      await supabase.storage.from("content-media").remove([station.hero_image_path]);
    }
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
    const { supabase, email } = await requireAdmin(request);
    const { stationId } = await context.params;
    const { data: station, error: stationError } = await supabase
      .from("content_stations")
      .select("hero_image_path")
      .eq("id", stationId)
      .single();
    if (stationError || !station) throw stationError ?? new Error("Station was not found");

    const { data, error } = await supabase
      .from("content_stations")
      .update({
        hero_image_path: null,
        hero_image_url: null,
        updated_at: new Date().toISOString(),
        updated_by: email
      })
      .eq("id", stationId)
      .select("*")
      .single();
    if (error || !data) throw error ?? new Error("Failed to remove station image");
    if (station.hero_image_path) {
      await supabase.storage.from("content-media").remove([station.hero_image_path]);
    }
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
