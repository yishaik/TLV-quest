import { requireAdmin } from "@/lib/admin-auth";
import { AppError, handleRouteError, jsonOk, readJson } from "@/lib/http";
import { suggestTranslation } from "@/lib/providers";
import { enforceAdminRateLimit } from "@/lib/rate-limit";
import { resolveAdminTenant } from "@/lib/tenant-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SOURCE_CHARS = 4_000;

export async function POST(request: Request) {
  try {
    const { supabase, email } = await requireAdmin(request);
    await enforceAdminRateLimit("contentTranslate", email);
    const body = await readJson<Record<string, unknown>>(request);
    const sourceText =
      typeof body.sourceText === "string" ? body.sourceText.trim() : "";
    const sourceLocale = body.sourceLocale === "en" ? "en" : "he";
    const targetLocale = body.targetLocale === "he" ? "he" : "en";
    const context =
      typeof body.context === "string" ? body.context.trim().slice(0, 500) : "";

    // Typed AppErrors, not bare throws: handleRouteError redacts unknown errors
    // into a generic 500 (see docs/error-handling.md), which would turn these
    // author-facing validation messages into an unhelpful server error.
    if (!sourceText || sourceText.length > MAX_SOURCE_CHARS) {
      throw new AppError({
        message: `על טקסט המקור להכיל 1–${MAX_SOURCE_CHARS} תווים. / Translation source must contain 1–${MAX_SOURCE_CHARS} characters.`,
        status: 400,
        code: "invalid_translation_source"
      });
    }
    if (sourceLocale === targetLocale) {
      throw new AppError({
        message:
          "שפת המקור והיעד חייבות להיות שונות. / Source and target languages must differ.",
        status: 400,
        code: "invalid_translation_locales"
      });
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
      // Always true: CNT-07 keeps machine translation draft-only until a human
      // approves it, including the deterministic echo fallback.
      reviewRequired: true,
      createdAt: data.created_at
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
