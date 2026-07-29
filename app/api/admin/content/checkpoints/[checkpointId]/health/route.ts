import { requireAdmin } from "@/lib/admin-auth";
import { objectValue } from "@/lib/content-os";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const healthStatuses = new Set([
  "not_required",
  "pending",
  "verified",
  "needs_attention",
  "blocked"
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ checkpointId: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { checkpointId } = await context.params;
    const body = await readJson<Record<string, unknown>>(request);
    const status = typeof body.status === "string" ? body.status : "";
    if (!healthStatuses.has(status)) throw new Error("Invalid health status");

    const { data: checkpoint, error: checkpointError } = await supabase
      .from("template_checkpoints")
      .select("id,template_id,version,slug")
      .eq("id", checkpointId)
      .single();
    if (checkpointError || !checkpoint) {
      throw checkpointError ?? new Error("Checkpoint was not found");
    }

    const now = new Date().toISOString();
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 4000) : null;
    const checklist = objectValue(body.checklist);
    const verified = status === "verified";

    const { data, error } = await supabase
      .from("checkpoint_health")
      .upsert(
        {
          checkpoint_id: checkpoint.id,
          template_id: checkpoint.template_id,
          version: checkpoint.version,
          status,
          checklist,
          notes,
          last_checked_at: now,
          verified_at: verified ? now : null,
          verified_by: verified ? email : null,
          updated_at: now,
          updated_by: email
        },
        { onConflict: "checkpoint_id" }
      )
      .select("checkpoint_id,status,checklist,notes,last_checked_at,verified_at,verified_by,updated_at,updated_by")
      .single();
    if (error || !data) throw error ?? new Error("Health status update failed");

    const { error: auditError } = await supabase.from("content_audit_log").insert({
      template_id: checkpoint.template_id,
      version: checkpoint.version,
      checkpoint_id: checkpoint.id,
      actor_email: email,
      action: "CHECKPOINT_HEALTH_UPDATED",
      payload: { slug: checkpoint.slug, status, checklist }
    });
    if (auditError) throw auditError;

    return jsonOk(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
