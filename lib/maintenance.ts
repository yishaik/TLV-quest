import "server-only";

import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { processOutbox } from "@/lib/providers";
import {
  applyAdaptiveDifficulty,
  sendDueHints,
  startDueRuns
} from "@/lib/automation";

export const purgeExpiredRunsWithStorage = async () => {
  const supabase = createAdminClient();
  const { data: runs, error: runError } = await supabase
    .from("game_runs")
    .select("id")
    .in("status", ["finished", "cancelled"])
    .not("retention_until", "is", null)
    .lte("retention_until", new Date().toISOString())
    .limit(50);
  if (runError) throw runError;

  const runIds = (runs ?? []).map((run) => run.id);
  if (!runIds.length) return { runsDeleted: 0, filesDeleted: 0 };

  const { data: media, error: mediaError } = await supabase
    .from("media_assets")
    .select("storage_path")
    .in("run_id", runIds);
  if (mediaError) throw mediaError;

  const paths = (media ?? []).map((asset) => asset.storage_path);
  let filesDeleted = 0;
  for (let index = 0; index < paths.length; index += 100) {
    const batch = paths.slice(index, index + 100);
    const { error } = await supabase.storage.from("game-media").remove(batch);
    if (error) throw error;
    filesDeleted += batch.length;
  }

  const { data: runsDeleted, error: purgeError } = await supabase.rpc(
    "purge_expired_run_data"
  );
  if (purgeError) throw purgeError;

  return { runsDeleted: runsDeleted ?? 0, filesDeleted };
};

const cleanupOperationalRows = async () => {
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString();
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60_000
  ).toISOString();
  const [
    presence,
    authorizations,
    realtimeEvents,
    rateLimits,
    maintenanceHistory,
    anomalyHistory
  ] = await Promise.all([
    supabase
      .from("quest_presence")
      .delete({ count: "exact" })
      .lt("expires_at", now),
    supabase
      .from("realtime_participant_authorizations")
      .delete({ count: "exact" })
      .lt("expires_at", now),
    supabase
      .from("quest_realtime_events")
      .delete({ count: "exact" })
      .lt("created_at", threeDaysAgo),
    supabase
      .from("rate_limit_buckets")
      .delete({ count: "exact" })
      .lt("updated_at", threeDaysAgo),
    supabase
      .from("maintenance_runs")
      .delete({ count: "exact" })
      .lt("started_at", thirtyDaysAgo),
    supabase
      .from("operational_anomalies")
      .delete({ count: "exact" })
      .eq("status", "resolved")
      .lt("resolved_at", thirtyDaysAgo)
  ]);
  const failed = [
    presence,
    authorizations,
    realtimeEvents,
    rateLimits,
    maintenanceHistory,
    anomalyHistory
  ].find((result) => result.error);
  if (failed?.error) throw failed.error;

  return {
    presence: presence.count ?? 0,
    authorizations: authorizations.count ?? 0,
    realtimeEvents: realtimeEvents.count ?? 0,
    rateLimits: rateLimits.count ?? 0,
    maintenanceHistory: maintenanceHistory.count ?? 0,
    anomalyHistory: anomalyHistory.count ?? 0
  };
};

