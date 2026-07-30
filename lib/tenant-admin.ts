import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export const LEGACY_TENANT_ID = "00000000-0000-4000-8000-000000000001";

export const resolveAdminTenant = async ({
  supabase,
  email,
  requestedTenantId
}: {
  supabase: SupabaseClient;
  email: string;
  requestedTenantId?: string | null;
}) => {
  const { data: memberships, error } = await supabase
    .from("tenant_memberships")
    .select("tenant_id,role")
    .eq("email", email)
    .order("created_at");
  if (error) throw error;

  const requested = requestedTenantId?.trim();
  const membership = requested
    ? memberships?.find((row) => row.tenant_id === requested)
    : memberships?.[0];
  if (requested && !membership) {
    throw new Error("Tenant access is not allowed");
  }
  return {
    tenantId: membership?.tenant_id ?? LEGACY_TENANT_ID,
    role: membership?.role ?? "owner"
  };
};
