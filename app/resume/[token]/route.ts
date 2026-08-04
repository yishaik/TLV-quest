import { NextResponse } from "next/server";
import { hashSecret } from "@/lib/crypto";
import {
  stableParticipantPlayToken,
  verifyParticipantResumeToken
} from "@/lib/participant-resume";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const { participantId } = verifyParticipantResumeToken(token);
    const supabase = createAdminClient();
    const { data: participant, error } = await supabase
      .from("participants")
      .select("id")
      .eq("id", participantId)
      .single();
    if (error || !participant) throw new Error("Participant was not found");

    const personalToken = stableParticipantPlayToken(participant.id);
    const { error: updateError } = await supabase
      .from("participants")
      .update({
        personal_token_hash: hashSecret(personalToken),
        last_seen_at: new Date().toISOString()
      })
      .eq("id", participant.id);
    if (updateError) throw updateError;

    return NextResponse.redirect(
      new URL(`/play/${encodeURIComponent(personalToken)}`, request.url)
    );
  } catch {
    return NextResponse.redirect(new URL("/resume?error=invalid", request.url));
  }
}
