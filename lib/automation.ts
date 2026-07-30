import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateDifficulty } from "@/lib/difficulty";

type JsonRecord = Record<string, unknown>;

const asObject = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const localizedCheckpointMessage = (
  contentValue: unknown,
  locale: "he" | "en"
): string => {
  const content = asObject(contentValue);
  const localized = asObject(content[locale]);
  const title = text(localized.title);
  const story = text(localized.story);
  const prompt = text(localized.prompt);
  const locationHint = text(localized.locationHint);

  return [title, story, prompt, locationHint]
    .filter(Boolean)
    .join("\n\n");
};

const queueCheckpointForTeam = async ({
  runId,
  teamId,
  checkpointContent
}: {
  runId: string;
  teamId: string;
  checkpointContent: unknown;
}) => {
  const supabase = createAdminClient();
  const { data: participants, error } = await supabase
    .from("participants")
    .select("id,language,phone_ciphertext")
    .eq("team_id", teamId)
    .not("phone_ciphertext", "is", null);
  if (error) throw error;
  if (!participants?.length) return 0;

  const rows = participants
    .map((participant) => {
      const locale = participant.language === "en" ? "en" : "he";
      const body = localizedCheckpointMessage(checkpointContent, locale);
      if (!body) return null;
      return {
        run_id: runId,
        participant_id: participant.id,
        channel: "whatsapp" as const,
        recipient_ciphertext: participant.phone_ciphertext,
        payload: { body, locale }
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (!rows.length) return 0;
  const { error: insertError } = await supabase.from("message_outbox").insert(rows);
  if (insertError) throw insertError;
  return rows.length;
};

export const startDueRuns = async () => {
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const { data: runs, error } = await supabase
    .from("game_runs")
    .select("id,public_code")
    .eq("start_mode", "scheduled")
    .in("status", ["draft", "registration_open", "ready"])
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", now)
    .limit(25);
  if (error) throw error;

  let started = 0;
  let messagesQueued = 0;

  for (const run of runs ?? []) {
    const { data: startResult, error: startError } = await supabase.rpc("start_run", {
      p_run_id: run.id
    });
    if (startError) {
      console.error("Scheduled run start failed", {
        runId: run.id,
        error: startError.message
      });
      continue;
    }

    const firstSlug = asObject(startResult).first_checkpoint;
    if (typeof firstSlug !== "string") continue;

    const [{ data: checkpoint }, { data: teams }] = await Promise.all([
      supabase
        .from("run_checkpoints")
        .select("content")
        .eq("run_id", run.id)
        .eq("slug", firstSlug)
        .single(),
      supabase
        .from("teams")
        .select("id")
        .eq("run_id", run.id)
        .in("status", ["travelling", "solving"])
    ]);

    for (const team of teams ?? []) {
      messagesQueued += await queueCheckpointForTeam({
        runId: run.id,
        teamId: team.id,
        checkpointContent: checkpoint?.content
      });
    }
    started += 1;
  }

  return { started, messagesQueued };
};

export const sendDueHints = async () => {
  const supabase = createAdminClient();
  const { data: teams, error } = await supabase
    .from("teams")
    .select(
      "id,run_id,current_checkpoint_slug,last_progress_at,wrong_attempts,route_state"
    )
    .in("status", ["travelling", "solving"])
    .not("current_checkpoint_slug", "is", null)
    .not("last_progress_at", "is", null)
    .limit(100);
  if (error) throw error;

  let offersSent = 0;

  for (const team of teams ?? []) {
    if (!team.current_checkpoint_slug) continue;
    const routeState = asObject(team.route_state);
    const adaptive = asObject(routeState.adaptiveDifficulty);
    const policy = asObject(adaptive.policy);
    const wrongThreshold =
      typeof policy.wrongAttemptsToUnlock === "number"
        ? policy.wrongAttemptsToUnlock
        : 2;
    const inactivityMinutes =
      typeof policy.inactivityMinutesToUnlock === "number"
        ? policy.inactivityMinutesToUnlock
        : 7;
    const adaptiveCutoff = new Date(
      Date.now() - inactivityMinutes * 60_000
    ).toISOString();
    const offerDue =
      team.wrong_attempts >= wrongThreshold ||
      (team.last_progress_at !== null &&
        team.last_progress_at <= adaptiveCutoff);
    if (!offerDue) continue;

    const [{ data: checkpoint }, { data: participants }, { data: hintEvents }] =
      await Promise.all([
        supabase
          .from("run_checkpoints")
          .select("id,hints")
          .eq("run_id", team.run_id)
          .eq("slug", team.current_checkpoint_slug)
          .single(),
        supabase
          .from("participants")
          .select("id,language,phone_ciphertext")
          .eq("team_id", team.id)
          .order("joined_at")
          .limit(30),
        supabase
          .from("game_events")
          .select("id")
          .eq("team_id", team.id)
          .eq("event_type", "HINT_REQUESTED")
          .contains("payload", { checkpoint_slug: team.current_checkpoint_slug })
      ]);

    if (!checkpoint || !participants?.length) continue;
    const hintIndex = hintEvents?.length ?? 0;
    const hint = asObject(asArray(checkpoint.hints)[hintIndex]);
    if (!Object.keys(hint).length) continue;

    const representative = participants[0];
    const penalty = typeof hint.penalty === "number" ? hint.penalty : 10;
    const idempotencyKey =
      `hint-offer:${team.id}:${team.current_checkpoint_slug}:${hintIndex}`;
    const { data: offered, error: offerError } = await supabase
      .from("game_events")
      .upsert(
        {
          run_id: team.run_id,
          team_id: team.id,
          participant_id: representative.id,
          event_type: "HINT_OFFERED",
          idempotency_key: idempotencyKey,
          payload: {
            checkpoint_slug: team.current_checkpoint_slug,
            hint_index: hintIndex,
            penalty
          }
        },
        { onConflict: "idempotency_key", ignoreDuplicates: true }
      )
      .select("id")
      .maybeSingle();
    if (offerError) throw offerError;
    if (!offered) continue;

    const { error: bannerError } = await supabase
      .from("in_app_banners")
      .upsert(
        {
          run_id: team.run_id,
          team_id: team.id,
          idempotency_key: idempotencyKey,
          body: {
            he: `רמז חדש זמין במשחק (עלות: ${penalty} נק׳).`,
            en: `A new hint is available in the game (${penalty}-point cost).`
          },
          active_until: new Date(Date.now() + 12 * 60 * 60_000).toISOString()
        },
        { onConflict: "idempotency_key", ignoreDuplicates: true }
      );
    if (bannerError) throw bannerError;

    const outboxRows = participants
      .filter((participant) => participant.phone_ciphertext)
      .map((participant) => {
        const locale = participant.language === "en" ? "en" : "he";
        return {
          run_id: team.run_id,
          participant_id: participant.id,
          channel: "whatsapp" as const,
          recipient_ciphertext: participant.phone_ciphertext,
          idempotency_key: `${idempotencyKey}:outbox:${participant.id}`,
          target_scope: `team:${team.id}`,
          payload: {
            locale,
            body:
              locale === "he"
                ? `רמז חדש זמין במשחק. חשיפה תעלה ${penalty} נק׳.`
                : `A new hint is available in the game. Revealing it costs ${penalty} points.`
          }
        };
      });

    if (outboxRows.length) {
      const { error: outboxError } = await supabase
        .from("message_outbox")
        .upsert(outboxRows, {
          onConflict: "idempotency_key",
          ignoreDuplicates: true
        });
      if (outboxError) throw outboxError;
    }

    offersSent += 1;
  }

  return { offersSent };
};

export const applyAdaptiveDifficulty = async () => {
  const supabase = createAdminClient();
  const now = new Date();
  const { data: teams, error: teamError } = await supabase
    .from("teams")
    .select(
      "id,run_id,status,current_checkpoint_slug,wrong_attempts,hints_used,completed_count,last_progress_at,started_at,route_state"
    )
    .in("status", ["travelling", "solving"])
    .not("current_checkpoint_slug", "is", null)
    .limit(250);
  if (teamError) throw teamError;

  const runIds = [...new Set((teams ?? []).map((team) => team.run_id))];
  if (!runIds.length) return { evaluated: 0, changed: 0 };
  const { data: runs, error: runError } = await supabase
    .from("game_runs")
    .select("id,status,settings")
    .in("id", runIds)
    .in("status", ["active", "paused"]);
  if (runError) throw runError;
  const settingsByRun = new Map(
    (runs ?? []).map((run) => [run.id, asObject(run.settings)])
  );

  let evaluated = 0;
  let changed = 0;
  for (const team of teams ?? []) {
    const settings = settingsByRun.get(team.run_id);
    if (!settings || !team.current_checkpoint_slug) continue;
    const reference = team.last_progress_at ?? team.started_at ?? now.toISOString();
    const minutesSinceProgress = Math.max(
      0,
      Math.floor((now.getTime() - new Date(reference).getTime()) / 60_000)
    );
    const adaptiveSettings = asObject(settings.adaptiveDifficulty);
    const policy = evaluateDifficulty({
      enabled: adaptiveSettings.enabled !== false,
      wrongAttempts: team.wrong_attempts,
      hintsUsed: team.hints_used,
      completedCount: team.completed_count,
      minutesSinceProgress
    });
    evaluated += 1;

    const { data: decision, error: decisionError } = await supabase
      .from("adaptive_difficulty_decisions")
      .upsert(
        {
          run_id: team.run_id,
          team_id: team.id,
          checkpoint_slug: team.current_checkpoint_slug,
          level: policy.level,
          inputs: {
            wrongAttempts: team.wrong_attempts,
            hintsUsed: team.hints_used,
            completedCount: team.completed_count,
            minutesSinceProgress
          },
          policy
        },
        {
          onConflict: "team_id,checkpoint_slug,level",
          ignoreDuplicates: true
        }
      )
      .select("id")
      .maybeSingle();
    if (decisionError) throw decisionError;

    const routeState = asObject(team.route_state);
    const previous = asObject(routeState.adaptiveDifficulty);
    if (
      decision ||
      previous.level !== policy.level ||
      previous.checkpointSlug !== team.current_checkpoint_slug
    ) {
      const idempotencyKey = `adaptive:${team.id}:${team.current_checkpoint_slug}:${policy.level}`;
      const { error: updateError } = await supabase
        .from("teams")
        .update({
          route_state: {
            ...routeState,
            adaptiveDifficulty: {
              level: policy.level,
              reason: policy.reason,
              checkpointSlug: team.current_checkpoint_slug,
              policy,
              evaluatedAt: now.toISOString()
            }
          }
        })
        .eq("id", team.id);
      if (updateError) throw updateError;

      const { error: eventError } = await supabase.from("game_events").upsert(
        {
          run_id: team.run_id,
          team_id: team.id,
          event_type: "DIFFICULTY_ADJUSTED",
          idempotency_key: idempotencyKey,
          payload: {
            checkpoint_slug: team.current_checkpoint_slug,
            level: policy.level,
            reason: policy.reason,
            policy
          }
        },
        { onConflict: "idempotency_key", ignoreDuplicates: true }
      );
      if (eventError) throw eventError;

      if (policy.level === "assisted") {
        const { error: bannerError } = await supabase
          .from("in_app_banners")
          .upsert(
            {
              run_id: team.run_id,
              team_id: team.id,
              idempotency_key: `${idempotencyKey}:banner`,
              body: {
                he: "השותף למסע זיהה קושי: רמזים ייפתחו מוקדם יותר וקנסות הטעות הופחתו.",
                en: "Your quest companion noticed a rough patch: hints now unlock sooner and mistake penalties are reduced."
              },
              active_until: new Date(
                now.getTime() + 30 * 60_000
              ).toISOString()
            },
            { onConflict: "idempotency_key", ignoreDuplicates: true }
          );
        if (bannerError) throw bannerError;
      }
      changed += 1;
    }
  }

  return { evaluated, changed };
};
