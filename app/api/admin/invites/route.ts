import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashSecret, randomToken } from "@/lib/crypto";
import { getServerEnv, publicEnv } from "@/lib/env";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";
import {
  LEGACY_TENANT_ID,
  resolveAdminTenant
} from "@/lib/tenant-admin";

export const runtime = "nodejs";

const authorizeInviteCreation = async (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  const apiSecret = process.env.ADMIN_API_SECRET?.trim();

  if (apiSecret && authorization === `Bearer ${apiSecret}`) {
    return {
      supabase: createAdminClient(),
      email: null as string | null
    };
  }

  const { supabase, email } = await requireAdmin(request);
  return { supabase, email };
};

export async function POST(request: Request) {
  try {
    const authorization = await authorizeInviteCreation(request);
    const { supabase, email } = authorization;
    const body = await readJson<{
      expiresInHours?: unknown;
      tenantId?: unknown;
    }>(request);
    const tenantId = email
      ? (
          await resolveAdminTenant({
            supabase,
            email,
            requestedTenantId:
              typeof body.tenantId === "string" ? body.tenantId : null
          })
        ).tenantId
      : LEGACY_TENANT_ID;
    const expiresInHours =
      typeof body.expiresInHours === "number"
        ? Math.max(1, Math.min(168, body.expiresInHours))
        : 48;

    const token = randomToken(24);
    const expiresAt = new Date(
      Date.now() + expiresInHours * 60 * 60 * 1000
    ).toISOString();
    const { data, error } = await supabase
      .from("organizer_invites")
      .insert({
        token_hash: hashSecret(token),
        expires_at: expiresAt,
        tenant_id: tenantId
      })
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
