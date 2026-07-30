import twilio from "twilio";

export const WHATSAPP_PHOTO_PROCESSING_ACK = `קיבלנו את התמונה והיא בבדיקה. התוצאה תישלח בהודעה נפרדת.

We received the photo and are checking it. The result will arrive in a separate message.`;

export const whatsappTwiml = (message?: string): Response => {
  const response = new twilio.twiml.MessagingResponse();
  if (message) response.message(message);
  return new Response(response.toString(), {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" }
  });
};
