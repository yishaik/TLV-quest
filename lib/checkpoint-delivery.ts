import "server-only";

import {
  formatCheckpointMessage,
  formatCheckpointSkipMessage,
  type CheckpointMessageLocale
} from "@/lib/checkpoint-messages";
import { decryptPii } from "@/lib/crypto";
import { publicEnv } from "@/lib/env";
import { participantResumeUrl } from "@/lib/participant-resume";
import { sendWhatsapp } from "@/lib/providers";
import { createAdminClient } from "@/lib/supabase/admin";

type Locale = CheckpointMessageLocale;

export const resumeUrl = `${publicEnv.appUrl}/resume`;

export { formatCheckpointMessage, formatCheckpointSkipMessage };

export const getCheckpointMessage = async ({
  runId,
  slug,
  locale,
  participantId
}: {
  runId: string;
  slug: string;
  locale: Locale;
  participantId?: string;
}) => {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("run_checkpoints")
    .select("slug,sequence_no,content")
    .eq("run_id", runId)
    .eq("slug", slug)
    .single();
  if (error || !data) throw error ?? new Error("Checkpoint was not found");

  return formatCheckpointMessage({
    contentValue: data.content,
    locale,
    sequenceNo: data.sequence_no,
    resumeLink: participantId ? participantResumeUrl(participantId) : resumeUrl
  });
};

export const deliverCheckpointToTeam = async ({
  runId,
  teamId,
  slug,
  excludeParticipantId
}: {
  runId: string;
  teamId: string;
  slug: string;
  excludeParticipantId?: string;
}) => {
  const supabase = createAdminClient();
  const [
    { data: checkpoint, error: checkpointError },
    { data: participants, error: participantError }
  ] = await Promise.all([
    supabase
      .from("run_checkpoints")
      .select("sequence_no,content")
      .eq("run_id", runId)
      .eq("slug", slug)
      .single(),
    supabase
      .from("participants")
      .select("id,language,phone_ciphertext,whatsapp_connected_at")
      .eq("team_id", teamId)
      .not("phone_ciphertext", "is", null)
      .not("whatsapp_connected_at", "is", null)
  ]);

  if (checkpointError || !checkpoint) {
    throw checkpointError ?? new Error("Checkpoint was not found");
  }
  if (participantError) throw participantError;

  let sent = 0;
  let failed = 0;
  for (const participant of participants ?? []) {
    if (participant.id === excludeParticipantId || !participant.phone_ciphertext) continue;
    const locale: Locale = participant.language === "en" ? "en" : "he";
    const body = formatCheckpointMessage({
      contentValue: checkpoint.content,
      locale,
      sequenceNo: checkpoint.sequence_no,
      resumeLink: participantResumeUrl(participant.id)
    });
    try {
      await sendWhatsapp({
        to: decryptPii(participant.phone_ciphertext),
        body
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error("Checkpoint WhatsApp delivery failed", {
        runId,
        teamId,
        participantId: participant.id,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  return { sent, failed };
};

export const deliverCheckpointToRun = async ({
  runId,
  slug
}: {
  runId: string;
  slug: string;
}) => {
  const supabase = createAdminClient();
  const { data: teams, error } = await supabase
    .from("teams")
    .select("id")
    .eq("run_id", runId)
    .in("status", ["travelling", "solving"]);
  if (error) throw error;

  let sent = 0;
  let failed = 0;
  for (const team of teams ?? []) {
    const result = await deliverCheckpointToTeam({
      runId,
      teamId: team.id,
      slug
    });
    sent += result.sent;
    failed += result.failed;
  }

  return { sent, failed };
};
