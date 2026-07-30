import { requireAdmin } from "@/lib/admin-auth";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";
import { resolveAdminTenant } from "@/lib/tenant-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const safeColor = (value: unknown) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : undefined;

const safeLogoUrl = (value: unknown) =>
  typeof value === "string" &&
  (value.startsWith("/") || /^https:\/\/[^'"<>\s]+$/i.test(value))
    ? value.slice(0, 1000)
    : undefined;

export async function GET(request: Request) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const requestedTenantId = new URL(request.url).searchParams.get("tenantId");
    const { tenantId, role } = await resolveAdminTenant({
      supabase,
      email,
      requestedTenantId
    });
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [
      tenantResult,
      membershipsResult,
      usageResult,
      runsResult,
      templatesResult,
      anomaliesResult
    ] = await Promise.all([
      supabase
        .from("organizer_tenants")
        .select(
          "id,slug,name,plan,monthly_run_quota,active_run_quota,participant_quota,storage_mb_quota,branding,is_active,created_at,updated_at"
        )
        .eq("id", tenantId)
        .single(),
      supabase
        .from("tenant_memberships")
        .select("email,role,created_at")
        .eq("tenant_id", tenantId)
        .order("created_at"),
      supabase
        .from("tenant_usage_events")
        .select("kind,quantity,occurred_at")
        .eq("tenant_id", tenantId)
        .gte("occurred_at", monthStart.toISOString())
        .limit(10000),
      supabase
        .from("game_runs")
        .select(
          "id,public_code,status,max_participants,created_at,scheduled_at"
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("game_templates")
        .select("id,slug,title,is_active,active_version,updated_at")
        .eq("tenant_id", tenantId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("operational_anomalies")
        .select(
          "id,run_id,team_id,kind,severity,status,evidence,first_detected_at,last_detected_at,occurrences,resolved_at"
        )
        .eq("tenant_id", tenantId)
        .order("last_detected_at", { ascending: false })
        .limit(100)
    ]);
    for (const result of [
      tenantResult,
      membershipsResult,
      usageResult,
      runsResult,
      templatesResult,
      anomaliesResult
    ]) {
      if (result.error) throw result.error;
    }

    const usage = (usageResult.data ?? []).reduce(
      (summary, event) => {
        const quantity = Number(event.quantity) || 0;
        if (event.kind === "run_created") summary.runs += quantity;
        if (event.kind === "participant_joined") summary.participants += quantity;
        if (event.kind === "storage_bytes") summary.storageBytes += quantity;
        if (event.kind === "ai_request") summary.aiRequests += quantity;
        return summary;
      },
      { runs: 0, participants: 0, storageBytes: 0, aiRequests: 0 }
    );
    const activeRuns = (runsResult.data ?? []).filter((run) =>
      ["draft", "registration_open", "ready", "active", "paused"].includes(
        run.status
      )
    ).length;

    return jsonOk({
      tenant: tenantResult.data,
      access: { email, role },
      memberships: membershipsResult.data ?? [],
      usage: { ...usage, activeRuns, monthStart: monthStart.toISOString() },
      runs: runsResult.data ?? [],
      templates: templatesResult.data ?? [],
      anomalies: anomaliesResult.data ?? []
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const body = await readJson<Record<string, unknown>>(request);
    const { tenantId, role } = await resolveAdminTenant({
      supabase,
      email,
      requestedTenantId:
        typeof body.tenantId === "string" ? body.tenantId : null
    });
    if (!["owner", "admin"].includes(role)) {
      throw new Error("Tenant admin access is not allowed");
    }

    if (typeof body.anomalyId === "string") {
      const status =
        body.status === "resolved" ? "resolved" : "acknowledged";
      const { data, error } = await supabase
        .from("operational_anomalies")
        .update({
          status,
          resolved_at: status === "resolved" ? new Date().toISOString() : null
        })
        .eq("id", body.anomalyId)
        .eq("tenant_id", tenantId)
        .select("id,status,resolved_at")
        .single();
      if (error) throw error;
      return jsonOk(data);
    }

    const brandingInput = objectValue(body.branding);
    const { data: current, error: currentError } = await supabase
      .from("organizer_tenants")
      .select("branding")
      .eq("id", tenantId)
      .single();
    if (currentError) throw currentError;
    const currentBranding = objectValue(current.branding);
    const productName =
      typeof brandingInput.productName === "string"
        ? brandingInput.productName.trim().slice(0, 80)
        : undefined;
    const nextBranding = {
      ...currentBranding,
      ...(productName ? { productName } : {}),
      ...(safeColor(brandingInput.primaryColor)
        ? { primaryColor: safeColor(brandingInput.primaryColor) }
        : {}),
      ...(safeColor(brandingInput.surfaceColor)
        ? { surfaceColor: safeColor(brandingInput.surfaceColor) }
        : {}),
      ...(safeLogoUrl(brandingInput.logoUrl)
        ? { logoUrl: safeLogoUrl(brandingInput.logoUrl) }
        : {})
    };
    const { data, error } = await supabase
      .from("organizer_tenants")
      .update({
        branding: nextBranding,
        updated_at: new Date().toISOString()
      })
      .eq("id", tenantId)
      .select("id,branding,updated_at")
      .single();
    if (error) throw error;
    return jsonOk(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
