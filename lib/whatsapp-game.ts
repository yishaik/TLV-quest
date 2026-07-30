import "server-only";

import {
  deliverCheckpointToTeam,
  formatCheckpointMessage
} from "@/lib/checkpoint-delivery";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveWhatsappGameContextByPhone } from "@/lib/repository";
import { participantResumeUrl } from "@/lib/participant-resume";
import {
  calculateScoreDelta,
  evaluateTextAnswer,
  type Locale,
  type ScoringConfig,
  type TextValidation
} from "@/lib/game-engine";
import { randomToken } from "@/lib/crypto";
import {
  formatWhatsappContextChoice,
  formatWhatsappContextNotFound,
  formatWhatsappRunStatus,
  isWhatsappContextPlayable,
  parseWhatsappCommand
} from "@/lib/whatsapp-status";

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const localText = (
  content: Record<string, unknown>,
  locale: Locale,
  key: string,
  fallback: string
) => {
  const localized = asObject(content[locale]);
  return typeof localized[key] === "string" ? localized[key] : fallback;
};

export const handleWhatsappGameMessage = async ({
  from,
  body,
  messageSid
}: {
  from: string;
  body: string;
  messageSid: string;
}): Promise<string> => {
  const parsedCommand = parseWhatsappCommand(body);
  const resolution = await resolveWhatsappGameContextByPhone({
    from,
    requestedRunCode: parsedCommand.requestedRunCode
  });
  if (resolution.kind === "none") {
    return formatWhatsappContextNotFound({
      requestedRunCode: resolution.requestedRunCode
    });
  }
  if (resolution.kind === "ambiguous") {
    return formatWhatsappContextChoice(resolution);
  }

  const context = resolution.context;
  const { participant, run, team, checkpoint } = context;
  const locale = participant.language as Locale;
  const isHebrew = locale === "he";
  const webAppUrl = participantResumeUrl(participant.id);
  const supabase = createAdminClient();

  if (parsedCommand.command === "status") {
    return formatWhatsappRunStatus({ context, resumeLink: webAppUrl });
  }
  if (!isWhatsappContextPlayable(context) || !team || !checkpoint) {
    return formatWhatsappRunStatus({ context, resumeLink: webAppUrl });
  }

  if (
    parsedCommand.command === "mission" ||
    parsedCommand.command === "start"
  ) {
    return formatCheckpointMessage({
      contentValue: checkpoint.content,
      locale,
      sequenceNo: checkpoint.sequence_no,
      resumeLink: webAppUrl
    });
  }

  if (parsedCommand.command === "hint") {
    const hints = asArray(checkpoint.hints);
    const { data: previousHints } = await supabase
      .from("game_events")
      .select("id")
      .eq("team_id", team.id)
      .eq("event_type", "HINT_REQUESTED")
      .contains("payload", { checkpoint_slug: checkpoint.slug });
    const hintIndex = previousHints?.length ?? 0;
    const hint = asObject(hints[hintIndex]);
    if (!Object.keys(hint).length) {
      return isHebrew ? "אין רמזים נוספים לתחנה הזאת." : "No more hints are available.";
    }
    const hintText =
      typeof hint[locale] === "string"
        ? hint[locale]
        : typeof hint.he === "string"
          ? hint.he
          : "";
    const penalty = typeof hint.penalty === "number" ? hint.penalty : 10;
    const { error } = await supabase.rpc("request_hint", {
      p_team_id: team.id,
      p_participant_id: participant.id,
      p_checkpoint_id: checkpoint.id,
      p_hint_index: hintIndex,
      p_penalty: penalty,
      p_hint_text: hintText,
      p_idempotency_key: `wa-hint:${messageSid}`
    });
    if (error) throw error;
    return `${isHebrew ? "רמז" : "Hint"}: ${hintText}`;
  }

  const validation = asObject(checkpoint.validation);
  const fallback = checkpoint.fallback_checkpoint
    ? asObject(checkpoint.fallback_checkpoint)
    : null;
  const accepted = Array.isArray(validation.accepted)
    ? validation.accepted
    : Array.isArray(fallback?.accepted)
      ? fallback.accepted
      : null;
  if (!accepted) {
    return isHebrew
      ? `התחנה הזאת דורשת פעולה באתר או צילום, ולא תשובת טקסט.\n${webAppUrl}`
      : `This checkpoint requires a web action or photo rather than a text answer.\n${webAppUrl}`;
  }

  const rule: TextValidation = {
    type: "text",
    accepted: accepted.filter((item): item is string => typeof item === "string"),
    fuzzyThreshold:
      typeof validation.fuzzyThreshold === "number"
        ? validation.fuzzyThreshold
        : 0.94
  };
  const evaluation = evaluateTextAnswer(body, rule);
  const scoring = asObject(checkpoint.scoring) as ScoringConfig;
  const reference = team.last_progress_at ?? team.started_at ?? new Date().toISOString();
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(reference).getTime()) / 1000)
  );
  const scoreDelta = calculateScoreDelta({
    correct: evaluation.correct,
    wrongAttempts: team.wrong_attempts,
    hintsUsed: team.hints_used,
    elapsedSeconds,
    scoring
  });

  const { data: nextCheckpoint } = await supabase
    .from("run_checkpoints")
    .select("slug,sequence_no,content")
    .eq("run_id", run.id)
    .eq("is_disabled", false)
    .gt("sequence_no", checkpoint.sequence_no)
    .order("sequence_no")
    .limit(1)
    .maybeSingle();
  const isFinal = checkpoint.kind === "finale" || !nextCheckpoint;

  const { error } = await supabase.rpc("apply_submission", {
    p_team_id: team.id,
    p_participant_id: participant.id,
    p_checkpoint_id: checkpoint.id,
    p_submission_type: "whatsapp_text",
    p_normalized_answer: evaluation.normalizedAnswer,
    p_payload: { source: "whatsapp" },
    p_is_correct: evaluation.correct,
    p_score_delta: scoreDelta,
    p_validation_reason: evaluation.reason,
    p_idempotency_key: `wa-answer:${messageSid || randomToken(8)}`,
    p_next_checkpoint_slug: nextCheckpoint?.slug ?? null,
    p_is_final: isFinal
  });
  if (error) throw error;

  if (!evaluation.correct) {
    return isHebrew
      ? `לא בדיוק. נסו שוב.${scoreDelta < 0 ? ` (${scoreDelta} נקודות)` : ""}`
      : `Not quite. Try again.${scoreDelta < 0 ? ` (${scoreDelta} points)` : ""}`;
  }

  const success = localText(
    asObject(checkpoint.content),
    locale,
    "success",
    isHebrew ? "נכון!" : "Correct!"
  );

  if (!nextCheckpoint) return `${success}\n\n${webAppUrl}`;

  await deliverCheckpointToTeam({
    runId: run.id,
    teamId: team.id,
    slug: nextCheckpoint.slug,
    excludeParticipantId: participant.id
  });

  const nextMission = formatCheckpointMessage({
    contentValue: nextCheckpoint.content,
    locale,
    sequenceNo: nextCheckpoint.sequence_no,
    resumeLink: webAppUrl
  });
  return `${success}\n\n━━━━━━━━━━\n\n${nextMission}`;
};
