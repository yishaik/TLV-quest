import { requireAdmin } from "@/lib/admin-auth";
import { handleRouteError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ templateId: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { templateId } = await context.params;
    const { data, error } = await supabase.rpc("content_create_draft", {
      p_template_id: templateId,
      p_actor: email
    });

    if (error) throw error;
    return jsonOk({ version: Number(data) });
  } catch (error) {
    return handleRouteError(error);
  }
}
