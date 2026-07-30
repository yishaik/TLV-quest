import { requireAdmin } from "@/lib/admin-auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import { sentryRuntimeStatus } from "@/lib/sentry-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { supabase, email } = await requireAdmin(request);
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60_000).toISOString();
    const now = new Date().toISOString();

    const [
      failedOutbox,
      pendingOutbox,
      staleTeams,
      overdueRuns,
      recentEvents,
      recentRuns
    ] = await Promise.all([
      supabase
        .from("message_outbox")
        .select("id,channel,attempts,last_error,created_at", { count: "exact" })
        .eq("status", "failed")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("message_outbox")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "processing"])
        .lt("created_at", fifteenMinutesAgo),
      supabase
        .from("teams")
        .select("id,run_id,public_name,status,last_progress_at")
        .in("status", ["travelling", "solving"])
        .lt("last_progress_at", fifteenMinutesAgo)
        .limit(20),
      supabase
        .from("game_runs")
        .select("id,public_code,status,retention_until")
        .in("status", ["finished", "cancelled"])
        .lte("retention_until", now)
        .limit(20),
      supabase
        .from("game_events")
        .select("event_type,created_at,run_id,team_id")
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("game_runs")
        .select("id,public_code,status,created_at,scheduled_at,max_participants")
        .order("created_at", { ascending: false })
        .limit(20)
    ]);

    return jsonOk({
      admin: email,
      checkedAt: now,
      observability: sentryRuntimeStatus(process.env),
      summary: {
        failedMessages: failedOutbox.count ?? 0,
        delayedMessages: pendingOutbox.count ?? 0,
        staleTeams: staleTeams.data?.length ?? 0,
        overdueRetentionRuns: overdueRuns.data?.length ?? 0
      },
      failedMessages: failedOutbox.data ?? [],
      staleTeams: staleTeams.data ?? [],
      overdueRuns: overdueRuns.data ?? [],
      recentEvents: recentEvents.data ?? [],
      recentRuns: recentRuns.data ?? []
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
