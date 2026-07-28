import { createAdminClient } from "@/lib/supabase/admin";
import { hashSecret, randomToken } from "@/lib/crypto";
import { getServerEnv, publicEnv } from "@/lib/env";
import { handleRouteError, jsonOk, readJson, requireBearer } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireBearer(request, process.env.ADMIN_API_SECRET);
    const body = await readJson<{ expiresInHours?: unknown }>(request);
    const expiresInHours =
      typeof body.expiresInHours === "number"
        ? Math.max(1, Math.min(168, body.expiresInHours))
        : 48;

    const token = randomToken(24);
    const expiresAt = new Date(
      Date.now() + expiresInHours * 60 * 60 * 1000
    ).toISOString();
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("organizer_invites")
      .insert({ token_hash: hashSecret(token), expires_at: expiresAt })
      .select("id,expires_at")
      .single();

    if (error || !data) throw error ?? new Error("Failed to create invite");

    return jsonOk({
      id: data.id,
      expiresAt: data.expires_at,
      inviteToken: token,
      createUrl: `${publicEnv.appUrl}/create?invite=${encodeURIComponent(token)}`,
      externalMessagesEnabled: getServerEnv().enableExternalMessages
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
