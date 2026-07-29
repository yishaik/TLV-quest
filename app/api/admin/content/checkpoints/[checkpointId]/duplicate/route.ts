import { requireAdmin } from "@/lib/admin-auth";
import { handleRouteError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ checkpointId: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { checkpointId } = await context.params;
    const { data, error } = await supabase.rpc("content_duplicate_checkpoint", {
      p_checkpoint_id: checkpointId,
      p_actor: email
    });
    if (error) throw error;
    return jsonOk({ checkpointId: String(data) }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
