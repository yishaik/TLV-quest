import "server-only";

import { hashSecret } from "@/lib/crypto";
import { skipCheckpointForTeam } from "@/lib/checkpoint-skip";
import { getParticipantState } from "@/lib/repository";

const normalizedSkipKey = (value: string): string => {
  const candidate = value.trim();
  return candidate.length >= 12 &&
    candidate.length <= 240 &&
    /^[a-zA-Z0-9:_-]+$/.test(candidate)
    ? candidate
    : `participant-skip:${hashSecret(candidate)}`;
};

export const skipOptionalCheckpoint = async ({
  token,
  idempotencyKey
}: {
  token: string;
  idempotencyKey: string;
}) => {
  const state = await getParticipantState(token);
  const transition = await skipCheckpointForTeam({
    teamId: state.team.id,
    actor: {
      type: "participant",
      participantId: state.participant.id
    },
    reason: "participant_optional_skip",
    requireOptional: true,
    idempotencyKey: normalizedSkipKey(idempotencyKey)
  });

  return {
    skipped: true,
    checkpointSlug:
      transition.previousCheckpointSlug ?? state.team.currentCheckpointSlug,
    transition,
    delivery: {
      queued: transition.queued,
      outboxIds: transition.outboxIds
    }
  };
};
