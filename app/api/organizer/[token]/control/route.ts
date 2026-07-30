import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashSecret } from "@/lib/crypto";
import { skipCheckpointForTeam } from "@/lib/checkpoint-skip";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";
import { processOutbox } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

const CHECKPOINT_SKIP_ERRORS = new Set([
  "checkpoint_changed",
  "checkpoint_not_found",
  "game_not_active",
  "team_not_active",
  "team_not_found"
]);

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

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const body = await readJson<Record<string, unknown>>(request);
    const action = typeof body.action === "string" ? body.action : "";
    const supabase = createAdminClient();
    const { data: run, error: runError } = await supabase
      .from("game_runs")
      .select("*")
      .eq("organizer_token_hash", hashSecret(token))
      .single();
    if (runError || !run) throw new Error("Organizer link is invalid or expired");

    let delivery:
      | {
          queued: number;
          processing: number;
          sent: number;
          delivered: number;
          failed: number;
        }
      | undefined;
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

    if (action === "pause") {
      const { error } = await supabase
        .from("game_runs")
        .update({ status: "paused" })
        .eq("id", run.id)
        .eq("status", "active");
      if (error) throw error;
    } else if (action === "resume") {
      const { error } = await supabase
        .from("game_runs")
        .update({ status: "active" })
        .eq("id", run.id)
        .eq("status", "paused");
      if (error) throw error;
    } else if (action === "end") {
      const now = new Date();
      const { error } = await supabase
        .from("game_runs")
        .update({
          status: "finished",
          finished_at: now.toISOString(),
          retention_until: new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString()
        })
        .eq("id", run.id);
      if (error) throw error;
      await supabase
        .from("teams")
        .update({ status: "finished", finished_at: now.toISOString() })
        .eq("run_id", run.id)
        .neq("status", "disqualified");
    } else if (action === "skip") {
      const { data: teams, error: teamError } = await supabase
        .from("teams")
        .select("id")
        .eq("run_id", run.id)
        .in("status", ["travelling", "solving"]);
      if (teamError) throw teamError;

      const suppliedKey = request.headers.get("idempotency-key")?.trim();
      const requestKey =
        suppliedKey && suppliedKey.length <= 240
          ? suppliedKey
          : crypto.randomUUID();
      const outcomes = await Promise.all(
        (teams ?? []).map(async (team) => {
          try {
            const result = await skipCheckpointForTeam({
              teamId: team.id,
              actor: { type: "organizer" },
              reason: "organizer_override",
              requireOptional: false,
              idempotencyKey: `organizer-skip:${hashSecret(
                `${run.id}:${team.id}:${requestKey}`
              )}`
            });
            return { teamId: team.id, result };
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
        ...new Set(
          successes.flatMap((outcome) => outcome.result.outboxIds)
        )
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
      delivery = {
        queued: outboxIds.length,
        processing: 0,
        sent: 0,
        delivered: 0,
        failed: 0
      };
      if (outboxIds.length) {
        after(async () => {
          try {
            await processOutbox(outboxIds.length, { outboxIds });
          } catch {
            console.error("checkpoint_skip.low_latency_kick_failed", {
              runId: run.id,
              actorType: "organizer",
              queued: outboxIds.length,
              errorCode: "outbox_kick_failed"
            });
          }
        });
      }
    } else if (action === "broadcast") {
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) throw new Error("Message is required");
      const { data: participants, error } = await supabase
        .from("participants")
        .select("id,phone_ciphertext")
        .eq("run_id", run.id)
        .not("phone_ciphertext", "is", null);
      if (error) throw error;
      if (participants?.length) {
        const { data: queuedRows, error: insertError } = await supabase
          .from("message_outbox")
          .insert(
            participants.map((participant) => ({
              run_id: run.id,
              participant_id: participant.id,
              channel: "whatsapp",
              recipient_ciphertext: participant.phone_ciphertext,
              payload: { body: message }
            }))
          )
          .select("id");
        if (insertError) throw insertError;

        const outboxIds = (queuedRows ?? []).map((row) => row.id);
        delivery = {
          queued: outboxIds.length,
          processing: 0,
          sent: 0,
          delivered: 0,
          failed: 0
        };
        if (outboxIds.length) {
          after(async () => {
            try {
              await processOutbox(outboxIds.length, { outboxIds });
            } catch {
              console.error("outbox.low_latency_kick_failed", {
                runId: run.id,
                queued: outboxIds.length,
                errorCode: "outbox_kick_failed"
              });
            }
          });
        }
      } else {
        delivery = {
          queued: 0,
          processing: 0,
          sent: 0,
          delivered: 0,
          failed: 0
        };
      }
    } else if (action === "score") {
      const teamId = typeof body.teamId === "string" ? body.teamId : "";
      const delta = typeof body.delta === "number" ? Math.round(body.delta) : 0;
      const { data: team, error: teamError } = await supabase
        .from("teams")
        .select("score")
        .eq("id", teamId)
        .eq("run_id", run.id)
        .single();
      if (teamError || !team) throw new Error("Team was not found");
      const { error } = await supabase
        .from("teams")
        .update({ score: Math.max(0, team.score + delta) })
        .eq("id", teamId);
      if (error) throw error;
    } else {
      throw new Error("Unsupported organizer action");
    }

    if (action !== "skip") {
      const { error: eventError } = await supabase.from("game_events").insert({
        run_id: run.id,
        event_type: "ORGANIZER_ACTION",
        idempotency_key: `organizer:${action}:${crypto.randomUUID()}`,
        payload: {
          action,
          ...(delivery ? { queuedCount: delivery.queued } : {})
        }
      });
      if (eventError) throw eventError;
    }

    return jsonOk(
      {
        action,
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
