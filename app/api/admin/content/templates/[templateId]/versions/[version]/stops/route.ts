import { requireAdmin } from "@/lib/admin-auth";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const parseVersion = (value: string) => {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) throw new Error("Invalid template version");
  return version;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ templateId: string; version: string }> }
) {
  try {
    const { supabase } = await requireAdmin(request);
    const { templateId, version: rawVersion } = await context.params;
    const version = parseVersion(rawVersion);
    const { data, error } = await supabase
      .from("content_route_stops")
      .select("id,template_id,version,station_id,riddle_id,slug,sequence_no,is_optional,is_active,overrides,created_at,updated_at")
      .eq("template_id", templateId)
      .eq("version", version)
      .order("sequence_no");
    if (error) throw error;
    return jsonOk(data ?? []);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ templateId: string; version: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { templateId, version: rawVersion } = await context.params;
    const version = parseVersion(rawVersion);
    const body = await readJson<Record<string, unknown>>(request);
    const stationId = typeof body.stationId === "string" ? body.stationId : "";
    const riddleId = typeof body.riddleId === "string" ? body.riddleId : "";
    if (!stationId || !riddleId) throw new Error("Station and riddle are required");

    const { data, error } = await supabase.rpc("content_add_route_stop", {
      p_template_id: templateId,
      p_version: version,
      p_station_id: stationId,
      p_riddle_id: riddleId,
      p_actor: email,
      p_after_stop_id: typeof body.afterStopId === "string" ? body.afterStopId : null
    });
    if (error) throw error;
    return jsonOk({ routeStopId: data }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ templateId: string; version: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { templateId, version: rawVersion } = await context.params;
    const version = parseVersion(rawVersion);
    const body = await readJson<Record<string, unknown>>(request);
    const stopIds = Array.isArray(body.stopIds)
      ? body.stopIds.filter((item): item is string => typeof item === "string")
      : [];
    const { data, error } = await supabase.rpc("content_reorder_route_stops", {
      p_template_id: templateId,
      p_version: version,
      p_stop_ids: stopIds,
      p_actor: email
    });
    if (error) throw error;
    return jsonOk(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
