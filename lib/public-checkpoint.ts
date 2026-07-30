import type { ParticipantState } from "@/lib/repository";

type InternalCheckpoint = NonNullable<ParticipantState["checkpoint"]>;
type ParticipantLocale = ParticipantState["participant"]["language"];

export type PublicCheckpoint = {
  id: string;
  slug: string;
  sequenceNo: number;
  kind: string;
  content: Record<string, unknown>;
  validationType: string;
  choiceOptions: string[];
  hasFallback: boolean;
  fallbackPrompt: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  isOptional: boolean;
  scanVerified: boolean;
  photoFallbackAvailable: boolean;
};

const cleanStrings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && Boolean(item.trim())
      )
    : [];

export const publicFallbackSummary = (
  fallback: InternalCheckpoint["fallback"],
  locale: ParticipantLocale
) => {
  const prompt =
    fallback && typeof fallback[locale] === "string"
      ? fallback[locale].trim()
      : "";
  const hasAcceptedAnswers =
    fallback !== null && cleanStrings(fallback.accepted).length > 0;

  return {
    hasFallback: Boolean(prompt && hasAcceptedAnswers),
    fallbackPrompt: prompt || null
  };
};

export const toPublicCheckpoint = (
  checkpoint: InternalCheckpoint,
  {
    locale,
    isOptional,
    scanVerified,
    photoFallbackAvailable
  }: {
    locale: ParticipantLocale;
    isOptional: boolean;
    scanVerified: boolean;
    photoFallbackAvailable: boolean;
  }
): PublicCheckpoint => {
  const validationType =
    typeof checkpoint.validation.type === "string"
      ? checkpoint.validation.type
      : checkpoint.kind;
  const fallback = publicFallbackSummary(checkpoint.fallback, locale);

  return {
    id: checkpoint.id,
    slug: checkpoint.slug,
    sequenceNo: checkpoint.sequenceNo,
    kind: checkpoint.kind,
    content: checkpoint.content,
    validationType,
    choiceOptions:
      validationType === "choice"
        ? cleanStrings(checkpoint.validation.options)
        : [],
    hasFallback: fallback.hasFallback,
    fallbackPrompt:
      fallback.hasFallback && photoFallbackAvailable
        ? fallback.fallbackPrompt
        : null,
    latitude: checkpoint.latitude,
    longitude: checkpoint.longitude,
    radiusMeters: checkpoint.radiusMeters,
    isOptional,
    scanVerified,
    photoFallbackAvailable
  };
};
