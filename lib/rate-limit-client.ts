type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};

const boundedSeconds = (value: unknown): number | null => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(86_400, Math.max(1, Math.ceil(parsed)))
    : null;
};

export const readRetryAfterSeconds = (
  response: Response,
  payload: unknown
): number | null => {
  if (response.status !== 429) return null;

  const error = asRecord(asRecord(payload).error);
  const details = asRecord(error.details);
  return (
    boundedSeconds(details.retryAfterSeconds) ??
    boundedSeconds(response.headers.get("retry-after"))
  );
};
