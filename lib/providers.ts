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

type GeminiTextResult = {
  text: string;
  provider: "gemini" | "deterministic";
  model: string | null;
};

const geminiText = async ({
  prompt,
  temperature = 0.2
}: {
  prompt: string;
  temperature?: number;
}): Promise<GeminiTextResult | null> => {
  const env = getServerEnv();
  if (!env.geminiApiKey) return null;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.geminiVisionModel)}:generateContent?key=${encodeURIComponent(env.geminiApiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "text/plain",
          temperature,
          maxOutputTokens: 900
        }
      }),
      signal: AbortSignal.timeout(15_000)
    }
  );
  if (!response.ok) {
    throw new Error(`Gemini generation failed with ${response.status}`);
  }
  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error("Gemini returned an empty response");
  return {
    text: text.slice(0, 4000),
    provider: "gemini",
    model: env.geminiVisionModel
  };
};

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
}): Promise<GeminiTextResult> => {
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
  return {
    text: sourceText,
    provider: "deterministic",
    model: null
  };
};

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
}): Promise<GeminiTextResult> => {
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
  provider: "gemini" | "deterministic";
  model: string | null;
} | null> => {
  const generated = await geminiText({
    prompt: [
      "You are a route-planning assistant. Produce a safe editorial draft, never a published route.",
      `Language: ${locale}; audience: ${audience}; duration: ${durationMinutes} minutes.`,
      `Constraints: ${JSON.stringify(constraints).slice(0, 1500)}`,
      "Choose only stationId values from the candidate list. Prefer verified stations, a coherent nearby sequence, and accessibility constraints.",
      "Return compact JSON only: {\"stationIds\":[\"...\"],\"rationale\":\"...\"}.",
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