export const detectOperationalAnomalies = async () => {
  const supabase = createAdminClient();
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - 15 * 60_000).toISOString();
  const failureCutoff = new Date(now.getTime() - 60 * 60_000).toISOString();
  const [{ data: runs, error: runError }, { data: rateBuckets, error: rateError }] =
    await Promise.all([
      supabase
        .from("game_runs")
        .select("id,tenant_id")
        .in("status", ["active", "paused"]),
      supabase
        .from("rate_limit_buckets")
        .select("bucket_key,request_count,updated_at")
        .gte("updated_at", failureCutoff)
        .gte("request_count", 50)
        .limit(100)
    ]);
  if (runError) throw runError;
  if (rateError) throw rateError;

  const runIds = (runs ?? []).map((run) => run.id);
  const tenantByRun = new Map(
    (runs ?? []).map((run) => [run.id, run.tenant_id])
  );
  const detected = new Set<string>();
  const candidates: Array<{
    tenant_id: string;
    run_id: string | null;
    team_id: string | null;
    kind: string;
    severity: "info" | "warning" | "critical";
    fingerprint: string;
    evidence: Record<string, unknown>;
  }> = [];

  if (runIds.length) {
    const [{ data: staleTeams, error: staleError }, { data: failed, error: failedError }] =
      await Promise.all([
        supabase
          .from("teams")
          .select(
            "id,run_id,current_checkpoint_slug,last_progress_at,wrong_attempts,hints_used"
          )
          .in("run_id", runIds)
          .in("status", ["travelling", "solving"])
          .not("last_progress_at", "is", null)
          .lte("last_progress_at", staleCutoff),
        supabase
          .from("message_outbox")
          .select("id,run_id,last_error,attempts,created_at")
          .in("run_id", runIds)
          .eq("status", "failed")
          .gte("created_at", failureCutoff)
      ]);
    if (staleError) throw staleError;
    if (failedError) throw failedError;

    for (const team of staleTeams ?? []) {
      const fingerprint = `stuck-team:${team.run_id}:${team.id}`;
      const tenantId = tenantByRun.get(team.run_id);
      if (!tenantId) continue;
      detected.add(fingerprint);
      candidates.push({
        tenant_id: tenantId,
        run_id: team.run_id,
        team_id: team.id,
        kind: "stuck_team",
        severity: team.wrong_attempts >= 4 ? "critical" : "warning",
        fingerprint,
        evidence: {
          checkpointSlug: team.current_checkpoint_slug,
          lastProgressAt: team.last_progress_at,
          wrongAttempts: team.wrong_attempts,
          hintsUsed: team.hints_used
        }
      });
    }

    const failuresByRun = new Map<
      string,
      Array<{ id: string; last_error: string | null; attempts: number }>
    >();
    for (const message of failed ?? []) {
      if (!message.run_id) continue;
      const rows = failuresByRun.get(message.run_id) ?? [];
      rows.push(message);
      failuresByRun.set(message.run_id, rows);
    }
    for (const [runId, messages] of failuresByRun) {
      if (messages.length < 5) continue;
      const tenantId = tenantByRun.get(runId);
      if (!tenantId) continue;
      const fingerprint = `outbox-failure-spike:${runId}`;
      detected.add(fingerprint);
      candidates.push({
        tenant_id: tenantId,
        run_id: runId,
        team_id: null,
        kind: "outbox_failure_spike",
        severity: messages.length >= 15 ? "critical" : "warning",
        fingerprint,
        evidence: {
          failuresLastHour: messages.length,
          sample: messages.slice(0, 5)
        }
      });
    }
  }

  if ((rateBuckets ?? []).length) {
    const fingerprint = "rate-limit-spike:global";
    detected.add(fingerprint);
    candidates.push({
      tenant_id: "00000000-0000-4000-8000-000000000001",
      run_id: null,
      team_id: null,
      kind: "rate_limit_spike",
      severity: (rateBuckets ?? []).length >= 20 ? "critical" : "warning",
      fingerprint,
      evidence: {
        hotBucketCount: rateBuckets?.length ?? 0,
        bucketKeys: (rateBuckets ?? [])
          .slice(0, 10)
          .map((bucket) => bucket.bucket_key.slice(0, 12))
      }
    });
  }

  for (const candidate of candidates) {
    const { data: existing, error: existingError } = await supabase
      .from("operational_anomalies")
      .select("id,occurrences")
      .eq("fingerprint", candidate.fingerprint)
      .maybeSingle();
    if (existingError) throw existingError;
    const { error } = existing
      ? await supabase
          .from("operational_anomalies")
          .update({
            severity: candidate.severity,
            status: "open",
            evidence: candidate.evidence,
            last_detected_at: now.toISOString(),
            occurrences: existing.occurrences + 1,
            resolved_at: null
          })
          .eq("id", existing.id)
      : await supabase.from("operational_anomalies").insert(candidate);
    if (error) throw error;
    if (!existing && candidate.severity === "critical") {
      Sentry.captureMessage(`Operational anomaly: ${candidate.kind}`, {
        level: "error",
        tags: {
          anomaly_kind: candidate.kind,
          run_id: candidate.run_id ?? "global"
        },
        extra: candidate.evidence
      });
    }
  }

  const { data: open, error: openError } = await supabase
    .from("operational_anomalies")
    .select("id,fingerprint")
    .eq("status", "open")
    .in("kind", ["stuck_team", "outbox_failure_spike", "rate_limit_spike"]);
  if (openError) throw openError;
  const resolvedIds = (open ?? [])
    .filter((row) => !detected.has(row.fingerprint))
    .map((row) => row.id);
  if (resolvedIds.length) {
    const { error } = await supabase
      .from("operational_anomalies")
      .update({ status: "resolved", resolved_at: now.toISOString() })
      .in("id", resolvedIds);
    if (error) throw error;
  }

  return {
    detected: candidates.length,
    resolved: resolvedIds.length,
    critical: candidates.filter((candidate) => candidate.severity === "critical")
      .length
  };
};

