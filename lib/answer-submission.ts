import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  calculateScoreDelta,
  evaluateTextAnswer,
  type ScoringConfig,
  type TextValidation
} from "@/lib/game-engine";
import { getParticipantState, type ParticipantState } from "@/lib/repository";

type UnknownRecord = Record<string, unknown>;

const objectValue = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};

const textValue = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

const validationForCheckpoint = (state: ParticipantState): TextValidation => {
  const checkpoint = state.checkpoint;
  if (!checkpoint) throw new Error("No active checkpoint");

  const validation = checkpoint.validation;
  if (validation.type === "text" && Array.isArray(validation.accepted)) {
    return {
      type: "text",
      accepted: validation.accepted.filter(
        (item): item is string => typeof item === "string"
      ),
      fuzzyThreshold:
        typeof validation.fuzzyThreshold === "number"
          ? validation.fuzzyThreshold
          : undefined
    };
  }

  if (
    validation.type === "choice" &&
    typeof validation.acceptedOption === "string" &&
    validation.acceptedOption.trim()
  ) {
    return {
      type: "text",
      accepted: [validation.acceptedOption],
      fuzzyThreshold: undefined
    };
  }

  const fallback = checkpoint.fallback;
  if (fallback && Array.isArray(fallback.accepted)) {
    return {
      type: "text",
      accepted: fallback.accepted.filter(
        (item): item is string => typeof item === "string"
      ),
      fuzzyThreshold: 0.94
    };
  }

  throw new Error("This checkpoint does not accept an answer");
};

const queueSuccessMessage = async ({
  state,
  success
}: {
  state: ParticipantState;
  success: string;
}) => {
  const supabase = createAdminClient();
  const { data: participants, error } = await supabase
    .from("participants")
    .select("id,phone_ciphertext")
    .eq("team_id", state.team.id)
    .not("phone_ciphertext", "is", null);
  if (error) throw error;
  if (!participants?.length) return;

  const { error: insertError } = await supabase.from("message_outbox").insert(
    participants.map((participant) => ({
      run_id: state.run.id,
      participant_id: participant.id,
      channel: "whatsapp",
      recipient_ciphertext: participant.phone_ciphertext,
      payload: { body: success, locale: state.participant.language }
    }))
  );
  if (insertError) throw insertError;
};

export const submitCheckpointAnswer = async ({
  token,
  answer,
  idempotencyKey
}: {
  token: string;
  answer: string;
  idempotencyKey: string;
}) => {
  const state = await getParticipantState(token);
  if (state.run.status !== "active") throw new Error("Game is not active");
  if (!state.checkpoint) throw new Error("No active checkpoint");

  const validation = validationForCheckpoint(state);
  const evaluation = evaluateTextAnswer(answer, validation);
  const scoring = state.checkpoint.scoring as ScoringConfig;
  const referenceTime =
    state.team.lastProgressAt ?? state.team.startedAt ?? new Date().toISOString();
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(referenceTime).getTime()) / 1000)
  );
  const scoreDelta = calculateScoreDelta({
    correct: evaluation.correct,
    wrongAttempts: state.team.wrongAttempts,
    hintsUsed: state.team.hintsUsed,
    elapsedSeconds,
    scoring
  });

  const supabase = createAdminClient();
  const { data: nextCheckpoint, error: nextError } = await supabase
    .from("run_checkpoints")
    .select("slug,sequence_no")
    .eq("run_id", state.run.id)
    .eq("is_disabled", false)
    .gt("sequence_no", state.checkpoint.sequenceNo)
    .order("sequence_no")
    .limit(1)
    .maybeSingle();
  if (nextError) throw nextError;

  const isFinal = state.checkpoint.kind === "finale" || !nextCheckpoint;
  const { data: result, error } = await supabase.rpc("apply_submission", {
    p_team_id: state.team.id,
    p_participant_id: state.participant.id,
    p_checkpoint_id: state.checkpoint.id,
    p_submission_type:
      state.checkpoint.validation.type === "choice" ? "choice" : "text",
    p_normalized_answer: evaluation.normalizedAnswer,
    p_payload: {
      rawLength: answer.length,
      reason: evaluation.reason,
      kind: state.checkpoint.kind
    },
    p_is_correct: evaluation.correct,
    p_score_delta: scoreDelta,
    p_validation_reason: evaluation.reason,
    p_idempotency_key: idempotencyKey,
    p_next_checkpoint_slug: nextCheckpoint?.slug ?? null,
    p_is_final: isFinal
  });
  if (error) throw error;

  if (evaluation.correct) {
    const locale = state.participant.language;
    const contentForLocale = objectValue(state.checkpoint.content[locale]);
    const success = textValue(
      contentForLocale.success,
      locale === "he" ? "נכון!" : "Correct!"
    );
    await queueSuccessMessage({ state, success });
  }

  return { evaluation, scoreDelta, result };
};
