import { requireAdmin } from "@/lib/admin-auth";
import { normalizeContentSlug, objectValue, textValue } from "@/lib/content-os";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ templateId: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { templateId } = await context.params;
    const body = await readJson<Record<string, unknown>>(request);
    const title = objectValue(body.title);
    const description = objectValue(body.description);
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.slug !== undefined) {
      const slug = normalizeContentSlug(textValue(body.slug));
      if (!slug) throw new Error("Route slug is required and must use Latin letters or numbers");
      updates.slug = slug;
    }
    if (body.brandKey !== undefined) {
      updates.brand_key = textValue(body.brandKey).trim() || "tlv-quest";
    }
    if (body.title !== undefined) {
      const titleHe = textValue(title.he).trim();
      const titleEn = textValue(title.en).trim();
      if (!titleHe && !titleEn) throw new Error("At least one route title is required");
      updates.title = { he: titleHe, en: titleEn };
    }
    if (body.description !== undefined) {
      updates.description = {
        he: textValue(description.he).trim(),
        en: textValue(description.en).trim()
      };
    }

    if (Object.keys(updates).length === 1) throw new Error("No route changes supplied");

    const { data, error } = await supabase
      .from("game_templates")
      .update(updates)
      .eq("id", templateId)
      .select("id,slug,brand_key,title,description,active_version,is_active,created_at,updated_at")
      .single();
    if (error || !data) throw error ?? new Error("Route was not found");

    const { error: auditError } = await supabase.from("content_audit_log").insert({
      template_id: templateId,
      actor_email: email,
      action: "TEMPLATE_METADATA_UPDATED",
      payload: { fields: Object.keys(updates).filter((field) => field !== "updated_at") }
    });
    if (auditError) throw auditError;

    return jsonOk(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ templateId: string }> }
) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const { templateId } = await context.params;
    const { data, error } = await supabase.rpc("content_delete_template", {
      p_template_id: templateId,
      p_actor: email
    });
    if (error) throw error;
    return jsonOk(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
