import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashSecret } from "@/lib/crypto";
import { publicEnv } from "@/lib/env";
import { skipCheckpointForTeam } from "@/lib/checkpoint-skip";
import {
  AppError,
  handleRouteError,
  jsonOk,
  readJson,
  requireIdempotencyKey
} from "@/lib/http";
import { processOutbox } from "@/lib/providers";
import { enforceOrganizerRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const CHECKPOINT_SKIP_ERRORS = new Set([
  "checkpoint_changed",
  "checkpoint_not_found",
  "game_not_active",
  "team_not_active",
  "team_not_found"
]);

const SUPPORTED_OVERRIDES = new Set([
  "pause",
  "resume",
  "end",
  "score",
  "force_complete",
  "grant_hint",
  "move_participant",
  "disable_checkpoint"
]);

type Delivery = {
  queued: number;
  processing: number;
  sent: number;
  delivered: number;
  failed: number;
};

const emptyDelivery = (queued = 0): Delivery => ({
  queued,
  processing: 0,
  sent: 0,
  delivered: 0,
  failed: 0
});

const textField = (
  body: Record<string, unknown>,
  key: string,
  maxLength = 800
) => {
  const value = typeof body[key] === "string" ? body[key].trim() : "";
  return value.slice(0, maxLength);
};

const optionalText = (body: Record<string, unknown>, key: string) =>
  textField(body, key) || null;

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const isDuplicateResult = (value: unknown) =>
  objectValue(value).duplicate === true;

const checkpointSkipErrorCode = (error: unknown): string => {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  return (
    [...CHECKPOINT_SKIP_ERRORS].find((candidate) =>
      message.includes(candidate)
    ) ?? "checkpoint_skip_failed"
  );
};

const escapeLikePattern = (value: string) =>
  value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

const findOutboxIds = async ({
  supabase,
  runId,
  idempotencyKey
}: {
  supabase: ReturnType<typeof createAdminClient>;
  runId: string;
  idempotencyKey: string;
}) => {
  const prefix = escapeLikePattern(`${idempotencyKey}:outbox:`);
  const { data, error } = await supabase
    .from("message_outbox")
    .select("id")
    .eq("run_id", runId)
    .like("idempotency_key", `${prefix}%`);
  if (error) throw error;
  return (data ?? []).map((row) => row.id);
};

const kickOutbox = ({
  outboxIds,
  runId,
  action
}: {
  outboxIds: string[];
  runId: string;
  action: string;
}) => {
  if (!outboxIds.length) return;
  after(async () => {
    try {
      await processOutbox(outboxIds.length, { outboxIds });
    } catch {
      console.error("organizer.outbox_low_latency_kick_failed", {
        runId,
        action,
        queued: outboxIds.length,
        errorCode: "outbox_kick_failed"
      });
    }
  });
};

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    await enforceOrganizerRateLimit("organizerControl", token);

    const tokenHash = hashSecret(token);
    const supabase = createAdminClient();
    const { data: run, error: runError } = await supabase
      .from("game_runs")
      .select("id")
      .eq("organizer_token_hash", tokenHash)
      .single();
    if (runError || !run) {
      throw new Error("Organizer link is invalid or expired");
    }

    const idempotencyKey = requireIdempotencyKey(request);
    const body = await readJson<Record<string, unknown>>(request);
    const action = textField(body, "action", 40);
    const reason = textField(body, "reason", 500);
    if (reason.length < 5) {
      throw new AppError({
        message:
          "יש לציין סיבה קצרה להתערבות. / Add a short reason for this intervention.",
        status: 400,
        code: "override_reason_required"
      });
    }

    const actor = `organizer:${tokenHash.slice(0, 12)}`;
    let result: unknown;
    let delivery: Delivery | undefined;
    let skip:
      | {
          attempted: number;
          advanced: number;
          finished: number;
          duplicates: number;
          queued: number;
          failures: Array<{ teamId: string; errorCode: string }>;
        }
      | undefined;

    if (action === "broadcast") {
      const bodyHe =
        textField(body, "bodyHe") || textField(body, "message");
      const bodyEn = textField(body, "bodyEn") || bodyHe;
      if (!bodyHe || !bodyEn) {
        throw new AppError({
          message:
            "נדרש טקסט הודעה בעברית ובאנגלית. / Broadcast text is required in both languages.",
          status: 400,
          code: "broadcast_body_required"
        });
      }
      const activeMinutes =
        typeof body.activeMinutes === "number"
          ? Math.max(1, Math.min(1440, Math.round(body.activeMinutes)))
          : 60;
      const { data, error } = await supabase.rpc(
        "queue_organizer_broadcast",
        {
          p_run_id: run.id,
          p_team_id: optionalText(body, "teamId"),
          p_body_he: bodyHe,
          p_body_en: bodyEn,
          p_reason: reason,
          p_actor: actor,
          p_idempotency_key: idempotencyKey,
          p_active_minutes: activeMinutes
        }
      );
      if (error) throw error;
      result = data;

      const outboxIds = await findOutboxIds({
        supabase,
        runId: run.id,
        idempotencyKey
      });
      const queued = isDuplicateResult(data) ? 0 : outboxIds.length;
      delivery = emptyDelivery(queued);
      kickOutbox({ outboxIds, runId: run.id, action });
    } else if (action === "retry_message") {
      const messageId = textField(body, "messageId", 64);
      if (!messageId) {
        throw new AppError({
          message: "Message id is required",
          status: 400,
          code: "message_id_required"
        });
      }
      const { data, error } = await supabase.rpc("retry_outbox_message", {
        p_run_id: run.id,
        p_message_id: messageId,
        p_reason: reason,
        p_actor: actor,
        p_idempotency_key: idempotencyKey
      });
      if (error) throw error;
      result = data;
      const duplicate = isDuplicateResult(data);
      delivery = emptyDelivery(duplicate ? 0 : 1);
      if (!duplicate) {
        kickOutbox({
          outboxIds: [messageId],
          runId: run.id,
          action
        });
      }
    } else if (action === "skip") {
      const { data: teams, error: teamError } = await supabase
        .from("teams")
        .select(
          "id,status,score,completed_count,current_checkpoint_slug,last_progress_at"
        )
        .eq("run_id", run.id)
        .in("status", ["travelling", "solving"]);
      if (teamError) throw teamError;

      const outcomes = await Promise.all(
        (teams ?? []).map(async (team) => {
          try {
            const skipResult = await skipCheckpointForTeam({
              teamId: team.id,
              actor: { type: "organizer" },
              reason: "organizer_override",
              requireOptional: false,
              idempotencyKey: `organizer-skip:${hashSecret(
                `${run.id}:${team.id}:${idempotencyKey}`
              )}`
            });
            return { teamId: team.id, result: skipResult };
          } catch (error) {
            return {
              teamId: team.id,
              errorCode: checkpointSkipErrorCode(error)
            };
          }
        })
      );
      const successes = outcomes.filter(
        (
          outcome
        ): outcome is Extract<(typeof outcomes)[number], { result: unknown }> =>
          "result" in outcome
      );
      const failures = outcomes
        .filter(
          (
            outcome
          ): outcome is Extract<
            (typeof outcomes)[number],
            { errorCode: string }
          > => "errorCode" in outcome
        )
        .map((outcome) => ({
          teamId: outcome.teamId,
          errorCode: outcome.errorCode
        }));
      const outboxIds = [
        ...new Set(successes.flatMap((outcome) => outcome.result.outboxIds))
      ];
      skip = {
        attempted: outcomes.length,
        advanced: successes.filter(
          (outcome) =>
            !outcome.result.duplicate &&
            outcome.result.outcome === "advanced"
        ).length,
        finished: successes.filter(
          (outcome) =>
            !outcome.result.duplicate &&
            outcome.result.outcome === "finished"
        ).length,
        duplicates: successes.filter((outcome) => outcome.result.duplicate)
          .length,
        queued: outboxIds.length,
        failures
      };
      delivery = emptyDelivery(outboxIds.length);

      const teamIds = (teams ?? []).map((team) => team.id);
      const { data: afterTeams, error: afterTeamsError } = teamIds.length
        ? await supabase
            .from("teams")
            .select(
              "id,status,score,completed_count,current_checkpoint_slug,last_progress_at"
            )
            .in("id", teamIds)
        : { data: [], error: null };
      if (afterTeamsError) throw afterTeamsError;

      const auditPayload = {
        run_id: run.id,
        action,
        actor,
        reason,
        idempotency_key: idempotencyKey,
        before_state: { teams: teams ?? [] },
        after_state: { teams: afterTeams ?? [], result: skip }
      };
      const [{ error: auditError }, { error: eventError }] =
        await Promise.all([
          supabase
            .from("organizer_audit_log")
            .upsert(auditPayload, {
              onConflict: "idempotency_key",
              ignoreDuplicates: true
            }),
          supabase.from("game_events").upsert(
            {
              run_id: run.id,
              event_type: "ORGANIZER_OVERRIDE",
              idempotency_key: `${idempotencyKey}:audit`,
              payload: {
                action,
                actor,
                reason,
                before: auditPayload.before_state,
                after: auditPayload.after_state
              }
            },
            {
              onConflict: "idempotency_key",
              ignoreDuplicates: true
            }
          )
        ]);
      if (auditError) throw auditError;
      if (eventError) throw eventError;
      result = skip;
      kickOutbox({ outboxIds, runId: run.id, action });
    } else if (action === "create_recap_share") {
      // The recap token IS the idempotency key: retrying the same request
      // returns the same share instead of minting a second public link.
      const activeHours =
        typeof body.activeHours === "number"
          ? Math.max(1, Math.min(168, Math.round(body.activeHours)))
          : 72;
      const { data, error } = await supabase.rpc("create_recap_share", {
        p_run_id: run.id,
        p_team_id: optionalText(body, "teamId"),
        p_actor: actor,
        p_reason: reason,
        p_idempotency_key: idempotencyKey,
        p_active_hours: activeHours
      });
      if (error) throw error;
      result = {
        ...(data && typeof data === "object" && !Array.isArray(data)
          ? data
          : {}),
        recapUrl: `${publicEnv.appUrl}/recap/${encodeURIComponent(
          idempotencyKey
        )}`
      };
    } else if (action === "revoke_recap_share") {
      const shareId = textField(body, "shareId", 64);
      if (!shareId) {
        throw new AppError({
          message: "Recap share id is required",
          code: "recap_share_id_required"
        });
      }
      const { data, error } = await supabase.rpc("revoke_recap_share", {
        p_run_id: run.id,
        p_share_id: shareId,
        p_actor: actor,
        p_reason: reason,
        p_idempotency_key: idempotencyKey
      });
      if (error) throw error;
      result = data;
    } else {
      if (!SUPPORTED_OVERRIDES.has(action)) {
        throw new AppError({
          message: "Unsupported organizer action",
          status: 400,
          code: "unsupported_organizer_action"
        });
      }
      const scoreDelta =
        typeof body.delta === "number" ? Math.round(body.delta) : null;
      const { data, error } = await supabase.rpc(
        "apply_organizer_override",
        {
          p_run_id: run.id,
          p_action: action,
          p_reason: reason,
          p_actor: actor,
          p_idempotency_key: idempotencyKey,
          p_team_id: optionalText(body, "teamId"),
          p_participant_id: optionalText(body, "participantId"),
          p_target_team_id: optionalText(body, "targetTeamId"),
          p_checkpoint_slug: optionalText(body, "checkpointSlug"),
          p_score_delta: scoreDelta
        }
      );
      if (error) throw error;
      result = data;

      if (action === "grant_hint") {
        const outboxIds = await findOutboxIds({
          supabase,
          runId: run.id,
          idempotencyKey
        });
        const queued = isDuplicateResult(data) ? 0 : outboxIds.length;
        delivery = emptyDelivery(queued);
        kickOutbox({ outboxIds, runId: run.id, action });
      }
    }

    return jsonOk(
      {
        action,
        result,
        status: skip?.failures.length ? "partial" : "accepted",
        ...(delivery ? { delivery } : {}),
        ...(skip ? { skip } : {})
      },
      { status: skip?.failures.length ? 207 : 200 }
    );
  } catch (error) {
    return handleRouteError(error, {
      operationalScope: "live_run",
      route: "organizer.control"
    });
  }
}
