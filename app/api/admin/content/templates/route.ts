import { requireAdmin } from "@/lib/admin-auth";
import { handleRouteError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const [templatesResult, versionsResult, checkpointsResult, healthResult] =
      await Promise.all([
        supabase
          .from("game_templates")
          .select("id,slug,brand_key,title,description,active_version,is_active,created_at,updated_at")
          .order("updated_at", { ascending: false }),
        supabase
          .from("template_versions")
          .select("template_id,version,status,release_name,release_notes,validation_report,created_by,updated_by,published_by,created_at,updated_at,published_at")
          .order("version", { ascending: false }),
        supabase
          .from("template_checkpoints")
          .select("id,template_id,version,is_active"),
        supabase
          .from("checkpoint_health")
          .select("checkpoint_id,template_id,version,status")
      ]);

    if (templatesResult.error) throw templatesResult.error;
    if (versionsResult.error) throw versionsResult.error;
    if (checkpointsResult.error) throw checkpointsResult.error;
    if (healthResult.error) throw healthResult.error;

    const checkpoints = checkpointsResult.data ?? [];
    const health = healthResult.data ?? [];

    const templates = (templatesResult.data ?? []).map((template) => ({
      ...template,
      versions: (versionsResult.data ?? [])
        .filter((version) => version.template_id === template.id)
        .map((version) => {
          const versionCheckpoints = checkpoints.filter(
            (checkpoint) =>
              checkpoint.template_id === template.id &&
              checkpoint.version === version.version &&
              checkpoint.is_active
          );
          const checkpointIds = new Set(
            versionCheckpoints.map((checkpoint) => checkpoint.id)
          );
          const versionHealth = health.filter((item) =>
            checkpointIds.has(item.checkpoint_id)
          );

          return {
            ...version,
            checkpointCount: versionCheckpoints.length,
            health: {
              verified: versionHealth.filter((item) => item.status === "verified")
                .length,
              pending: versionHealth.filter((item) => item.status === "pending")
                .length,
              attention: versionHealth.filter((item) =>
                ["needs_attention", "blocked"].includes(item.status)
              ).length
            }
          };
        })
    }));

    return jsonOk(templates);
  } catch (error) {
    return handleRouteError(error);
  }
}
