type Locale = "he" | "en";

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: {
    message?: unknown;
    details?: { code?: unknown } | unknown;
  };
};

export class PhotoUploadClientError extends Error {
  readonly retryable: boolean;

  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "PhotoUploadClientError";
    this.retryable =
      status === undefined ||
      status < 400 ||
      status === 408 ||
      status === 429 ||
      status >= 500 ||
      code === "photo_upload_not_ready";
  }
}

export const photoUploadCopy = (
  locale: Locale,
  key: "tooLarge" | "unsupported" | "network" | "failed"
) => {
  const messages = {
    tooLarge: {
      he: "התמונה גדולה מדי. ניתן להעלות תמונה בגודל של עד 10MB.",
      en: "The image is too large. You can upload an image up to 10MB."
    },
    unsupported: {
      he: "אפשר להעלות תמונה בפורמט JPG, PNG או WebP בלבד.",
      en: "Please upload a JPG, PNG, or WebP image."
    },
    network: {
      he: "לא הצלחנו להעלות את התמונה. בדקו את החיבור ונסו שוב.",
      en: "We could not upload the image. Check your connection and try again."
    },
    failed: {
      he: "העלאת התמונה נכשלה. נסו שוב בעוד רגע.",
      en: "The photo upload failed. Please try again in a moment."
    }
  } as const;
  return messages[key][locale];
};

const messageForStatus = (status: number, locale: Locale) => {
  if (status === 413) return photoUploadCopy(locale, "tooLarge");
  if (status === 415) return photoUploadCopy(locale, "unsupported");
  if (status === 408 || status === 429 || status >= 500) {
    return photoUploadCopy(locale, "network");
  }
  return photoUploadCopy(locale, "failed");
};

export const readPhotoApiData = async <T>(
  response: Response,
  locale: Locale
): Promise<T> => {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  let payload: ApiEnvelope<T> | null = null;

  if (contentType.includes("application/json")) {
    try {
      payload = JSON.parse(await response.text()) as ApiEnvelope<T>;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const serverMessage =
      payload?.error && typeof payload.error.message === "string"
        ? payload.error.message.trim()
        : "";
    const serverCode =
      payload?.error &&
      payload.error.details &&
      typeof payload.error.details === "object" &&
      !Array.isArray(payload.error.details) &&
      typeof (payload.error.details as { code?: unknown }).code === "string"
        ? String((payload.error.details as { code: string }).code)
        : undefined;
    throw new PhotoUploadClientError(
      response.status === 413 || response.status === 415
        ? messageForStatus(response.status, locale)
        : serverMessage || messageForStatus(response.status, locale),
      response.status,
      serverCode
    );
  }

  if (!payload || payload.ok !== true || payload.data === undefined) {
    throw new PhotoUploadClientError(
      photoUploadCopy(locale, "failed"),
      response.status
    );
  }

  return payload.data;
};
