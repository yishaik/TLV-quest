import twilio from "twilio";
import { linkWhatsappParticipant } from "@/lib/repository";
import { handleWhatsappGameMessage } from "@/lib/whatsapp-game";
import {
  handleWhatsappLocation,
  handleWhatsappPhoto
} from "@/lib/whatsapp-attachments";
import { verifyTwilioWebhook } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

const twiml = (message?: string) => {
  const response = new twilio.twiml.MessagingResponse();
  if (message) response.message(message);
  return new Response(response.toString(), {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" }
  });
};

export async function POST(request: Request) {
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

  const from = params.From ?? "";
  const body = params.Body ?? "";
  const messageSid = params.MessageSid ?? crypto.randomUUID();

  try {
    const linked = await linkWhatsappParticipant({ from, body });
    if (linked) return twiml(linked.message);

    if (Number(params.NumMedia ?? "0") > 0 && params.MediaUrl0) {
      const reply = await handleWhatsappPhoto({
        from,
        mediaUrl: params.MediaUrl0,
        mediaContentType: params.MediaContentType0 ?? "application/octet-stream",
        messageSid
      });
      return twiml(reply);
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
      return twiml(reply);
    }

    const reply = await handleWhatsappGameMessage({ from, body, messageSid });
    return twiml(reply);
  } catch (error) {
    console.error("Twilio webhook failed", error);
    return twiml(
      "אירעה תקלה זמנית. נסו שוב בעוד רגע או השתמשו באתר המשחק.\nA temporary error occurred. Try again or use the web app."
    );
  }
}
