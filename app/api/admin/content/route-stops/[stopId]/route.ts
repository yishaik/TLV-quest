import { requireAdmin } from "@/lib/admin-auth";
import { objectValue } from "@/lib/content-os";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ stopId: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { stopId } = await context.params;
    const body = await readJson<Record<string, unknown>>(request);
    const riddleId = typeof body.riddleId === "string" ? body.riddleId : "";
    const slug = typeof body.slug === "string" ? body.slug : "";
    if (!riddleId || !slug) throw new Error("Riddle and route stop slug are required");

    const { data, error } = await supabase.rpc("content_update_route_stop", {
      p_stop_id: stopId,
      p_riddle_id: riddleId,
      p_slug: slug,
      p_is_optional: body.isOptional === true,
      p_is_active: body.isActive !== false,
      p_overrides: objectValue(body.overrides),
      p_actor: email
    });
    if (error) throw error;
    return jsonOk(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ stopId: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { stopId } = await context.params;
    const { data, error } = await supabase.rpc("content_remove_route_stop", {
      p_stop_id: stopId,
      p_actor: email
    });
    if (error) throw error;
    return jsonOk(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
