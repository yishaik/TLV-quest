import "server-only";

import twilio, { validateRequest } from "twilio";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptPii, normalizePhone } from "@/lib/crypto";
import { getServerEnv, isProduction } from "@/lib/env";

export type SendResult = {
  providerMessageId: string;
  status: "sent" | "mocked";
};

const externalDeliveryAllowed = (recipient: string): boolean => {
  const env = getServerEnv();
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
  body
}: {
  to: string;
  body: string;
}): Promise<SendResult> => {
  const normalized = normalizePhone(to);
  const env = getServerEnv();

  if (!externalDeliveryAllowed(normalized)) {
    console.info("[mock-whatsapp]", { to: normalized, body });
    return { providerMessageId: `mock-wa-${Date.now()}`, status: "mocked" };
  }

  if (!env.twilioAccountSid || !env.twilioAuthToken) {
    throw new Error("Twilio credentials are not configured");
  }

  const client = twilio(env.twilioAccountSid, env.twilioAuthToken);
  const message = await client.messages.create({
    from: env.twilioWhatsappFrom,
    to: `whatsapp:${normalized}`,
    body
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
    console.info("[mock-email]", { to, subject });
    return { providerMessageId: `mock-email-${Date.now()}`, status: "mocked" };
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

export const processOutbox = async (limit = 20) => {
  const supabase = createAdminClient();
  const { data: rows, error } = await supabase.rpc("claim_outbox_batch", {
    batch_size: Math.max(1, Math.min(limit, 100))
  });
  if (error) throw error;

  const results: Array<{ id: string; status: string; error?: string }> = [];
  for (const row of rows ?? []) {
    try {
      const recipient = decryptPii(row.recipient_ciphertext);
      const payload =
        row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
          ? (row.payload as Record<string, unknown>)
          : {};

      const delivery =
        row.channel === "whatsapp"
          ? await sendWhatsapp({
              to: recipient,
              body: typeof payload.body === "string" ? payload.body : ""
            })
          : await sendEmail({
              to: recipient,
              subject:
                typeof payload.subject === "string" ? payload.subject : "TLV Quest",
              html: typeof payload.html === "string" ? payload.html : ""
            });

      await supabase
        .from("message_outbox")
        .update({
          status: "sent",
          provider_message_id: delivery.providerMessageId,
          sent_at: new Date().toISOString(),
          locked_at: null,
          last_error: null
        })
        .eq("id", row.id);
      results.push({ id: row.id, status: delivery.status });
    } catch (errorValue) {
      const message =
        errorValue instanceof Error ? errorValue.message : "Unknown delivery error";
      const delayMinutes = Math.min(60, 2 ** Math.max(0, row.attempts));
      await supabase
        .from("message_outbox")
        .update({
          status: row.attempts >= 5 ? "failed" : "pending",
          last_error: message.slice(0, 500),
          locked_at: null,
          send_after: new Date(Date.now() + delayMinutes * 60_000).toISOString()
        })
        .eq("id", row.id);
      results.push({ id: row.id, status: "failed", error: message });
    }
  }

  return results;
};
