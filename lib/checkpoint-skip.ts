import "server-only";

import { formatCheckpointSkipMessage } from "@/lib/checkpoint-messages";
import { participantResumeUrl } from "@/lib/participant-resume";
import { createAdminClient } from "@/lib/supabase/admin";

type Locale = "he" | "en";
type UnknownRecord = Record<string, unknown>;

type SkipActor =
  | { type: "organizer" }
  | { type: "participant"; participantId: string };

type CheckpointRow = {
  slug: string;
  sequence_no: number;
  content: unknown;
};

export type CheckpointSkipResult = {
  duplicate: boolean;
  actorType: SkipActor["type"];
  reason: string;
  previousCheckpointSlug: string | null;
  nextCheckpointSlug: string | null;
  outcome: "advanced" | "finished";
  queued: number;
  outboxIds: string[];
};

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};

const optionalText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const safeOutboxIds = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (candidate): candidate is string =>
          typeof candidate === "string" && candidate.length > 0
      )
    : [];

const parseSkipResult = (value: unknown): CheckpointSkipResult => {
  const result = asRecord(Array.isArray(value) ? value[0] : value);
  const outcome = result.outcome === "finished" ? "finished" : "advanced";
  const outboxIds = safeOutboxIds(result.outboxIds);
  return {
    duplicate: result.duplicate === true,
    actorType: result.actorType === "participant" ? "participant" : "organizer",
    reason: typeof result.reason === "string" ? result.reason : "checkpoint_skip",
    previousCheckpointSlug: optionalText(result.previousCheckpointSlug),
    nextCheckpointSlug: optionalText(result.nextCheckpointSlug),
    outcome,
    queued:
      typeof result.queued === "number" && Number.isFinite(result.queued)
        ? Math.max(0, Math.floor(result.queued))
        : outboxIds.length,
    outboxIds
  };
};

export const skipCheckpointForTeam = async ({
  teamId,
  actor,
  reason,
  requireOptional,
  idempotencyKey
}: {
  teamId: string;
  actor: SkipActor;
  reason: "organizer_override" | "participant_optional_skip";
  requireOptional: boolean;
  idempotencyKey: string;
}): Promise<CheckpointSkipResult> => {
  const supabase = createAdminClient();
  const { data: team, error: teamError } = await supabase
    .from("teams")
    .select("run_id,current_checkpoint_slug")
    .eq("id", teamId)
    .single();
  if (teamError || !team) throw teamError ?? new Error("team_not_found");

  const [{ data: checkpoints, error: checkpointError }, participantsResult] =
    await Promise.all([
      supabase
        .from("run_checkpoints")
        .select("slug,sequence_no,content")
        .eq("run_id", team.run_id)
        .eq("is_disabled", false)
        .order("sequence_no"),
      supabase
        .from("participants")
        .select("id,language")
        .eq("run_id", team.run_id)
        .eq("team_id", teamId)
        .not("phone_ciphertext", "is", null)
        .not("whatsapp_connected_at", "is", null)
    ]);
  if (checkpointError) throw checkpointError;
  if (participantsResult.error) throw participantsResult.error;

  const ordered = (checkpoints ?? []) as CheckpointRow[];
  const currentIndex = ordered.findIndex(
    (checkpoint) => checkpoint.slug === team.current_checkpoint_slug
  );
  const next =
    currentIndex >= 0 ? (ordered[currentIndex + 1] ?? null) : null;
  const canPrepareDeliveries = currentIndex >= 0;
  const finished = canPrepareDeliveries && !next;
  const deliveries = canPrepareDeliveries
    ? (participantsResult.data ?? [])
        .filter(
          (participant) =>
            actor.type !== "participant" ||
            participant.id !== actor.participantId
        )
        .map((participant) => {
          const locale: Locale = participant.language === "en" ? "en" : "he";
          return {
            participant_id: participant.id,
            body: formatCheckpointSkipMessage({
              contentValue: next?.content,
              locale,
              sequenceNo: next?.sequence_no ?? null,
              resumeLink: participantResumeUrl(participant.id),
              finished
            })
          };
        })
    : [];

  const { data, error } = await supabase.rpc("progress_checkpoint_skip", {
    p_team_id: teamId,
    p_actor_type: actor.type,
    p_actor_participant_id:
      actor.type === "participant" ? actor.participantId : null,
    p_reason: reason,
    p_require_optional: requireOptional,
    p_expected_checkpoint_slug: team.current_checkpoint_slug,
    p_idempotency_key: idempotencyKey,
    p_deliveries: deliveries
  });
  if (error) throw error;

  const result = parseSkipResult(data);
  if (!result.previousCheckpointSlug && currentIndex >= 0) {
    result.previousCheckpointSlug = ordered[currentIndex].slug;
  }
  if (result.outcome === "advanced" && !result.nextCheckpointSlug && next) {
    result.nextCheckpointSlug = next.slug;
  }
  return result;
};
