import { requireAdmin } from "@/lib/admin-auth";
import { objectValue, textValue } from "@/lib/content-os";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const [
      templatesResult,
      versionsResult,
      checkpointsResult,
      healthResult,
      runsResult
    ] = await Promise.all([
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
        .select("checkpoint_id,template_id,version,status"),
      supabase
        .from("game_runs")
        .select("template_id,template_version,status")
    ]);

    if (templatesResult.error) throw templatesResult.error;
    if (versionsResult.error) throw versionsResult.error;
    if (checkpointsResult.error) throw checkpointsResult.error;
    if (healthResult.error) throw healthResult.error;
    if (runsResult.error) throw runsResult.error;

    const checkpoints = checkpointsResult.data ?? [];
    const health = healthResult.data ?? [];
    const runs = runsResult.data ?? [];

    const templates = (templatesResult.data ?? []).map((template) => {
      const templateRuns = runs.filter((run) => run.template_id === template.id);
      const versions = (versionsResult.data ?? [])
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
          const versionRuns = templateRuns.filter(
            (run) => run.template_version === version.version
          );
          const activeRunCount = versionRuns.filter(
            (run) => !["finished", "cancelled"].includes(run.status)
          ).length;
          const isActiveVersion =
            template.is_active && template.active_version === version.version;
          const canDelete =
            !isActiveVersion &&
            version.status !== "published" &&
            versionRuns.length === 0 &&
            (versionsResult.data ?? []).filter(
              (candidate) => candidate.template_id === template.id
            ).length > 1;

          return {
            ...version,
            checkpointCount: versionCheckpoints.length,
            runCount: versionRuns.length,
            activeRunCount,
            isActiveVersion,
            canDelete,
            deleteBlockReason: canDelete
              ? null
              : isActiveVersion || version.status === "published"
                ? "גרסת הייצור הפעילה אינה ניתנת למחיקה"
                : versionRuns.length > 0
                  ? "הגרסה משויכת להרצות קיימות"
                  : "לא ניתן למחוק את הגרסה האחרונה במסלול",
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
        });

      const hasPublishedHistory = versions.some((version) =>
        ["published", "superseded"].includes(version.status)
      );

      return {
        ...template,
        runCount: templateRuns.length,
        activeRunCount: templateRuns.filter(
          (run) => !["finished", "cancelled"].includes(run.status)
        ).length,
        canDelete: templateRuns.length === 0 && !hasPublishedHistory,
        deleteBlockReason:
          templateRuns.length > 0
            ? "המסלול משויך להרצות קיימות"
            : hasPublishedHistory
              ? "מסלול שפורסם נשמר כהיסטוריה ולא ניתן למחיקה"
              : null,
        versions
      };
    });

    return jsonOk(templates);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const body = await readJson<Record<string, unknown>>(request);
    const title = objectValue(body.title);
    const description = objectValue(body.description);
    const slug = textValue(body.slug).trim();
    const brandKey = textValue(body.brandKey, "tlv-quest").trim();

    const { data, error } = await supabase.rpc("content_create_template", {
      p_slug: slug,
      p_title_he: textValue(title.he),
      p_title_en: textValue(title.en),
      p_description_he: textValue(description.he),
      p_description_en: textValue(description.en),
      p_actor: email,
      p_brand_key: brandKey || "tlv-quest"
    });

    if (error) throw error;
    return jsonOk(data, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
