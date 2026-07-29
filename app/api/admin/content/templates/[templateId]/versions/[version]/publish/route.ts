import { requireAdmin } from "@/lib/admin-auth";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ templateId: string; version: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { templateId, version: rawVersion } = await context.params;
    const version = Number(rawVersion);
    if (!Number.isInteger(version) || version < 1) {
      throw new Error("Invalid template version");
    }

    const body = await readJson<Record<string, unknown>>(request);
    const allowUnverified = body.allowUnverified === true;
    const { data, error } = await supabase.rpc("content_publish_version", {
      p_template_id: templateId,
      p_version: version,
      p_actor: email,
      p_allow_unverified: allowUnverified
    });
    if (error) throw error;

    return jsonOk(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
