const TWILIO_API_HOST =
  /^api(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?){0,2}\.twilio\.com$/i;

export const TWILIO_MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const TWILIO_MEDIA_DOWNLOAD_TIMEOUT_MS = 15_000;

export type TwilioMediaDownloadErrorCode =
  | "invalid_twilio_media_url"
  | "twilio_media_redirect_rejected"
  | "twilio_media_download_failed"
  | "twilio_media_download_timeout"
  | "twilio_media_too_large";

export class TwilioMediaDownloadError extends Error {
  readonly code: TwilioMediaDownloadErrorCode;
  readonly status?: number;

  constructor(code: TwilioMediaDownloadErrorCode, status?: number) {
    super(status === undefined ? code : `${code}:${status}`);
    this.name = "TwilioMediaDownloadError";
    this.code = code;
    this.status = status;
  }
}

export const assertTwilioMediaUrl = (rawUrl: string): URL => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TwilioMediaDownloadError("invalid_twilio_media_url");
  }

  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    !TWILIO_API_HOST.test(url.hostname)
  ) {
    throw new TwilioMediaDownloadError("invalid_twilio_media_url");
  }

  url.hash = "";
  return url;
};

const rejectOversizedBody = async (body: ReadableStream<Uint8Array> | null) => {
  await body?.cancel().catch(() => undefined);
  throw new TwilioMediaDownloadError("twilio_media_too_large");
};

export const readResponseBodyWithLimit = async (
  response: Response,
  maxBytes = TWILIO_MEDIA_MAX_BYTES
): Promise<Uint8Array> => {
  const contentLength = response.headers.get("content-length")?.trim();
  if (contentLength && /^\d+$/.test(contentLength)) {
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
      return rejectOversizedBody(response.body);
    }
  }

  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new TwilioMediaDownloadError("twilio_media_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export const downloadTwilioMedia = async ({
  mediaUrl,
  accountSid,
  authToken,
  maxBytes = TWILIO_MEDIA_MAX_BYTES,
  timeoutMs = TWILIO_MEDIA_DOWNLOAD_TIMEOUT_MS,
  fetchImpl = fetch
}: {
  mediaUrl: string;
  accountSid: string;
  authToken: string;
  maxBytes?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<Uint8Array> => {
  const validatedUrl = assertTwilioMediaUrl(mediaUrl);
  const authorization = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(validatedUrl, {
      cache: "no-store",
      headers: { authorization: `Basic ${authorization}` },
      redirect: "manual",
      signal: controller.signal
    });

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new TwilioMediaDownloadError("twilio_media_redirect_rejected");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new TwilioMediaDownloadError(
        "twilio_media_download_failed",
        response.status
      );
    }

    return await readResponseBodyWithLimit(response, maxBytes);
  } catch (error) {
    if (error instanceof TwilioMediaDownloadError) throw error;
    if (controller.signal.aborted) {
      throw new TwilioMediaDownloadError("twilio_media_download_timeout");
    }
    throw new TwilioMediaDownloadError("twilio_media_download_failed");
  } finally {
    clearTimeout(timeout);
  }
};
