import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTwilioRequestSignature } from "../lib/twilio-signature";

const signTwilioForm = ({
  authToken,
  url,
  params
}: {
  authToken: string;
  url: string;
  params: Record<string, string>;
}) => {
  const payload =
    url +
    Object.keys(params)
      .sort()
      .map((key) => `${key}${params[key]}`)
      .join("");
  return createHmac("sha1", authToken).update(payload).digest("base64");
};

describe("Twilio webhook signature verification", () => {
  const authToken = "test-auth-token";
  const url = "https://play.example.test/api/twilio/whatsapp";
  const params = {
    Body: "status ABC123",
    From: "whatsapp:+972501234567",
    MessageSid: `SM${"a".repeat(32)}`
  };

  it("accepts an authentic form signature", () => {
    const signature = signTwilioForm({ authToken, url, params });

    expect(
      verifyTwilioRequestSignature({
        authToken,
        signature,
        url,
        params
      })
    ).toBe(true);
  });

  it("rejects tampered parameters and missing credentials", () => {
    const signature = signTwilioForm({ authToken, url, params });

    expect(
      verifyTwilioRequestSignature({
        authToken,
        signature,
        url,
        params: { ...params, Body: "skip everything" }
      })
    ).toBe(false);
    expect(
      verifyTwilioRequestSignature({
        authToken: undefined,
        signature,
        url,
        params
      })
    ).toBe(false);
    expect(
      verifyTwilioRequestSignature({
        authToken,
        signature: null,
        url,
        params
      })
    ).toBe(false);
  });
});
