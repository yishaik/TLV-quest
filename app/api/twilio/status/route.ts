import { createAdminClient } from "@/lib/supabase/admin";
import { reportOperationalError } from "@/lib/observability";
import { verifyTwilioWebhook } from "@/lib/providers";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const formData = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") params[key] = value;
  }

  if (
    !verifyTwilioWebhook({
      signature: request.headers.get("x-twilio-signature"),
      url: request.url,
      params
    })
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  const outboxId = new URL(request.url).searchParams.get("outbox") ?? "";
  const messageSid = params.MessageSid ?? "";
  const providerStatus = (params.MessageStatus ?? "").toLowerCase();
  const providerErrorCode = (params.ErrorCode ?? "").slice(0, 80) || null;
  if (!UUID_PATTERN.test(outboxId) || !messageSid || !providerStatus) {
    return new Response("Invalid callback", { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("apply_outbox_provider_status", {
    p_outbox_id: outboxId,
    p_provider_message_id: messageSid,
    p_provider_status: providerStatus,
    p_error_code: providerErrorCode
  });
  if (error) {
    reportOperationalError(error, {
      errorCode: "provider_status_persistence_failed",
      operationalScope: "live_run",
      route: "twilio.status"
    });
    console.error("outbox.provider_status_failed", {
      outboxId,
      providerMessageId: messageSid,
      providerStatus,
      errorCode: "provider_status_persistence_failed"
    });
    return new Response("Temporary failure", { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : null;
  console.info("outbox.provider_status_updated", {
    runId:
      result && typeof result.run_id === "string" ? result.run_id : undefined,
    outboxId,
    attempt:
      result && typeof result.attempts === "number" ? result.attempts : undefined,
    providerMessageId: messageSid,
    providerStatus,
    status:
      result && typeof result.outbox_status === "string"
        ? result.outbox_status
        : "ignored"
  });

  return new Response(null, { status: 204 });
}
