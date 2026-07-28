import twilio from "twilio";
import { linkWhatsappParticipant } from "@/lib/repository";
import { handleWhatsappGameMessage } from "@/lib/whatsapp-game";
import { verifyTwilioWebhook } from "@/lib/providers";

export const runtime = "nodejs";

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

    if (Number(params.NumMedia ?? "0") > 0) {
      return twiml(
        "התמונה התקבלה. אימות תמונות מ־WhatsApp יופעל לאחר הגדרת מפתחות Twilio ו־Gemini. בינתיים ניתן להעלות דרך האתר.\nPhoto received. Web upload is available for the pilot."
      );
    }

    if (params.Latitude && params.Longitude) {
      return twiml(
        "המיקום התקבל. פתחו את מסך המשחק כדי להשלים את אימות התחנה.\nLocation received. Open the game screen to complete checkpoint verification."
      );
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
