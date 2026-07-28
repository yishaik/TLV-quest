import { requireAdmin } from "@/lib/admin-auth";
import { hashSecret, randomToken } from "@/lib/crypto";
import { publicEnv } from "@/lib/env";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const body = await readJson<{ runId?: unknown }>(request);
    const runId = typeof body.runId === "string" ? body.runId.trim() : "";
    if (!runId) throw new Error("runId is required");

    const { data: run, error: runError } = await supabase
      .from("game_runs")
      .select("id,public_code,status")
      .eq("id", runId)
      .single();

    if (runError || !run) throw new Error("Game run was not found");
    if (["finished", "cancelled"].includes(run.status)) {
      throw new Error("A management link cannot be created for a closed game");
    }

    const organizerToken = randomToken(32);
    const { error: updateError } = await supabase
      .from("game_runs")
      .update({ organizer_token_hash: hashSecret(organizerToken) })
      .eq("id", run.id);

    if (updateError) throw updateError;

    return jsonOk({
      runId: run.id,
      publicCode: run.public_code,
      manageUrl: `${publicEnv.appUrl}/organize/${organizerToken}`
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
