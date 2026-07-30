import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashSecret } from "@/lib/crypto";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";
import { processOutbox } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

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
      const { data: checkpoints, error: checkpointError } = await supabase
        .from("run_checkpoints")
        .select("slug,sequence_no")
        .eq("run_id", run.id)
        .eq("is_disabled", false)
        .order("sequence_no");
      if (checkpointError) throw checkpointError;

      const { data: teams, error: teamError } = await supabase
        .from("teams")
        .select("id,current_checkpoint_slug,completed_count")
        .eq("run_id", run.id)
        .in("status", ["travelling", "solving"]);
      if (teamError) throw teamError;

      for (const team of teams ?? []) {
        const currentIndex = (checkpoints ?? []).findIndex(
          (checkpoint) => checkpoint.slug === team.current_checkpoint_slug
        );
        const next = currentIndex >= 0 ? checkpoints?.[currentIndex + 1] : null;
        await supabase
          .from("teams")
          .update({
            current_checkpoint_slug: next?.slug ?? null,
            completed_count: team.completed_count + 1,
            status: next ? "travelling" : "finished",
            wrong_attempts: 0,
            last_wrong_attempt_at: null,
            last_progress_at: new Date().toISOString(),
            finished_at: next ? null : new Date().toISOString()
          })
          .eq("id", team.id);
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

    return jsonOk({ action, status: "accepted", ...(delivery ? { delivery } : {}) });
  } catch (error) {
    return handleRouteError(error);
  }
}
