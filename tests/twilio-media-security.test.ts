import { describe, expect, it, vi } from "vitest";
import { parseTwilioSignatureValidation } from "../lib/env";
import {
  assertTwilioMediaUrl,
  downloadTwilioMedia,
  readResponseBodyWithLimit,
  TwilioMediaDownloadError
} from "../lib/twilio-media";

describe("Twilio media download hardening", () => {
  it("allows only HTTPS Twilio API hosts, including regional hosts", () => {
    expect(
      assertTwilioMediaUrl(
        "https://api.twilio.com/2010-04-01/Accounts/AC/Messages/SM/Media/ME"
      ).hostname
    ).toBe("api.twilio.com");
    expect(
      assertTwilioMediaUrl(
        "https://api.ie1.twilio.com/2010-04-01/Accounts/AC/Messages/SM/Media/ME"
      ).hostname
    ).toBe("api.ie1.twilio.com");
    expect(
      assertTwilioMediaUrl(
        "https://api.sydney.au1.twilio.com/2010-04-01/Accounts/AC/Messages/SM/Media/ME"
      ).hostname
    ).toBe("api.sydney.au1.twilio.com");
  });

  it.each([
    "http://api.twilio.com/media",
    "https://api.twilio.com.evil.example/media",
    "https://api.twilio.com@evil.example/media",
    "https://169.254.169.254/latest/meta-data",
    "https://api.twilio.com:8443/media",
    "not-a-url"
  ])("rejects an unsafe media URL before fetch: %s", async (mediaUrl) => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      downloadTwilioMedia({
        mediaUrl,
        accountSid: "AC_TEST",
        authToken: "secret-test-token",
        fetchImpl
      })
    ).rejects.toMatchObject({
      code: "invalid_twilio_media_url"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("adds credentials only after URL validation and rejects redirects", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example/media" }
      })
    );

    await expect(
      downloadTwilioMedia({
        mediaUrl: "https://api.twilio.com/media",
        accountSid: "AC_TEST",
        authToken: "secret-test-token",
        fetchImpl
      })
    ).rejects.toMatchObject({
      code: "twilio_media_redirect_rejected"
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.twilio.com/media");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual({
      authorization: `Basic ${Buffer.from(
        "AC_TEST:secret-test-token"
      ).toString("base64")}`
    });
  });

  it("rejects a declared oversized body before reading it", async () => {
    let pulled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled = true;
          controller.enqueue(Uint8Array.from([1]));
          controller.close();
        }
      }),
      { headers: { "content-length": "6" } }
    );

    await expect(readResponseBodyWithLimit(response, 5)).rejects.toMatchObject({
      code: "twilio_media_too_large"
    });
    expect(pulled).toBe(false);
  });

  it("stops streaming as soon as the actual body exceeds the limit", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from([1, 2, 3]));
          controller.enqueue(Uint8Array.from([4, 5, 6]));
          controller.close();
        }
      })
    );

    await expect(readResponseBodyWithLimit(response, 5)).rejects.toMatchObject({
      code: "twilio_media_too_large"
    });
  });

  it("returns a bounded streamed body without using arrayBuffer", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from([1, 2]));
          controller.enqueue(Uint8Array.from([3, 4]));
          controller.close();
        }
      })
    );

    await expect(readResponseBodyWithLimit(response, 4)).resolves.toEqual(
      Uint8Array.from([1, 2, 3, 4])
    );
  });

  it("aborts a stalled download at the configured deadline", async () => {
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

    await expect(
      downloadTwilioMedia({
        mediaUrl: "https://api.twilio.com/media",
        accountSid: "AC_TEST",
        authToken: "secret-test-token",
        timeoutMs: 5,
        fetchImpl
      })
    ).rejects.toMatchObject({
      code: "twilio_media_download_timeout"
    });
  });

  it("fails closed when production signature validation is disabled", () => {
    expect(parseTwilioSignatureValidation(undefined, false)).toBe(true);
    expect(parseTwilioSignatureValidation("unexpected", false)).toBe(true);
    expect(parseTwilioSignatureValidation("false", false)).toBe(false);
    expect(() => parseTwilioSignatureValidation("false", true)).toThrow(
      "cannot be disabled in production"
    );
  });

  it("uses sanitized error objects that do not retain credentials or URLs", () => {
    const error = new TwilioMediaDownloadError(
      "twilio_media_download_failed",
      503
    );
    expect(error.message).toBe("twilio_media_download_failed:503");
    expect(JSON.stringify(error)).not.toContain("secret");
  });
});
