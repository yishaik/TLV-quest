import { requireAdmin } from "@/lib/admin-auth";
import { handleRouteError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ checkpointId: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { checkpointId } = await context.params;
    const { data, error } = await supabase.rpc("content_delete_checkpoint", {
      p_checkpoint_id: checkpointId,
      p_actor: email
    });
    if (error) throw error;
    return jsonOk(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
