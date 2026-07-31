import "server-only";

import twilio from "twilio";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptPii, normalizePhone } from "@/lib/crypto";
import { getServerEnv, isProduction, publicEnv } from "@/lib/env";
import { verifyTwilioRequestSignature } from "@/lib/twilio-signature";
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
  return verifyTwilioRequestSignature({
    authToken: env.twilioAuthToken,
    signature,
    url,
    params
  });
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
  if (!env.emailFrom) throw new Error("EMAIL_FROM is not configured");

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

export type GeminiTextResult = {
  text: string;
  provider: "gemini";
  model: string | null;
};

export type TranslationSuggestion = {
  text: string;
  provider: "gemini" | "deterministic";
  model: string | null;
};

/**
 * One text-generation call against Gemini, shared by every draft-content
 * feature (translation, epilogue, route ordering).
 *
 * Returns null instead of throwing on ANY failure — unset key, HTTP error,
 * timeout, empty candidate. Every caller is producing an optional draft with a
 * deterministic fallback, so "no model available" must degrade the feature,
 * never break the screen that asked for it.
 */
const geminiText = async ({
  prompt,
  temperature
}: {
  prompt: string;
  temperature: number;
}): Promise<GeminiTextResult | null> => {
  const env = getServerEnv();
  if (!env.geminiApiKey) return null;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.geminiVisionModel)}:generateContent?key=${encodeURIComponent(env.geminiApiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: 900 }
        }),
        signal: AbortSignal.timeout(15_000)
      }
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return null;
    return {
      text: text.slice(0, 4000),
      provider: "gemini",
      model: env.geminiVisionModel
    };
  } catch {
    return null;
  }
};

/**
 * Draft a he<->en translation of player-facing copy.
 *
 * Never fails the caller: any upstream problem falls back to echoing the
 * source text with `provider: "deterministic"`. Translations are drafts
 * pending human approval (CNT-07), so a silent echo is a visible no-op in the
 * review UI, whereas a thrown error would take the authoring screen down.
 */
export const suggestTranslation = async ({
  sourceText,
  sourceLocale,
  targetLocale,
  context
}: {
  sourceText: string;
  sourceLocale: "he" | "en";
  targetLocale: "he" | "en";
  context?: string;
}): Promise<TranslationSuggestion> => {
  const generated = await geminiText({
    prompt: [
      "Translate urban quest player copy.",
      `Source language: ${sourceLocale}. Target language: ${targetLocale}.`,
      "Preserve tone, clues, line breaks, place names and numbers.",
      "Do not add answers, explanations or facts not present in the source.",
      "Return only the translated copy.",
      context ? `Context: ${context.slice(0, 500)}` : "",
      `Source:\n${sourceText.slice(0, 4000)}`
    ]
      .filter(Boolean)
      .join("\n\n"),
    temperature: 0.1
  });
  if (generated) return generated;
  return { text: sourceText, provider: "deterministic", model: null };
};

/**
 * Cinematic team epilogue from aggregate stats only (PLY-08).
 *
 * The prompt is fed nothing personal — team name, score and counters — and
 * explicitly forbids inventing details, so the model cannot leak locations or
 * answers it was never given. The deterministic fallback keeps the finale
 * celebratory when Gemini is unavailable.
 */
export const generateQuestEpilogue = async ({
  locale,
  teamName,
  score,
  completedCount,
  wrongAttempts,
  hintsUsed
}: {
  locale: "he" | "en";
  teamName: string;
  score: number;
  completedCount: number;
  wrongAttempts: number;
  hintsUsed: number;
}): Promise<TranslationSuggestion> => {
  const generated = await geminiText({
    prompt: [
      `Write a cinematic 120–180 word urban quest epilogue in ${locale === "he" ? "Hebrew" : "English"}.`,
      "Address the team, celebrate collaboration, and use only the supplied aggregate statistics.",
      "Do not invent real-world events, names, answers, private details, or completed locations.",
      `Team: ${teamName.slice(0, 100)}`,
      `Score: ${score}; checkpoints: ${completedCount}; wrong attempts: ${wrongAttempts}; hints: ${hintsUsed}.`,
      "Return only the epilogue."
    ].join("\n"),
    temperature: 0.6
  });
  if (generated) return generated;
  return {
    text:
      locale === "he"
        ? `${teamName}, האות האחרון דעך — אבל המסע שלכם נשאר חי. יחד השלמתם ${completedCount} תחנות וצברתם ${score} נקודות. גם ${wrongAttempts} ניסיונות שלא צלחו ו־${hintsUsed} רמזים הפכו לחלק מהסיפור: עקבות של סקרנות, התמדה ועבודת צוות. העיר חוזרת לשגרה, ואתם יוצאים ממנה עם מפה שאי אפשר לקפל — הזיכרון של הדרך שעברתם יחד.`
        : `${teamName}, the final signal has faded, but your quest remains alive. Together you completed ${completedCount} checkpoints and earned ${score} points. Even ${wrongAttempts} wrong turns and ${hintsUsed} hints became part of the story: traces of curiosity, persistence, and teamwork. The city returns to its rhythm, and you leave with a map that cannot be folded—the memory of the route you shared.`,
    provider: "deterministic",
    model: null
  };
};

/**
 * Draft-only route ordering suggestion for the admin composer (RTE/P6).
 *
 * Returns null when the model is unavailable or returns malformed JSON — the
 * route generator then falls back to its deterministic nearest-neighbour
 * ordering in lib/route-planning.ts. The caller re-validates every stationId
 * against the candidate list, so a hallucinated id cannot reach a route.
 */
export const generateRouteOrdering = async ({
  locale,
  audience,
  durationMinutes,
  constraints,
  candidates
}: {
  locale: "he" | "en";
  audience: string;
  durationMinutes: number;
  constraints: Record<string, unknown>;
  candidates: Array<{
    stationId: string;
    title: string;
    tags: string[];
    healthStatus: string;
    latitude: number;
    longitude: number;
  }>;
}): Promise<{
  stationIds: string[];
  rationale: string;
  provider: "gemini";
  model: string | null;
} | null> => {
  const generated = await geminiText({
    prompt: [
      "You are a route-planning assistant. Produce a safe editorial draft, never a published route.",
      `Language: ${locale}; audience: ${audience}; duration: ${durationMinutes} minutes.`,
      `Constraints: ${JSON.stringify(constraints).slice(0, 1500)}`,
      "Choose only stationId values from the candidate list. Prefer verified stations, a coherent nearby sequence, and accessibility constraints.",
      'Return compact JSON only: {"stationIds":["..."],"rationale":"..."}.',
      `Candidates: ${JSON.stringify(candidates).slice(0, 9000)}`
    ].join("\n\n"),
    temperature: 0.2
  });
  if (!generated) return null;
  try {
    const cleaned = generated.text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    const parsed = JSON.parse(cleaned) as {
      stationIds?: unknown;
      rationale?: unknown;
    };
    return {
      stationIds: Array.isArray(parsed.stationIds)
        ? parsed.stationIds.filter(
            (value): value is string => typeof value === "string"
          )
        : [],
      rationale:
        typeof parsed.rationale === "string"
          ? parsed.rationale.slice(0, 1200)
          : "",
      provider: generated.provider,
      model: generated.model
    };
  } catch {
    return null;
  }
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
