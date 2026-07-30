import { hashSecret, randomToken } from "@/lib/crypto";
import { publicEnv } from "@/lib/env";
import {
  AppError,
  handleRouteError,
  jsonOk,
  readJson,
  requireIdempotencyKey
} from "@/lib/http";
import { enforceRateLimit, requestIp } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJson<Record<string, unknown>>(request);
    const runCode =
      typeof body.runCode === "string"
        ? body.runCode.trim().toUpperCase().slice(0, 12)
        : "";
    const recoveryCode =
      typeof body.recoveryCode === "string"
        ? body.recoveryCode.trim().toUpperCase().slice(0, 12)
        : "";
    if (
      !/^[A-Z0-9]{4,12}$/.test(runCode) ||
      !/^[A-Z0-9]{4,12}$/.test(recoveryCode)
    ) {
      throw new AppError({
        message:
          "קוד ההרצה או השחזור אינו תקין. / Check the run and recovery codes.",
        code: "invalid_recovery_code"
      });
    }
    const idempotencyKey = requireIdempotencyKey(request, "recovery");
    const ip = requestIp(request);
    await Promise.all([
      enforceRateLimit({
        scope: "participant-recovery-ip",
        identifier: ip,
        limit: 5,
        windowSeconds: 15 * 60
      }),
      enforceRateLimit({
        scope: "participant-recovery-run",
        identifier: runCode,
        limit: 30,
        windowSeconds: 15 * 60
      })
    ]);

    const supabase = createAdminClient();
    const { data: run, error: runError } = await supabase
      .from("game_runs")
      .select("id,status")
      .eq("public_code", runCode)
      .single();
    if (runError || !run || ["finished", "cancelled"].includes(run.status)) {
      throw new Error("Recovery code is invalid or expired");
    }
    const { data: participant, error: participantError } = await supabase
      .from("participants")
      .select("id,team_id")
      .eq("run_id", run.id)
      .eq("recovery_code_hash", hashSecret(recoveryCode))
      .single();
    if (participantError || !participant) {
      throw new Error("Recovery code is invalid or expired");
    }

    const personalToken = randomToken();
    const { error: updateError } = await supabase
      .from("participants")
      .update({
        personal_token_hash: hashSecret(personalToken),
        last_seen_at: new Date().toISOString()
      })
      .eq("id", participant.id);
    if (updateError) throw updateError;

    const { error: eventError } = await supabase.from("game_events").upsert(
      {
        run_id: run.id,
        team_id: participant.team_id,
        participant_id: participant.id,
        event_type: "PLAYER_RECOVERED",
        idempotency_key: idempotencyKey,
        payload: { channel: "short_code" }
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true }
    );
    if (eventError) throw eventError;

    return jsonOk(
      {
        participantToken: personalToken,
        playUrl: `${publicEnv.appUrl}/play/${personalToken}`
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
