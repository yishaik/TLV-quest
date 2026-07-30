import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getParticipantState } from "@/lib/repository";

export const skipOptionalCheckpoint = async ({
  token,
  idempotencyKey
}: {
  token: string;
  idempotencyKey: string;
}) => {
  const state = await getParticipantState(token);
  if (state.run.status !== "active") throw new Error("Game is not active");
  if (!state.checkpoint) throw new Error("No active checkpoint");

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("skip_optional_checkpoint", {
    p_team_id: state.team.id,
    p_participant_id: state.participant.id,
    p_checkpoint_id: state.checkpoint.id,
    p_idempotency_key: idempotencyKey
  });
  if (error) throw error;

  return {
    skipped: true,
    checkpointSlug: state.checkpoint.slug,
    result: data
  };
};
