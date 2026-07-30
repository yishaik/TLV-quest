import { createAdminClient } from "@/lib/supabase/admin";
import { generateQuestEpilogue } from "@/lib/providers";
import { getParticipantState } from "@/lib/repository";
import {
  handleRouteError,
  jsonOk,
  requireIdempotencyKey
} from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const state = await getParticipantState(token);
    const { data, error } = await createAdminClient()
      .from("generated_epilogues")
      .select("id,locale,body,provider,model,provenance,created_at")
      .eq("run_id", state.run.id)
      .eq("team_id", state.team.id)
      .eq("locale", state.participant.language)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return jsonOk(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    await enforceRateLimit({
      scope: "participant-epilogue",
      identifier: token,
      limit: 3,
      windowSeconds: 24 * 60 * 60
    });
    const idempotencyKey = requireIdempotencyKey(request);
    const state = await getParticipantState(token);
    if (state.team.status !== "finished" && state.run.status !== "finished") {
      throw new Error("Epilogue is only available after the quest is finished");
    }
    const supabase = createAdminClient();
    const scopedKey = `epilogue:${state.team.id}:${state.participant.language}:${idempotencyKey}`;
    const { data: existing, error: existingError } = await supabase
      .from("generated_epilogues")
      .select("id,locale,body,provider,model,provenance,created_at")
      .eq("idempotency_key", scopedKey)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return jsonOk(existing);

    const generated = await generateQuestEpilogue({
      locale: state.participant.language,
      teamName: state.team.name,
      score: state.team.score,
      completedCount: state.team.completedCount,
      wrongAttempts: state.team.wrongAttempts,
      hintsUsed: state.team.hintsUsed
    });
    const { data, error } = await supabase
      .from("generated_epilogues")
      .insert({
        run_id: state.run.id,
        team_id: state.team.id,
        locale: state.participant.language,
        body: generated.text,
        provider: generated.provider,
        model: generated.model,
        provenance: {
          input: "aggregate_team_statistics",
          score: state.team.score,
          completedCount: state.team.completedCount,
          wrongAttempts: state.team.wrongAttempts,
          hintsUsed: state.team.hintsUsed
        },
        idempotency_key: scopedKey,
        created_by: `participant:${state.participant.id}`
      })
      .select("id,locale,body,provider,model,provenance,created_at")
      .single();
    if (error) throw error;
    return jsonOk(data, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
