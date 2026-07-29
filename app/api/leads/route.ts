import { createAdminClient } from "@/lib/supabase/admin";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";

export const runtime = "nodejs";

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > 12_000) throw new Error("Request is too large");

    const body = await readJson<Record<string, unknown>>(request);
    if (text(body.website, 200)) return jsonOk({ accepted: true });

    const name = text(body.name, 120);
    const email = text(body.email, 254).toLowerCase();
    const phone = text(body.phone, 40) || null;
    const eventType = text(body.eventType, 120) || null;
    const message = text(body.message, 1500) || null;
    const locale = body.locale === "en" ? "en" : "he";
    const preferredDate = /^\d{4}-\d{2}-\d{2}$/.test(text(body.preferredDate, 10))
      ? text(body.preferredDate, 10)
      : null;
    const estimatedParticipants =
      typeof body.estimatedParticipants === "number" &&
      Number.isInteger(body.estimatedParticipants) &&
      body.estimatedParticipants >= 1 &&
      body.estimatedParticipants <= 500
        ? body.estimatedParticipants
        : null;

    if (name.length < 2) throw new Error(locale === "he" ? "יש להזין שם מלא" : "Please enter your name");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(locale === "he" ? "כתובת האימייל אינה תקינה" : "Please enter a valid email address");
    }

    const supabase = createAdminClient();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: recent, error: recentError } = await supabase
      .from("marketing_leads")
      .select("id")
      .eq("email", email)
      .gte("created_at", tenMinutesAgo)
      .limit(1)
      .maybeSingle();
    if (recentError) throw recentError;
    if (recent) return jsonOk({ accepted: true, duplicate: true });

    const { error } = await supabase.from("marketing_leads").insert({
      name,
      email,
      phone,
      event_type: eventType,
      estimated_participants: estimatedParticipants,
      preferred_date: preferredDate,
      message,
      locale,
      source: "premium_landing",
      status: "new"
    });
    if (error) throw error;

    return jsonOk({ accepted: true }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
