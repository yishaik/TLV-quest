type JsonRecord = Record<string, unknown>;

export type LiveOpsTeamRow = {
  id: string;
  status: string;
  last_progress_at: string | null;
  started_at: string | null;
  [key: string]: unknown;
};

export type LiveOpsPresenceRow = {
  team_id: string | null;
  participant_id: string;
};

export type LiveOpsCheckpointRow = {
  id: string;
  source_checkpoint_id: string | null;
  kind: string;
  is_disabled: boolean;
  fallback_checkpoint: unknown;
  [key: string]: unknown;
};

export type CheckpointFieldHealth = {
  status: string;
  notes: string | null;
  lastCheckedAt: string | null;
};

export type LiveOpsOutboxRow = {
  status: string;
  provider_status?: string | null;
};

const recordValue = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

export const stuckThresholdFromSettings = (settings: unknown): number => {
  const values = recordValue(settings);
  const configured =
    typeof values.stuck_threshold_minutes === "number"
      ? values.stuck_threshold_minutes
      : typeof values.stuckThresholdMinutes === "number"
        ? values.stuckThresholdMinutes
        : 10;
  return Math.max(3, Math.min(60, Math.round(configured)));
};

export const deriveTeamTelemetry = <
  Team extends LiveOpsTeamRow,
  Presence extends LiveOpsPresenceRow
>(
  teams: Team[],
  presenceRows: Presence[],
  now: Date,
  stuckThresholdMinutes: number
) => {
  const presenceByTeam = new Map<string, Set<string>>();
  for (const presence of presenceRows) {
    if (!presence.team_id) continue;
    const participants =
      presenceByTeam.get(presence.team_id) ?? new Set<string>();
    participants.add(presence.participant_id);
    presenceByTeam.set(presence.team_id, participants);
  }

  return teams.map((team) => {
    const lastProgress = team.last_progress_at
      ? new Date(team.last_progress_at).getTime()
      : team.started_at
        ? new Date(team.started_at).getTime()
        : null;
    const minutesSinceProgress =
      lastProgress === null || !Number.isFinite(lastProgress)
        ? null
        : Math.max(
            0,
            Math.floor((now.getTime() - lastProgress) / 60_000)
          );

    return {
      ...team,
      online_count: presenceByTeam.get(team.id)?.size ?? 0,
      minutes_since_progress: minutesSinceProgress,
      is_stuck:
        ["travelling", "solving"].includes(team.status) &&
        minutesSinceProgress !== null &&
        minutesSinceProgress >= stuckThresholdMinutes
    };
  });
};

const fallbackIsReady = (value: unknown): boolean => {
  const fallback = recordValue(value);
  return Boolean(
    (typeof fallback.he === "string" ||
      typeof fallback.en === "string") &&
      Array.isArray(fallback.accepted) &&
      fallback.accepted.some(
        (answer) => typeof answer === "string" && Boolean(answer.trim())
      )
  );
};

const fieldStatusIsReady = (status: string): boolean =>
  status === "verified" || status === "not_required";

export const deriveCheckpointHealth = <
  Checkpoint extends LiveOpsCheckpointRow
>(
  checkpoints: Checkpoint[],
  sourceActiveById: Map<string, boolean>,
  fieldHealthById: Map<string, CheckpointFieldHealth>
) =>
  checkpoints.map((checkpoint) => {
    const sourceId = checkpoint.source_checkpoint_id;
    const sourceActive = sourceId
      ? sourceActiveById.get(sourceId) === true
      : true;
    const fieldHealth = sourceId
      ? fieldHealthById.get(sourceId) ?? {
          status: "pending",
          notes: null,
          lastCheckedAt: null
        }
      : {
          status: "not_required",
          notes: null,
          lastCheckedAt: null
        };
    const requiresFallback = ["photo", "hybrid"].includes(checkpoint.kind);
    const fallbackReady = fallbackIsReady(checkpoint.fallback_checkpoint);
    const fieldReady = fieldStatusIsReady(fieldHealth.status);
    const healthy =
      !checkpoint.is_disabled &&
      sourceActive &&
      fieldReady &&
      (!requiresFallback || fallbackReady);

    return {
      ...checkpoint,
      source_active: sourceActive,
      field_health_status: fieldHealth.status,
      field_health_notes: fieldHealth.notes,
      field_last_checked_at: fieldHealth.lastCheckedAt,
      fallback_ready: fallbackReady,
      healthy
    };
  });

export const summarizeOutbox = (rows: LiveOpsOutboxRow[]) =>
  rows.reduce(
    (summary, message) => {
      summary.total += 1;
      if (message.status === "sent") {
        if (["delivered", "read"].includes(message.provider_status ?? "")) {
          summary.delivered += 1;
        } else {
          summary.sent += 1;
        }
      } else if (message.status === "failed") {
        summary.failed += 1;
      } else if (message.status === "processing") {
        summary.processing += 1;
      } else {
        summary.queued += 1;
      }
      return summary;
    },
    {
      total: 0,
      queued: 0,
      processing: 0,
      sent: 0,
      delivered: 0,
      failed: 0
    }
  );
