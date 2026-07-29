import { requireAdmin } from "@/lib/admin-auth";
import { normalizeContentSlug, numberOrNull, objectValue } from "@/lib/content-os";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];

export async function GET(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const { data, error } = await supabase
      .from("content_stations")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return jsonOk(data ?? []);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const body = await readJson<Record<string, unknown>>(request);
    const slug = normalizeContentSlug(String(body.slug ?? ""));
    if (!slug) throw new Error("Station slug is required and must use Latin letters or numbers");

    const title = objectValue(body.title);
    const description = objectValue(body.description);
    if (!String(title.he ?? "").trim() && !String(title.en ?? "").trim()) {
      throw new Error("At least one station title is required");
    }

    const fieldRequired = body.fieldVerificationRequired === true;
    const { data, error } = await supabase
      .from("content_stations")
      .insert({
        slug,
        brand_key: typeof body.brandKey === "string" && body.brandKey.trim() ? body.brandKey.trim() : "tlv-quest",
        title: { he: String(title.he ?? "").trim(), en: String(title.en ?? "").trim() },
        description: {
          he: String(description.he ?? "").trim(),
          en: String(description.en ?? "").trim()
        },
        address: objectValue(body.address),
        latitude: numberOrNull(body.latitude),
        longitude: numberOrNull(body.longitude),
        radius_meters: numberOrNull(body.radiusMeters),
        tags: strings(body.tags),
        accessibility: objectValue(body.accessibility),
        field_verification_required: fieldRequired,
        health_status: fieldRequired ? "pending" : "not_required",
        status: body.status === "active" ? "active" : "draft",
        created_by: email,
        updated_by: email
      })
      .select("*")
      .single();
    if (error || !data) throw error ?? new Error("Failed to create station");
    return jsonOk(data, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
