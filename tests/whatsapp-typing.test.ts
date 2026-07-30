import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parseEnabledFeatureFlag } from "../lib/env";
import {
  isTwilioInboundMessageSid,
  sendWhatsappTypingIndicator
} from "../lib/twilio-typing";
import {
  WHATSAPP_PHOTO_PROCESSING_ACK,
  whatsappTwiml
} from "../lib/twilio-webhook-response";

const messageSid = `SM${"a".repeat(32)}`;

const logger = () => ({
  info: vi.fn(),
  warn: vi.fn()
});

describe("WhatsApp typing indicator", () => {
  it("is opt-in and accepts only Twilio message or media SIDs", () => {
    expect(parseEnabledFeatureFlag(undefined)).toBe(false);
    expect(parseEnabledFeatureFlag("false")).toBe(false);
    expect(parseEnabledFeatureFlag(" TRUE ")).toBe(true);

    expect(isTwilioInboundMessageSid(messageSid)).toBe(true);
    expect(isTwilioInboundMessageSid(`MM${"0".repeat(32)}`)).toBe(true);
    expect(isTwilioInboundMessageSid(`ME${"0".repeat(32)}`)).toBe(false);
    expect(isTwilioInboundMessageSid(`sm${"0".repeat(32)}`)).toBe(false);
    expect(isTwilioInboundMessageSid("SM-short")).toBe(false);
    expect(isTwilioInboundMessageSid(undefined)).toBe(false);
  });

  it("does not call the beta API when the feature flag is disabled", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      sendWhatsappTypingIndicator({
        enabled: false,
        messageSid,
        accountSid: "AC_test",
        authToken: "secret",
        requestStartedAtMs: Date.now(),
        fetchImpl
      })
    ).resolves.toBe("disabled");

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the beta request and records time to first feedback", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ success: true })
    );
    const testLogger = logger();
    const ticks = [1_010, 1_035];

    await expect(
      sendWhatsappTypingIndicator({
        enabled: true,
        messageSid,
        accountSid: "AC_test",
        authToken: "secret",
        requestStartedAtMs: 1_000,
        fetchImpl,
        logger: testLogger,
        now: () => ticks.shift() ?? 1_035
      })
    ).resolves.toBe("success");

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(
      "https://messaging.twilio.com/v3/Indicators/Typing.json"
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      channel: "WHATSAPP",
      messageId: messageSid
    });
    expect(init?.headers).toEqual({
      authorization: `Basic ${Buffer.from("AC_test:secret").toString("base64")}`,
      "content-type": "application/json"
    });
    expect(testLogger.info).toHaveBeenCalledWith(
      "whatsapp.typing_indicator",
      expect.objectContaining({
        outcome: "success",
        durationMs: 25,
        timeToFirstFeedbackMs: 35
      })
    );
    expect(JSON.stringify(testLogger)).not.toContain(messageSid);
    expect(JSON.stringify(testLogger)).not.toContain("secret");
  });

  it("times out without rejecting or changing the response path", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );
    const testLogger = logger();

    await expect(
      sendWhatsappTypingIndicator({
        enabled: true,
        messageSid,
        accountSid: "AC_test",
        authToken: "secret",
        requestStartedAtMs: Date.now(),
        timeoutMs: 5,
        fetchImpl,
        logger: testLogger
      })
    ).resolves.toBe("timeout");

    expect(testLogger.warn).toHaveBeenCalledWith(
      "whatsapp.typing_indicator",
      expect.objectContaining({ outcome: "timeout" })
    );
  });

  it("contains beta API errors and logs only sanitized metrics", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { message: "provider rejected the beta request" },
        { status: 503 }
      )
    );
    const testLogger = logger();

    await expect(
      sendWhatsappTypingIndicator({
        enabled: true,
        messageSid,
        accountSid: "AC_test",
        authToken: "secret",
        requestStartedAtMs: Date.now(),
        fetchImpl,
        logger: testLogger
      })
    ).resolves.toBe("provider_error");

    expect(testLogger.warn).toHaveBeenCalledWith(
      "whatsapp.typing_indicator",
      expect.objectContaining({
        outcome: "provider_error",
        providerStatus: 503
      })
    );
    expect(JSON.stringify(testLogger)).not.toContain(
      "provider rejected the beta request"
    );
  });

  it.each([undefined, "", "SM-invalid"])(
    "skips a missing or invalid SID safely: %s",
    async (invalidSid) => {
      const fetchImpl = vi.fn<typeof fetch>();
      const testLogger = logger();

      await expect(
        sendWhatsappTypingIndicator({
          enabled: true,
          messageSid: invalidSid,
          accountSid: "AC_test",
          authToken: "secret",
          requestStartedAtMs: Date.now(),
          fetchImpl,
          logger: testLogger
        })
      ).resolves.toBe("invalid_sid");

      expect(fetchImpl).not.toHaveBeenCalled();
    }
  );

  it("skips safely when beta API credentials are unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const testLogger = logger();

    await expect(
      sendWhatsappTypingIndicator({
        enabled: true,
        messageSid,
        accountSid: undefined,
        authToken: undefined,
        requestStartedAtMs: Date.now(),
        fetchImpl,
        logger: testLogger
      })
    ).resolves.toBe("missing_credentials");

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(testLogger.warn).toHaveBeenCalledWith(
      "whatsapp.typing_indicator",
      { outcome: "missing_credentials" }
    );
  });

  it("preserves TwiML replies and provides an immediate photo acknowledgement", async () => {
    const response = whatsappTwiml("Normal reply");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/xml; charset=utf-8"
    );
    await expect(response.text()).resolves.toContain(
      "<Message>Normal reply</Message>"
    );
    expect(WHATSAPP_PHOTO_PROCESSING_ACK).toContain("בבדיקה");
    expect(WHATSAPP_PHOTO_PROCESSING_ACK).toContain("separate message");
  });

  it("starts feedback before DB work and defers slow photo processing", () => {
    const route = readFileSync(
      "app/api/twilio/whatsapp/route.ts",
      "utf8"
    );
    expect(route.indexOf("sendWhatsappTypingIndicator({")).toBeLessThan(
      route.indexOf("linkWhatsappParticipant({")
    );
    expect(route).toContain("after(typingIndicator)");
    expect(route).toContain("deliverWhatsappPhotoAfterResponse");
    expect(route).toContain(
      "return whatsappTwiml(WHATSAPP_PHOTO_PROCESSING_ACK)"
    );
  });
});
