import { requireAdmin } from "@/lib/admin-auth";
import { handleRouteError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const [stationsResult, riddlesResult, stopsResult] = await Promise.all([
      supabase
        .from("content_stations")
        .select("id,slug,brand_key,title,description,address,latitude,longitude,radius_meters,hero_image_path,hero_image_url,gallery,tags,accessibility,field_verification_required,health_status,health_checklist,health_notes,last_checked_at,verified_at,verified_by,status,created_at,updated_at")
        .order("updated_at", { ascending: false }),
      supabase
        .from("content_riddles")
        .select("id,station_id,slug,title,kind,content,validation,hints,scoring,fallback,interaction,hero_image_path,hero_image_url,tags,status,created_at,updated_at")
        .order("updated_at", { ascending: false }),
      supabase
        .from("content_route_stops")
        .select("id,template_id,version,station_id,riddle_id,slug,sequence_no,is_optional,is_active,overrides,created_at,updated_at")
        .order("template_id")
        .order("version")
        .order("sequence_no")
    ]);

    if (stationsResult.error) throw stationsResult.error;
    if (riddlesResult.error) throw riddlesResult.error;
    if (stopsResult.error) throw stopsResult.error;

    return jsonOk({
      stations: stationsResult.data ?? [],
      riddles: riddlesResult.data ?? [],
      routeStops: stopsResult.data ?? []
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
