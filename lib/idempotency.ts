import "server-only";

import { AppError } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";

type UnknownRecord = Record<string, unknown>;

export type ParticipantIdempotencyEvent = {
  eventType: string;
  payload: UnknownRecord;
};

export const idempotencyObject = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};

export const isIdempotencyReplay = (value: unknown): boolean =>
  idempotencyObject(Array.isArray(value) ? value[0] : value).duplicate === true;

const idempotencyConflict = () =>
  new AppError({
    message:
      "מזהה הפעולה כבר שייך לפעולה אחרת. רעננו את הדף ונסו שוב. / This action identifier belongs to another action. Refresh and try again.",
    status: 409,
    code: "idempotency_key_conflict"
  });

export const findParticipantIdempotencyEvent = async ({
  idempotencyKey,
  teamId,
  participantId,
  eventTypes
}: {
  idempotencyKey: string;
  teamId: string;
  participantId: string;
  eventTypes: readonly string[];
}): Promise<ParticipantIdempotencyEvent | null> => {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("game_events")
    .select("team_id,participant_id,event_type,payload")
    .eq("idempotency_key", idempotencyKey)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  if (
    data.team_id !== teamId ||
    data.participant_id !== participantId ||
    !eventTypes.includes(data.event_type)
  ) {
    throw idempotencyConflict();
  }

  return {
    eventType: data.event_type,
    payload: idempotencyObject(data.payload)
  };
};

export const throwIdempotencyConflict = (): never => {
  throw idempotencyConflict();
};
