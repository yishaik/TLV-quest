import { requireAdmin } from "@/lib/admin-auth";
import { normalizeContentSlug, objectValue } from "@/lib/content-os";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kinds = new Set(["text", "choice", "scan", "location", "photo", "hybrid", "finale"]);
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];

const defaultValidation = (kind: string) => {
  if (kind === "choice") return { type: "choice", options: [], acceptedOption: "" };
  if (kind === "photo") return { type: "photo", criteria: "", confidenceThreshold: 0.86 };
  if (kind === "scan") return { type: "scan" };
  return { type: "text", accepted: [], fuzzyThreshold: 0.94 };
};

export async function GET(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const stationId = new URL(request.url).searchParams.get("stationId");
    let query = supabase.from("content_riddles").select("*").order("updated_at", { ascending: false });
    if (stationId) query = query.eq("station_id", stationId);
    const { data, error } = await query;
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
    const stationId = typeof body.stationId === "string" ? body.stationId : "";
    if (!stationId) throw new Error("Station is required");
    const slug = normalizeContentSlug(String(body.slug ?? ""));
    if (!slug) throw new Error("Riddle slug is required and must use Latin letters or numbers");
    const kind = kinds.has(String(body.kind)) ? String(body.kind) : "text";
    const title = objectValue(body.title);
    const content = objectValue(body.content);

    const { data: station, error: stationError } = await supabase
      .from("content_stations")
      .select("id")
      .eq("id", stationId)
      .single();
    if (stationError || !station) throw stationError ?? new Error("Station was not found");

    const { data, error } = await supabase
      .from("content_riddles")
      .insert({
        station_id: stationId,
        slug,
        title: { he: String(title.he ?? "").trim(), en: String(title.en ?? "").trim() },
        kind,
        content: Object.keys(content).length
          ? content
          : {
              he: { title: String(title.he ?? "").trim(), story: "", prompt: "", locationHint: "", success: "" },
              en: { title: String(title.en ?? "").trim(), story: "", prompt: "", locationHint: "", success: "" }
            },
        validation: Object.keys(objectValue(body.validation)).length
          ? objectValue(body.validation)
          : defaultValidation(kind),
        hints: Array.isArray(body.hints) ? body.hints : [],
        scoring: Object.keys(objectValue(body.scoring)).length
          ? objectValue(body.scoring)
          : { basePoints: 100, wrongPenalty: 5, hintPenalty: 10, speedBonusMax: 20, speedBonusWindowSeconds: 420 },
        fallback: body.fallback === null ? null : objectValue(body.fallback),
        interaction: Object.keys(objectValue(body.interaction)).length
          ? objectValue(body.interaction)
          : { primary: kind === "photo" ? "photo" : "web", webFallback: true },
        tags: strings(body.tags),
        status: body.status === "active" ? "active" : "draft",
        created_by: email,
        updated_by: email
      })
      .select("*")
      .single();
    if (error || !data) throw error ?? new Error("Failed to create riddle");
    return jsonOk(data, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
