export const SUPPORTED_TWILIO_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);

export class TwilioMediaError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "TwilioMediaError";
  }
}

export const validatedTwilioMediaUrl = (
  mediaUrl: string,
  accountSid: string
) => {
  let url: URL;
  try {
    url = new URL(mediaUrl);
  } catch {
    throw new TwilioMediaError("twilio_media_url_rejected");
  }

  const hostname = url.hostname.toLowerCase();
  const trustedHost =
    hostname === "api.twilio.com" ||
    /^api(?:\.[a-z0-9-]+)+\.twilio\.com$/.test(hostname);
  const segments = url.pathname.split("/").filter(Boolean);
  const trustedPath =
    segments.length === 7 &&
    segments[0] === "2010-04-01" &&
    segments[1] === "Accounts" &&
    segments[2] === accountSid &&
    segments[3] === "Messages" &&
    /^(?:SM|MM)[a-f0-9]{32}$/i.test(segments[4] ?? "") &&
    segments[5] === "Media" &&
    /^ME[a-f0-9]{32}$/i.test(segments[6] ?? "");

  if (
    url.protocol !== "https:" ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !trustedHost ||
    !trustedPath
  ) {
    throw new TwilioMediaError("twilio_media_url_rejected");
  }

  return url;
};
