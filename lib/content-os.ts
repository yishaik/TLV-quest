export type ContentVersionStatus =
  | "draft"
  | "review"
  | "published"
  | "superseded"
  | "archived";

export type CheckpointHealthStatus =
  | "not_required"
  | "pending"
  | "verified"
  | "needs_attention"
  | "blocked";

export type ContentCheckpoint = {
  id: string;
  template_id: string;
  version: number;
  slug: string;
  sequence_no: number;
  kind: string;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  accessibility: Record<string, unknown>;
  config: Record<string, unknown>;
  is_optional: boolean;
  is_active: boolean;
};

export type ContentHealth = {
  checkpoint_id: string;
  status: CheckpointHealthStatus;
  checklist: Record<string, unknown>;
  notes: string | null;
  last_checked_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  updated_at: string;
  updated_by: string | null;
};

export type ContentValidationIssue = {
  code: string;
  message: string;
  checkpointId?: string;
  checkpointSlug?: string;
};

export type ContentValidationReport = {
  ok: boolean;
  errors: ContentValidationIssue[];
  warnings: ContentValidationIssue[];
  checkpointCount: number;
  unverifiedCount: number;
  generatedAt: string;
};

export const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const arrayValue = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

export const textValue = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

export const numberValue = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const booleanValue = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

export const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const normalizeContentSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

export const checkpointNeedsFieldVerification = (checkpoint: ContentCheckpoint) =>
  checkpoint.config.field_verification_required === true ||
  checkpoint.accessibility.field_verification_required === true;

const localizedField = (
  checkpoint: ContentCheckpoint,
  locale: "he" | "en",
  field: string
) => {
  const content = objectValue(checkpoint.config.content);
  const localized = objectValue(content[locale]);
  return textValue(localized[field]).trim();
};

export const buildContentValidationReport = ({
  checkpoints,
  healthByCheckpoint
}: {
  checkpoints: ContentCheckpoint[];
  healthByCheckpoint: Map<string, ContentHealth>;
}): ContentValidationReport => {
  const active = checkpoints
    .filter((checkpoint) => checkpoint.is_active)
    .sort((left, right) => left.sequence_no - right.sequence_no);
  const errors: ContentValidationIssue[] = [];
  const warnings: ContentValidationIssue[] = [];

  if (!active.length) {
    errors.push({
      code: "no_checkpoints",
      message: "The route must contain at least one active checkpoint."
    });
  }

  for (const checkpoint of active) {
    const missing = (["he", "en"] as const).flatMap((locale) =>
      ["title", "prompt"]
        .filter((field) => !localizedField(checkpoint, locale, field))
        .map((field) => `${locale}.${field}`)
    );

    if (missing.length) {
      errors.push({
        code: "missing_bilingual_content",
        message: `Missing required content: ${missing.join(", ")}.`,
        checkpointId: checkpoint.id,
        checkpointSlug: checkpoint.slug
      });
    }

    const validation = objectValue(checkpoint.config.validation);
    if (["text", "location", "finale", "hybrid"].includes(checkpoint.kind)) {
      const accepted = arrayValue(validation.accepted).filter(
        (value) => typeof value === "string" && value.trim()
      );
      if (!accepted.length) {
        errors.push({
          code: "missing_accepted_answers",
          message: "Text-based checkpoints require at least one accepted answer.",
          checkpointId: checkpoint.id,
          checkpointSlug: checkpoint.slug
        });
      }
    }

    if (checkpoint.kind === "photo" && !textValue(validation.criteria).trim()) {
      errors.push({
        code: "missing_photo_criteria",
        message: "Photo checkpoints require clear AI validation criteria.",
        checkpointId: checkpoint.id,
        checkpointSlug: checkpoint.slug
      });
    }

    if (checkpoint.kind === "choice") {
      const options = arrayValue(validation.options).filter(
        (value): value is string => typeof value === "string" && Boolean(value.trim())
      );
      const acceptedOption = textValue(validation.acceptedOption).trim();
      if (
        options.length < 2 ||
        !acceptedOption ||
        !options.includes(acceptedOption)
      ) {
        errors.push({
          code: "invalid_choice_validation",
          message:
            "Choice checkpoints require at least two options and an accepted option from that list.",
          checkpointId: checkpoint.id,
          checkpointSlug: checkpoint.slug
        });
      }
    }

    const locationSensitive =
      checkpoint.kind === "location" ||
      checkpoint.kind === "finale" ||
      checkpointNeedsFieldVerification(checkpoint);

    if (
      locationSensitive &&
      (checkpoint.latitude === null ||
        checkpoint.longitude === null ||
        checkpoint.radius_meters === null ||
        checkpoint.radius_meters <= 0)
    ) {
      errors.push({
        code: "missing_location",
        message: "Coordinates and a positive verification radius are required.",
        checkpointId: checkpoint.id,
        checkpointSlug: checkpoint.slug
      });
    }
  }

  const finales = active.filter((checkpoint) => checkpoint.kind === "finale");
  if (finales.length !== 1) {
    errors.push({
      code: "invalid_finale_count",
      message: "The route must contain exactly one finale."
    });
  } else if (active.at(-1)?.id !== finales[0].id) {
    errors.push({
      code: "finale_not_last",
      message: "The finale must be the final active checkpoint.",
      checkpointId: finales[0].id,
      checkpointSlug: finales[0].slug
    });
  }

  const unverified = active.filter((checkpoint) => {
    if (!checkpointNeedsFieldVerification(checkpoint)) return false;
    return healthByCheckpoint.get(checkpoint.id)?.status !== "verified";
  });

  for (const checkpoint of unverified) {
    warnings.push({
      code: "field_verification_required",
      message: "This station still requires an on-site verification walk.",
      checkpointId: checkpoint.id,
      checkpointSlug: checkpoint.slug
    });
  }

  return {
    ok: errors.length === 0 && unverified.length === 0,
    errors,
    warnings,
    checkpointCount: active.length,
    unverifiedCount: unverified.length,
    generatedAt: new Date().toISOString()
  };
};

export const mergeLocalizedCheckpointContent = ({
  config,
  content
}: {
  config: Record<string, unknown>;
  content: Record<string, unknown>;
}) => ({
  ...config,
  content: {
    ...objectValue(config.content),
    ...content
  }
});
