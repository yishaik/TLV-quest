import { requireAdmin } from "@/lib/admin-auth";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ templateId: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { templateId } = await context.params;
    const body = await readJson<Record<string, unknown>>(request);
    const sourceVersion = Number(body.sourceVersion);
    const useSourceVersion = Number.isInteger(sourceVersion) && sourceVersion > 0;
    const { data, error } = useSourceVersion
      ? await supabase.rpc("content_clone_version", {
          p_template_id: templateId,
          p_source_version: sourceVersion,
          p_actor: email
        })
      : await supabase.rpc("content_create_draft", {
          p_template_id: templateId,
          p_actor: email
        });

    if (error) throw error;
    return jsonOk({ version: Number(data), sourceVersion: useSourceVersion ? sourceVersion : null });
  } catch (error) {
    return handleRouteError(error);
  }
}
