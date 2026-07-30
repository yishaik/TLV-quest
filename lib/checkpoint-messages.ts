export type CheckpointMessageLocale = "he" | "en";

type JsonRecord = Record<string, unknown>;

const asObject = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

export const formatCheckpointMessage = ({
  contentValue,
  locale,
  sequenceNo,
  resumeLink = "/resume"
}: {
  contentValue: unknown;
  locale: CheckpointMessageLocale;
  sequenceNo?: number | null;
  resumeLink?: string;
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
      ? `למפה, ניקוד והמשך המשחק:\n${resumeLink}`
      : `Open the map, score and web game:\n${resumeLink}`;

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

export const formatCheckpointSkipMessage = ({
  contentValue,
  locale,
  sequenceNo,
  resumeLink = "/resume",
  finished = false
}: {
  contentValue?: unknown;
  locale: CheckpointMessageLocale;
  sequenceNo?: number | null;
  resumeLink?: string;
  finished?: boolean;
}): string => {
  if (finished) {
    return locale === "he"
      ? `🎉 התחנה דולגה והמסלול הושלם.\n\nלתוצאות ולסיכום:\n${resumeLink}`
      : `🎉 The checkpoint was skipped and the route is complete.\n\nResults and recap:\n${resumeLink}`;
  }

  const transition =
    locale === "he"
      ? "⏭️ התחנה הקודמת דולגה."
      : "⏭️ The previous checkpoint was skipped.";
  return `${transition}\n\n━━━━━━━━━━\n\n${formatCheckpointMessage({
    contentValue,
    locale,
    sequenceNo,
    resumeLink
  })}`;
};