export const runMaintenanceWorker = async () => {
  const correlationId = randomUUID();
  const supabase = createAdminClient();
  const checkInId = Sentry.captureCheckIn({
    monitorSlug: "tlv-quest-maintenance",
    status: "in_progress"
  });
  const { data: maintenanceRun, error: createError } = await supabase
    .from("maintenance_runs")
    .insert({ correlation_id: correlationId })
    .select("id")
    .single();
  if (createError || !maintenanceRun) {
    throw createError ?? new Error("Failed to create maintenance run");
  }

  const stages: Record<
    string,
    { status: "succeeded" | "failed"; result?: unknown; error?: string }
  > = {};
  const failures: string[] = [];

  const persist = async () => {
    const { error } = await supabase
      .from("maintenance_runs")
      .update({ stages })
      .eq("id", maintenanceRun.id);
    if (error) throw error;
  };

  const stage = async <T>(name: string, operation: () => Promise<T>) => {
    try {
      const result = await operation();
      stages[name] = { status: "succeeded", result };
      await persist();
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown maintenance error";
      stages[name] = { status: "failed", error: message.slice(0, 500) };
      failures.push(`${name}: ${message}`);
      Sentry.captureException(error, {
        tags: { maintenance_stage: name, correlation_id: correlationId }
      });
      await persist();
      return null;
    }
  };

  await stage("scheduled_starts", startDueRuns);
  await stage("adaptive_difficulty", applyAdaptiveDifficulty);
  await stage("automatic_hints", sendDueHints);
  await stage("message_outbox", async () => {
    const results = await processOutbox(30);
    return {
      processed: results.length,
      failed: results.filter((result) => result.status === "failed").length
    };
  });
  await stage("anonymous_metrics", async () => {
    const { data, error } = await supabase.rpc("record_completed_run_metrics", {
      batch_size: 50
    });
    if (error) throw error;
    return { recorded: data ?? 0 };
  });
  await stage("retention", purgeExpiredRunsWithStorage);
  await stage("anomaly_detection", detectOperationalAnomalies);
  await stage("operational_cleanup", cleanupOperationalRows);

  const status = failures.length ? "failed" : "succeeded";
  const { error: finishError } = await supabase
    .from("maintenance_runs")
    .update({
      status,
      stages,
      error_summary: failures.length ? failures.join("\n").slice(0, 2000) : null,
      finished_at: new Date().toISOString()
    })
    .eq("id", maintenanceRun.id);
  if (finishError) throw finishError;

  if (failures.length) {
    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: "tlv-quest-maintenance",
      status: "error"
    });
    throw new Error(`Maintenance failed (${correlationId}): ${failures.join("; ")}`);
  }

  Sentry.captureCheckIn({
    checkInId,
    monitorSlug: "tlv-quest-maintenance",
    status: "ok"
  });
  return {
    correlationId,
    status,
    stages
  };
};
