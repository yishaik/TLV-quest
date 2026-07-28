import "server-only";

import { decryptPii } from "@/lib/crypto";
import { publicEnv } from "@/lib/env";
import { sendWhatsapp } from "@/lib/providers";
import { createAdminClient } from "@/lib/supabase/admin";

type JsonRecord = Record<string, unknown>;
type Locale = "he" | "en";

const asObject = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

export const resumeUrl = `${publicEnv.appUrl}/resume`;

export const formatCheckpointMessage = ({
  contentValue,
  locale,
  sequenceNo
}: {
  contentValue: unknown;
  locale: Locale;
  sequenceNo?: number | null;
}): string => {
  const content = asObject(contentValue);
  const localized = asObject(content[locale]);
  const title = text(localized.title);
  const story = text(localized.story);
  const prompt = text(localized.prompt);
  const locationHint = text(localized.locationHint);
  const stationLabel = sequenceNo
    ? locale === "he"
      ? `🧭 תחנה ${sequenceNo}${title ? ` — ${title}` : ""}`
      : `🧭 Checkpoint ${sequenceNo}${title ? ` — ${title}` : ""}`
    : title;
  const taskLabel = locale === "he" ? "המשימה:" : "Your mission:";
  const locationLabel = locale === "he" ? "📍 איפה:" : "📍 Where:";
  const appLabel =
    locale === "he"
      ? `למפה, ניקוד והמשך המשחק:\n${resumeUrl}`
      : `Open the map, score and web game:\n${resumeUrl}`;

  return [
    stationLabel,
    story,
    prompt ? `${taskLabel}\n${prompt}` : "",
    locationHint ? `${locationLabel} ${locationHint}` : "",
    appLabel
  ]
    .filter(Boolean)
    .join("\n\n");
};

export const getCheckpointMessage = async ({
  runId,
  slug,
  locale
}: {
  runId: string;
  slug: string;
  locale: Locale;
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
    sequenceNo: data.sequence_no
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
  const [{ data: checkpoint, error: checkpointError }, { data: participants, error: participantError }] =
    await Promise.all([
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
      sequenceNo: checkpoint.sequence_no
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
