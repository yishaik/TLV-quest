import "server-only";

import twilio, { validateRequest } from "twilio";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptPii, normalizePhone } from "@/lib/crypto";
import { getServerEnv, isProduction, publicEnv } from "@/lib/env";
import {
  runOutboxBatch,
  type OutboxMessage,
  type OutboxStore
} from "@/lib/outbox-core";

export type SendResult = {
  providerMessageId: string;
  status: "sent" | "mocked";
};

const externalDeliveryAllowed = (recipient: string): boolean => {
  const env = getServerEnv();
  const isTwilioSandbox = env.twilioWhatsappFrom === "whatsapp:+14155238886";

  // Twilio's WhatsApp Sandbox only accepts recipients who explicitly joined it,
  // so real delivery is safe during an otherwise mocked test run.
  if (isTwilioSandbox) return true;
  if (!env.enableExternalMessages) return false;
  if (isProduction) return true;
  return env.testPhoneAllowlist.has(recipient);
};

export const verifyTwilioWebhook = ({
  signature,
  url,
  params
}: {
  signature: string | null;
  url: string;
  params: Record<string, string>;
}): boolean => {
  const env = getServerEnv();
  if (!env.validateTwilioSignatures) return true;
  if (!env.twilioAuthToken || !signature) return false;
  return validateRequest(env.twilioAuthToken, signature, url, params);
};

export const sendWhatsapp = async ({
  to,
  body,
  statusCallback
}: {
  to: string;
  body: string;
  statusCallback?: string;
}): Promise<SendResult> => {
  const normalized = normalizePhone(to);
  const env = getServerEnv();

  if (!externalDeliveryAllowed(normalized)) {
    console.info("provider.whatsapp_mocked", { channel: "whatsapp" });
    return { providerMessageId: `mock-wa-${crypto.randomUUID()}`, status: "mocked" };
  }

  if (!env.twilioAccountSid || !env.twilioAuthToken) {
    throw new Error("Twilio credentials are not configured");
  }

  const client = twilio(env.twilioAccountSid, env.twilioAuthToken);
  const message = await client.messages.create({
    from: env.twilioWhatsappFrom,
    to: `whatsapp:${normalized}`,
    body,
    ...(statusCallback ? { statusCallback } : {})
  });

  return { providerMessageId: message.sid, status: "sent" };
};

export const sendEmail = async ({
  to,
  subject,
  html
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendResult> => {
  const env = getServerEnv();
  if (!env.enableExternalMessages) {
    console.info("provider.email_mocked", { channel: "email" });
    return {
      providerMessageId: `mock-email-${crypto.randomUUID()}`,
      status: "mocked"
    };
  }
  if (!env.resendApiKey) throw new Error("RESEND_API_KEY is not configured");

  const resend = new Resend(env.resendApiKey);
  const { data, error } = await resend.emails.send({
    from: env.emailFrom,
    to,
    subject,
    html
  });
  if (error || !data) throw new Error(error?.message ?? "Email delivery failed");
  return { providerMessageId: data.id, status: "sent" };
};

export const validatePhotoWithGemini = async ({
  base64,
  mimeType,
  criteria
}: {
  base64: string;
  mimeType: string;
  criteria: string;
}): Promise<{ approved: boolean; confidence: number; reason: string }> => {
  const env = getServerEnv();
  if (!env.geminiApiKey) {
    return {
      approved: false,
      confidence: 0,
      reason: "Gemini is not configured; use the deterministic fallback."
    };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.geminiVisionModel)}:generateContent?key=${encodeURIComponent(env.geminiApiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  "Evaluate whether the image satisfies the task. Return only compact JSON with approved:boolean, confidence:number from 0 to 1, and reason:string. Task: " +
                  criteria
              },
              { inlineData: { mimeType, data: base64 } }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini validation failed with ${response.status}`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned an empty response");

  const parsed = JSON.parse(text) as {
    approved?: unknown;
    confidence?: unknown;
    reason?: unknown;
  };

  return {
    approved: parsed.approved === true,
    confidence:
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0,
    reason: typeof parsed.reason === "string" ? parsed.reason : "No reason supplied"
  };
};

const objectPayload = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const createOutboxStore = (
  supabase: ReturnType<typeof createAdminClient>
): OutboxStore => ({
  claimBatch: async ({ limit, outboxIds }) => {
    const { data, error } = await supabase.rpc("claim_outbox_batch", {
      batch_size: limit,
      outbox_ids: outboxIds?.length ? outboxIds : null
    });
    if (error) throw error;

    return (data ?? []).map(
      (row: Record<string, unknown>): OutboxMessage => ({
        id: String(row.id),
        runId: typeof row.run_id === "string" ? row.run_id : null,
        participantId:
          typeof row.participant_id === "string" ? row.participant_id : null,
        channel: row.channel === "email" ? "email" : "whatsapp",
        recipientCiphertext: String(row.recipient_ciphertext),
        payload: objectPayload(row.payload),
        attempts:
          typeof row.attempts === "number" && Number.isFinite(row.attempts)
            ? row.attempts
            : 1,
        leaseToken: String(row.lease_token)
      })
    );
  },
  completeAttempt: async ({
    id,
    leaseToken,
    providerMessageId,
    providerStatus
  }) => {
    const { data, error } = await supabase.rpc("complete_outbox_attempt", {
      p_outbox_id: id,
      p_lease_token: leaseToken,
      p_provider_message_id: providerMessageId,
      p_provider_status: providerStatus
    });
    if (error) throw error;
    return data === true;
  },
  failAttempt: async ({
    id,
    leaseToken,
    errorCode,
    retryAt,
    terminal
  }) => {
    const { data, error } = await supabase.rpc("fail_outbox_attempt", {
      p_outbox_id: id,
      p_lease_token: leaseToken,
      p_error_code: errorCode,
      p_retry_at: retryAt.toISOString(),
      p_terminal: terminal
    });
    if (error) throw error;
    return data === true;
  }
});

export const processOutbox = async (
  limit = 20,
  options: { outboxIds?: string[] } = {}
) => {
  const supabase = createAdminClient();
  return runOutboxBatch({
    store: createOutboxStore(supabase),
    limit,
    outboxIds: options.outboxIds,
    deliver: async (row) => {
      const recipient = decryptPii(row.recipientCiphertext);
      const delivery =
        row.channel === "whatsapp"
          ? await sendWhatsapp({
              to: recipient,
              body: typeof row.payload.body === "string" ? row.payload.body : "",
              statusCallback: `${publicEnv.appUrl}/api/twilio/status?outbox=${encodeURIComponent(row.id)}`
            })
          : await sendEmail({
              to: recipient,
              subject:
                typeof row.payload.subject === "string"
                  ? row.payload.subject
                  : "TLV Quest",
              html: typeof row.payload.html === "string" ? row.payload.html : ""
            });

      return {
        providerMessageId: delivery.providerMessageId,
        providerStatus: delivery.status
      };
    }
  });
};
