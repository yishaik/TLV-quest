import { requireAdmin } from "@/lib/admin-auth";
import { normalizeContentSlug, objectValue } from "@/lib/content-os";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kinds = new Set(["text", "choice", "scan", "location", "photo", "hybrid", "finale"]);
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];

export async function GET(
  request: Request,
  context: { params: Promise<{ riddleId: string }> }
) {
  try {
    const { supabase } = await requireAdmin(request);
    const { riddleId } = await context.params;
    const { data, error } = await supabase
      .from("content_riddles")
      .select("*")
      .eq("id", riddleId)
      .single();
    if (error || !data) throw error ?? new Error("Riddle was not found");
    return jsonOk(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ riddleId: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { riddleId } = await context.params;
    const body = await readJson<Record<string, unknown>>(request);
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by: email
    };

    if (body.slug !== undefined) {
      const slug = normalizeContentSlug(String(body.slug));
      if (!slug) throw new Error("Riddle slug is required and must use Latin letters or numbers");
      updates.slug = slug;
    }
    if (body.title !== undefined) {
      const title = objectValue(body.title);
      updates.title = { he: String(title.he ?? "").trim(), en: String(title.en ?? "").trim() };
    }
    if (body.kind !== undefined) {
      const kind = String(body.kind);
      if (!kinds.has(kind)) throw new Error("Unsupported riddle kind");
      updates.kind = kind;
    }
    if (body.content !== undefined) updates.content = objectValue(body.content);
    if (body.validation !== undefined) updates.validation = objectValue(body.validation);
    if (body.hints !== undefined) updates.hints = Array.isArray(body.hints) ? body.hints : [];
    if (body.scoring !== undefined) updates.scoring = objectValue(body.scoring);
    if (body.fallback !== undefined) {
      updates.fallback = body.fallback === null ? null : objectValue(body.fallback);
    }
    if (body.interaction !== undefined) updates.interaction = objectValue(body.interaction);
    if (body.tags !== undefined) updates.tags = strings(body.tags);
    if (["draft", "active", "archived"].includes(String(body.status))) updates.status = String(body.status);

    const { data, error } = await supabase
      .from("content_riddles")
      .update(updates)
      .eq("id", riddleId)
      .select("*")
      .single();
    if (error || !data) throw error ?? new Error("Riddle was not found");

    const { error: compileError } = await supabase.rpc("content_recompile_riddle_references", {
      p_riddle_id: riddleId,
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
  context: { params: Promise<{ riddleId: string }> }
) {
  try {
    const { supabase } = await requireAdmin(request);
    const { riddleId } = await context.params;
    const { count, error: countError } = await supabase
      .from("content_route_stops")
      .select("id", { count: "exact", head: true })
      .eq("riddle_id", riddleId);
    if (countError) throw countError;
    if ((count ?? 0) > 0) throw new Error("Riddle is used by one or more route versions and cannot be deleted");

    const { data: riddle, error: riddleError } = await supabase
      .from("content_riddles")
      .select("hero_image_path")
      .eq("id", riddleId)
      .single();
    if (riddleError) throw riddleError;

    const { error } = await supabase.from("content_riddles").delete().eq("id", riddleId);
    if (error) throw error;
    if (riddle?.hero_image_path) {
      await supabase.storage.from("content-media").remove([riddle.hero_image_path]);
    }
    return jsonOk({ riddleId });
  } catch (error) {
    return handleRouteError(error);
  }
}
