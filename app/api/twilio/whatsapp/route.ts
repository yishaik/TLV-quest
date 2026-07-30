import { after } from "next/server";
import { getServerEnv, publicEnv } from "@/lib/env";
import { participantResumeUrl } from "@/lib/participant-resume";
import { linkWhatsappParticipant } from "@/lib/repository";
import { handleWhatsappGameMessage } from "@/lib/whatsapp-game";
import {
  handleWhatsappLocation,
  handleWhatsappPhoto
} from "@/lib/whatsapp-attachments";
import { sendWhatsapp, verifyTwilioWebhook } from "@/lib/providers";
import { sendWhatsappTypingIndicator } from "@/lib/twilio-typing";
import {
  WHATSAPP_PHOTO_PROCESSING_ACK,
  whatsappTwiml
} from "@/lib/twilio-webhook-response";

export const runtime = "nodejs";
export const maxDuration = 60;

const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";

const isExpectedGameState = (error: unknown) =>
  /location_verification_required|team_not_active|no active checkpoint|checkpoint_locked|ambiguous_whatsapp_context/i.test(
    errorMessage(error)
  );

const whatsappErrorMessage = (error: unknown) => {
  const message = errorMessage(error);
  const ambiguity = message.match(
    /ambiguous_whatsapp_context:([A-Z0-9]+(?:,[A-Z0-9]+)*)/i
  );

  if (ambiguity) {
    const codes = ambiguity[1].split(",").join(", ");
    const example = ambiguity[1].split(",")[0];
    return `נמצאו כמה משחקים חיים למספר הזה: ${codes}. שלחו “סטטוס קוד” כדי לבחור, למשל: סטטוס ${example}.\n\nMultiple live games were found for this number. Send “status CODE” to choose, for example: status ${example}.`;
  }

  if (/location_verification_required/i.test(message)) {
    return `לפני שליחת תשובה, פתחו את אתר המשחק ולחצו על ‘אימות מיקום’. לאחר שהמיקום יאושר, שלחו את התשובה שוב.\n${publicEnv.appUrl}/resume\n\nBefore answering, open the game site and verify your location, then send the answer again.`;
  }

  if (/team_not_active|no active checkpoint|checkpoint_locked/i.test(message)) {
    return `המשחק או התחנה אינם פעילים כרגע. פתחו את אתר המשחק כדי לבדוק את הסטטוס.\n${publicEnv.appUrl}/resume\n\nThe game or checkpoint is not active right now. Check the game site for status.`;
  }

  return `אירעה תקלה זמנית. נסו שוב בעוד רגע או השתמשו באתר המשחק.\n${publicEnv.appUrl}/resume\n\nA temporary error occurred. Try again or use the web app.`;
};

const deliverWhatsappPhotoAfterResponse = async ({
  from,
  mediaUrl,
  mediaContentType,
  messageSid
}: {
  from: string;
  mediaUrl: string;
  mediaContentType: string;
  messageSid: string;
}) => {
  let reply: string;
  try {
    reply = await handleWhatsappPhoto({
      from,
      mediaUrl,
      mediaContentType,
      messageSid
    });
  } catch (error) {
    console.error("whatsapp.photo_processing", {
      outcome: "failed",
      code: errorMessage(error)
    });
    reply = whatsappErrorMessage(error);
  }

  try {
    const result = await sendWhatsapp({ to: from, body: reply });
    console.info("whatsapp.photo_async_response", {
      outcome: result.status
    });
  } catch (error) {
    console.error("whatsapp.photo_async_response", {
      outcome: "failed",
      code: errorMessage(error)
    });
  }
};

export async function POST(request: Request) {
  const requestStartedAtMs = Date.now();
  const formData = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") params[key] = value;
  }

  const valid = verifyTwilioWebhook({
    signature: request.headers.get("x-twilio-signature"),
    url: request.url,
    params
  });
  if (!valid) return new Response("Forbidden", { status: 403 });

  const env = getServerEnv();
  const typingIndicator = sendWhatsappTypingIndicator({
    enabled: env.enableWhatsappTypingIndicators,
    messageSid: params.MessageSid,
    accountSid: env.twilioAccountSid,
    authToken: env.twilioAuthToken,
    requestStartedAtMs
  });
  after(typingIndicator);

  const from = params.From ?? "";
  const body = params.Body ?? "";
  const messageSid = params.MessageSid ?? crypto.randomUUID();

  try {
    const linked = await linkWhatsappParticipant({ from, body });
    if (linked) {
      const webAppUrl = participantResumeUrl(linked.participantId);
      return whatsappTwiml(
        `${linked.message}\n\nלממשק המשחק, המפה והניקוד:\n${webAppUrl}\n\nOpen the web game, map and score:\n${webAppUrl}`
      );
    }

    if (Number(params.NumMedia ?? "0") > 0 && params.MediaUrl0) {
      after(() =>
        deliverWhatsappPhotoAfterResponse({
          from,
          mediaUrl: params.MediaUrl0,
          mediaContentType:
            params.MediaContentType0 ?? "application/octet-stream",
          messageSid
        })
      );
      return whatsappTwiml(WHATSAPP_PHOTO_PROCESSING_ACK);
    }

    if (params.Latitude && params.Longitude) {
      const latitude = Number(params.Latitude);
      const longitude = Number(params.Longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error("invalid_whatsapp_location");
      }
      const reply = await handleWhatsappLocation({
        from,
        latitude,
        longitude,
        messageSid
      });
      return whatsappTwiml(reply);
    }

    const reply = await handleWhatsappGameMessage({ from, body, messageSid });
    return whatsappTwiml(reply);
  } catch (error) {
    if (isExpectedGameState(error)) {
      console.info("WhatsApp guided game state", { code: errorMessage(error), messageSid });
    } else {
      console.error("Twilio webhook failed", error);
    }
    return whatsappTwiml(whatsappErrorMessage(error));
  }
}
