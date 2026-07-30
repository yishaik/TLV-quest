import { createAdminClient } from "@/lib/supabase/admin";
import { hashSecret } from "@/lib/crypto";
import { publicEnv } from "@/lib/env";
import {
  AppError,
  handleRouteError,
  jsonOk,
  readJson,
  requireIdempotencyKey
} from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

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

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const tokenHash = hashSecret(token);
    await enforceRateLimit({
      scope: "organizer-control",
      identifier: tokenHash,
      limit: 30,
      windowSeconds: 60
    });

    const idempotencyKey = requireIdempotencyKey(request, "organizer");
    const body = await readJson<Record<string, unknown>>(request);
    const action = textField(body, "action", 40);
    const reason = textField(body, "reason", 500);
    if (reason.length < 5) {
      throw new AppError({
        message:
          "יש לציין סיבה קצרה להתערבות. / Add a short reason for this intervention.",
        code: "override_reason_required"
      });
    }

    const supabase = createAdminClient();
    const { data: run, error: runError } = await supabase
      .from("game_runs")
      .select("id")
      .eq("organizer_token_hash", tokenHash)
      .single();
    if (runError || !run) {
      throw new Error("Organizer link is invalid or expired");
    }

    const actor = `organizer:${tokenHash.slice(0, 12)}`;
    let result: unknown;

    if (action === "broadcast") {
      const bodyHe = textField(body, "bodyHe") || textField(body, "message");
      const bodyEn = textField(body, "bodyEn") || bodyHe;
      if (!bodyHe || !bodyEn) {
        throw new AppError({
          message: "Broadcast text is required in both languages",
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
    } else if (action === "retry_message") {
      const messageId = textField(body, "messageId", 64);
      if (!messageId) {
        throw new AppError({
          message: "Message id is required",
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
    } else if (action === "create_recap_share") {
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
    } else if (action === "create_cross_team_event") {
      const teamIds = Array.isArray(body.teamIds)
        ? [
            ...new Set(
              body.teamIds.filter(
                (teamId): teamId is string =>
                  typeof teamId === "string" && Boolean(teamId.trim())
              )
            )
          ]
        : [];
      if (teamIds.length < 2) {
        throw new AppError({
          message: "Choose at least two teams for a cross-team event",
          code: "cross_team_scope_required"
        });
      }
      const titleHe = textField(body, "titleHe", 200);
      const titleEn = textField(body, "titleEn", 200);
      if (!titleHe || !titleEn) {
        throw new AppError({
          message: "Cross-team event title is required in both languages",
          code: "cross_team_title_required"
        });
      }
      const activeMinutes =
        typeof body.activeMinutes === "number"
          ? Math.max(5, Math.min(240, Math.round(body.activeMinutes)))
          : 30;
      const { data, error } = await supabase.rpc("create_cross_team_event", {
        p_run_id: run.id,
        p_team_ids: teamIds,
        p_title: { he: titleHe, en: titleEn },
        p_instructions: {
          he: textField(body, "instructionsHe", 800),
          en: textField(body, "instructionsEn", 800)
        },
        p_bonus_points:
          typeof body.bonusPoints === "number"
            ? Math.max(0, Math.min(1000, Math.round(body.bonusPoints)))
            : 25,
        p_expires_at: new Date(
          Date.now() + activeMinutes * 60_000
        ).toISOString(),
        p_actor: actor,
        p_reason: reason,
        p_idempotency_key: idempotencyKey
      });
      if (error) throw error;
      result = data;
    } else if (action === "resolve_cross_team_event") {
      const eventId = textField(body, "eventId", 64);
      const winningTeamIds = Array.isArray(body.winningTeamIds)
        ? [
            ...new Set(
              body.winningTeamIds.filter(
                (teamId): teamId is string =>
                  typeof teamId === "string" && Boolean(teamId.trim())
              )
            )
          ]
        : [];
      if (!eventId) {
        throw new AppError({
          message: "Cross-team event id is required",
          code: "cross_team_event_id_required"
        });
      }
      const { data, error } = await supabase.rpc("resolve_cross_team_event", {
        p_event_id: eventId,
        p_winning_team_ids: winningTeamIds,
        p_actor: actor,
        p_reason: reason,
        p_idempotency_key: idempotencyKey
      });
      if (error) throw error;
      result = data;
    } else {
      const supportedActions = new Set([
        "pause",
        "resume",
        "end",
        "score",
        "force_complete",
        "grant_hint",
        "move_participant",
        "disable_checkpoint"
      ]);
      if (!supportedActions.has(action)) {
        throw new AppError({
          message: "Unsupported organizer action",
          code: "unsupported_organizer_action"
        });
      }
      const scoreDelta =
        typeof body.delta === "number" ? Math.round(body.delta) : null;
      const { data, error } = await supabase.rpc("apply_organizer_override", {
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
      });
      if (error) throw error;
      result = data;
    }

    return jsonOk({ action, result });
  } catch (error) {
    return handleRouteError(error);
  }
}
