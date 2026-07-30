import { requireAdmin } from "@/lib/admin-auth";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";
import { suggestTranslation } from "@/lib/providers";
import { enforceRateLimit, requestIp } from "@/lib/rate-limit";
import { resolveAdminTenant } from "@/lib/tenant-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { supabase, email } = await requireAdmin(request);
    await enforceRateLimit({
      scope: "admin-assisted-translation",
      identifier: `${email}:${requestIp(request)}`,
      limit: 30,
      windowSeconds: 60 * 60
    });
    const body = await readJson<Record<string, unknown>>(request);
    const sourceText =
      typeof body.sourceText === "string" ? body.sourceText.trim() : "";
    const sourceLocale = body.sourceLocale === "en" ? "en" : "he";
    const targetLocale = body.targetLocale === "he" ? "he" : "en";
    const context =
      typeof body.context === "string" ? body.context.trim().slice(0, 500) : "";
    if (!sourceText || sourceText.length > 4000) {
      throw new Error("Translation source must contain 1–4000 characters");
    }
    if (sourceLocale === targetLocale) {
      throw new Error("Translation languages must be different");
    }
    const { tenantId } = await resolveAdminTenant({
      supabase,
      email,
      requestedTenantId:
        typeof body.tenantId === "string" ? body.tenantId : null
    });
    const result = await suggestTranslation({
      sourceText,
      sourceLocale,
      targetLocale,
      context
    });
    const { data, error } = await supabase
      .from("translation_suggestions")
      .insert({
        tenant_id: tenantId,
        source_locale: sourceLocale,
        target_locale: targetLocale,
        source_text: sourceText,
        suggested_text: result.text,
        provider: result.provider,
        model: result.model,
        context: { note: context || null },
        requested_by: email
      })
      .select("id,created_at")
      .single();
    if (error) throw error;
    return jsonOk({
      id: data.id,
      suggestion: result.text,
      provider: result.provider,
      model: result.model,
      reviewRequired: true,
      createdAt: data.created_at
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
