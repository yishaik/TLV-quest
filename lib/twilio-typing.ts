const TWILIO_TYPING_INDICATOR_URL =
  "https://messaging.twilio.com/v3/Indicators/Typing.json";

export const TWILIO_TYPING_INDICATOR_TIMEOUT_MS = 1_500;

const TWILIO_INBOUND_MESSAGE_SID = /^(?:SM|MM)[0-9a-fA-F]{32}$/;

type TypingIndicatorLogger = Pick<Console, "info" | "warn">;

export type TypingIndicatorOutcome =
  | "success"
  | "disabled"
  | "invalid_sid"
  | "missing_credentials"
  | "timeout"
  | "provider_error"
  | "network_error";

export const isTwilioInboundMessageSid = (
  messageSid: string | null | undefined
): messageSid is string =>
  typeof messageSid === "string" &&
  TWILIO_INBOUND_MESSAGE_SID.test(messageSid);

const roundedDuration = (value: number): number =>
  Math.max(0, Math.round(value));

export const sendWhatsappTypingIndicator = async ({
  enabled,
  messageSid,
  accountSid,
  authToken,
  requestStartedAtMs,
  timeoutMs = TWILIO_TYPING_INDICATOR_TIMEOUT_MS,
  fetchImpl = fetch,
  logger = console,
  now = Date.now
}: {
  enabled: boolean;
  messageSid: string | null | undefined;
  accountSid: string | undefined;
  authToken: string | undefined;
  requestStartedAtMs: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  logger?: TypingIndicatorLogger;
  now?: () => number;
}): Promise<TypingIndicatorOutcome> => {
  if (!enabled) return "disabled";

  if (!isTwilioInboundMessageSid(messageSid)) {
    logger.info("whatsapp.typing_indicator", {
      outcome: "invalid_sid"
    });
    return "invalid_sid";
  }

  if (!accountSid || !authToken) {
    logger.warn("whatsapp.typing_indicator", {
      outcome: "missing_credentials"
    });
    return "missing_credentials";
  }

  const startedAtMs = now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(TWILIO_TYPING_INDICATOR_URL, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Basic ${Buffer.from(
          `${accountSid}:${authToken}`
        ).toString("base64")}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        channel: "WHATSAPP",
        messageId: messageSid
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      logger.warn("whatsapp.typing_indicator", {
        outcome: "provider_error",
        providerStatus: response.status,
        durationMs: roundedDuration(now() - startedAtMs)
      });
      return "provider_error";
    }

    const result = (await response.json().catch(() => null)) as {
      success?: unknown;
    } | null;
    if (result?.success !== true) {
      logger.warn("whatsapp.typing_indicator", {
        outcome: "provider_error",
        providerStatus: response.status,
        durationMs: roundedDuration(now() - startedAtMs)
      });
      return "provider_error";
    }

    const completedAtMs = now();
    logger.info("whatsapp.typing_indicator", {
      outcome: "success",
      durationMs: roundedDuration(completedAtMs - startedAtMs),
      timeToFirstFeedbackMs: roundedDuration(
        completedAtMs - requestStartedAtMs
      )
    });
    return "success";
  } catch (error) {
    const timedOut =
      controller.signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError");
    const outcome = timedOut ? "timeout" : "network_error";
    logger.warn("whatsapp.typing_indicator", {
      outcome,
      durationMs: roundedDuration(now() - startedAtMs)
    });
    return outcome;
  } finally {
    clearTimeout(timeout);
  }
};
