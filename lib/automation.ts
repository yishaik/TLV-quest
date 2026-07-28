import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

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
  const cutoff = new Date(Date.now() - 7 * 60_000).toISOString();
  const { data: teams, error } = await supabase
    .from("teams")
    .select("id,run_id,current_checkpoint_slug,last_progress_at")
    .in("status", ["travelling", "solving"])
    .not("current_checkpoint_slug", "is", null)
    .not("last_progress_at", "is", null)
    .lte("last_progress_at", cutoff)
    .limit(100);
  if (error) throw error;

  let hintsSent = 0;

  for (const team of teams ?? []) {
    if (!team.current_checkpoint_slug) continue;

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
    const representativeLocale = representative.language === "en" ? "en" : "he";
    const representativeText =
      text(hint[representativeLocale]) || text(hint.he) || text(hint.en);
    const penalty = typeof hint.penalty === "number" ? hint.penalty : 10;
    const idempotencyKey = `auto-hint:${team.id}:${team.current_checkpoint_slug}:${hintIndex}`;

    const { data: result, error: hintError } = await supabase.rpc("request_hint", {
      p_team_id: team.id,
      p_participant_id: representative.id,
      p_checkpoint_id: checkpoint.id,
      p_hint_index: hintIndex,
      p_penalty: penalty,
      p_hint_text: representativeText,
      p_idempotency_key: idempotencyKey
    });
    if (hintError) {
      console.error("Automatic hint failed", {
        teamId: team.id,
        checkpoint: team.current_checkpoint_slug,
        error: hintError.message
      });
      continue;
    }

    const resultObject = asObject(result);
    if (resultObject.duplicate === true) continue;

    const outboxRows = participants
      .filter((participant) => participant.phone_ciphertext)
      .map((participant) => {
        const locale = participant.language === "en" ? "en" : "he";
        const hintText = text(hint[locale]) || text(hint.he) || text(hint.en);
        return {
          run_id: team.run_id,
          participant_id: participant.id,
          channel: "whatsapp" as const,
          recipient_ciphertext: participant.phone_ciphertext,
          payload: {
            locale,
            body: `${locale === "he" ? "רמז אוטומטי" : "Automatic hint"}: ${hintText}`
          }
        };
      });

    if (outboxRows.length) {
      const { error: outboxError } = await supabase
        .from("message_outbox")
        .insert(outboxRows);
      if (outboxError) throw outboxError;
    }

    hintsSent += 1;
  }

  return { hintsSent };
};
