# WhatsApp typing indicators

TLV Quest can send Twilio's WhatsApp typing indicator immediately after a
signed inbound webhook is validated. The integration is a Public Beta and is
disabled by default:

```dotenv
TWILIO_WHATSAPP_TYPING_INDICATORS=true
```

Only `SM` and `MM` SIDs with the documented 32-hex-character shape are sent to
Twilio. The request uses the existing account credentials, has a 1.5-second
deadline, and runs without blocking the participant response. Provider errors,
timeouts, missing credentials, and invalid SIDs cannot fail the webhook.

## Read-receipt side effect

Twilio automatically marks the referenced inbound message as read when the
typing indicator is accepted. Enabling the flag explicitly accepts that
user-visible side effect. Do not enable this Public Beta for HIPAA- or
PCI-regulated workflows.

## Long-running photo processing

WhatsApp removes the indicator when the reply is delivered or after 25 seconds.
Photo download and Gemini validation can exceed that window. The webhook
therefore returns an immediate bilingual acknowledgement and schedules the
photo work with Next.js `after()`. Its final result is delivered as a separate
WhatsApp message. Text, status, location, and linking replies keep their normal
TwiML response path.

## Telemetry

Structured `whatsapp.typing_indicator` events report:

- `outcome`: success, timeout, provider/network failure, invalid SID, or
  missing credentials;
- `durationMs`: Twilio API latency;
- `timeToFirstFeedbackMs`: elapsed time from webhook receipt to the successful
  indicator response.

The events never include message bodies, phone numbers, credentials, or message
SIDs. Background photo delivery emits only a delivery outcome and a sanitized
error code.
