import { createRouteRun } from "@/lib/run-creation";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashSecret } from "@/lib/crypto";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let reservedInviteId: string | null = null;
  try {
    const body = await readJson<Record<string, unknown>>(request);
    const inviteToken =
      typeof body.inviteToken === "string" ? body.inviteToken : "";
    if (!inviteToken) throw new Error("A valid organizer invite is required");

    const templateSlug =
      typeof body.templateSlug === "string" ? body.templateSlug.trim() : "";
    if (!templateSlug) throw new Error("A published route must be selected");

    const supabase = createAdminClient();
    const now = new Date().toISOString();
    const { data: invite, error: inviteError } = await supabase
      .from("organizer_invites")
      .select("id,tenant_id,expires_at,used_at")
      .eq("token_hash", hashSecret(inviteToken))
      .maybeSingle();

    if (inviteError) throw inviteError;
    if (!invite || invite.used_at || invite.expires_at <= now) {
      throw new Error("Organizer invite is invalid or expired");
    }

    const { data: reserved, error: reserveError } = await supabase
      .from("organizer_invites")
      .update({ used_at: now })
      .eq("id", invite.id)
      .is("used_at", null)
      .select("id")
      .maybeSingle();
    if (reserveError) throw reserveError;
    if (!reserved) throw new Error("Organizer invite has already been used");
    reservedInviteId = reserved.id;

    const run = await createRouteRun({
      tenantId: invite.tenant_id,
      templateSlug,
      scheduledAt:
        typeof body.scheduledAt === "string" ? body.scheduledAt : null,
      routeMode:
        body.routeMode === "linear" ||
        body.routeMode === "circular" ||
        body.routeMode === "free"
          ? body.routeMode
          : "circular",
      startMode:
        body.startMode === "manual" ||
        body.startMode === "rolling" ||
        body.startMode === "scheduled"
          ? body.startMode
          : "scheduled",
      scoringMode:
        body.scoringMode === "completion" ||
        body.scoringMode === "time" ||
        body.scoringMode === "combined"
          ? body.scoringMode
          : "combined",
      teamMode:
        body.teamMode === "solo" ||
        body.teamMode === "preassigned" ||
        body.teamMode === "automatic"
          ? body.teamMode
          : "automatic",
      localeDefault: body.localeDefault === "en" ? "en" : "he",
      maxParticipants:
        typeof body.maxParticipants === "number" ? body.maxParticipants : 30,
      maxTeams: typeof body.maxTeams === "number" ? body.maxTeams : 10,
      graceMinutes:
        typeof body.graceMinutes === "number" ? body.graceMinutes : 10,
      desiredTeamSize:
        typeof body.desiredTeamSize === "number" ? body.desiredTeamSize : 4,
      organizerEmail:
        typeof body.organizerEmail === "string" ? body.organizerEmail : undefined,
      organizerPhone:
        typeof body.organizerPhone === "string" ? body.organizerPhone : undefined,
      settings:
        body.settings && typeof body.settings === "object"
          ? (body.settings as Record<string, unknown>)
          : undefined
    });

    return jsonOk(run, { status: 201 });
  } catch (error) {
    if (reservedInviteId) {
      await createAdminClient()
        .from("organizer_invites")
        .update({ used_at: null })
        .eq("id", reservedInviteId);
    }
    return handleRouteError(error);
  }
}
