import { createAdminClient } from "@/lib/supabase/admin";
import { handleRouteError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data: templates, error } = await supabase
      .from("game_templates")
      .select("id,slug,title,description,active_version,brand_key")
      .eq("is_active", true)
      .order("updated_at", { ascending: false });
    if (error) throw error;

    const routes = await Promise.all(
      (templates ?? []).map(async (template) => {
        const [versionResult, checkpointResult] = await Promise.all([
          supabase
            .from("template_versions")
            .select("status,release_name,published_at")
            .eq("template_id", template.id)
            .eq("version", template.active_version)
            .maybeSingle(),
          supabase
            .from("template_checkpoints")
            .select("id", { count: "exact", head: true })
            .eq("template_id", template.id)
            .eq("version", template.active_version)
            .eq("is_active", true)
        ]);
        if (versionResult.error) throw versionResult.error;
        if (checkpointResult.error) throw checkpointResult.error;
        if (versionResult.data?.status !== "published") return null;

        return {
          slug: template.slug,
          title: template.title,
          description: template.description,
          version: template.active_version,
          brandKey: template.brand_key,
          releaseName: versionResult.data.release_name,
          publishedAt: versionResult.data.published_at,
          checkpointCount: checkpointResult.count ?? 0
        };
      })
    );

    return jsonOk(routes.filter(Boolean));
  } catch (error) {
    return handleRouteError(error);
  }
}
