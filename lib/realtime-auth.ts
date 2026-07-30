import "server-only";

import { createClient, type User } from "@supabase/supabase-js";
import { randomToken } from "@/lib/crypto";
import { publicEnv } from "@/lib/env";
import { getParticipantState } from "@/lib/repository";
import { createAdminClient } from "@/lib/supabase/admin";

const AUTHORIZATION_GRACE_MS = 5 * 60 * 1000;
const USERS_PER_PAGE = 1000;

const participantEmail = (participantId: string) =>
  `quest-${participantId}@participants.invalid`;

async function findUserByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string
): Promise<User | null> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: USERS_PER_PAGE
    });
    if (error) throw error;

    const match = data.users.find(
      (user) => user.email?.toLowerCase() === email.toLowerCase()
    );
    if (match) return match;
    if (data.users.length < USERS_PER_PAGE) return null;
  }

  throw new Error("Realtime auth user lookup exceeded the supported page limit");
}

async function ensureParticipantAuthUser({
  participantId,
  teamId,
  runId
}: {
  participantId: string;
  teamId: string;
  runId: string;
}) {
  const admin = createAdminClient();
  const email = participantEmail(participantId);
  const { data: existingAuthorization, error: authorizationError } = await admin
    .from("realtime_participant_authorizations")
    .select("user_id")
    .eq("participant_id", participantId)
    .maybeSingle();
  if (authorizationError) throw authorizationError;

  let user: User | null = null;
  if (existingAuthorization?.user_id) {
    const { data, error } = await admin.auth.admin.getUserById(
      existingAuthorization.user_id
    );
    if (!error) user = data.user;
  }

  if (!user) {
    const password = randomToken();
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: {
        account_type: "quest_participant",
        participant_id: participantId,
        team_id: teamId,
        run_id: runId
      }
    });

    if (created.error) {
      user = await findUserByEmail(admin, email);
      if (!user) throw created.error;
    } else {
      user = created.data.user;
    }
  }

  const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(
    user.id,
    {
      app_metadata: {
        account_type: "quest_participant",
        participant_id: participantId,
        team_id: teamId,
        run_id: runId
      }
    }
  );
  if (updateError) throw updateError;

  return { admin, email, user: updated.user };
}

export async function issueParticipantRealtimeAccess(token: string) {
  const state = await getParticipantState(token);
  const { admin, email, user } = await ensureParticipantAuthUser({
    participantId: state.participant.id,
    teamId: state.team.id,
    runId: state.run.id
  });

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email
  });
  if (linkError) throw linkError;

  const tokenHash = link.properties.hashed_token;
  if (!tokenHash) throw new Error("Supabase did not return a realtime login token");

  const sessionClient = createClient(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      }
    }
  );
  const { data: verified, error: verificationError } =
    await sessionClient.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink"
    });
  if (verificationError) throw verificationError;
  if (!verified.session) throw new Error("Supabase did not create a realtime session");

  const expiresAtMs =
    (verified.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000;
  const { error: upsertError } = await admin
    .from("realtime_participant_authorizations")
    .upsert(
      {
        user_id: user.id,
        participant_id: state.participant.id,
        team_id: state.team.id,
        run_id: state.run.id,
        expires_at: new Date(expiresAtMs + AUTHORIZATION_GRACE_MS).toISOString(),
        updated_at: new Date().toISOString()
      },
      { onConflict: "participant_id" }
    );
  if (upsertError) throw upsertError;

  return {
    accessToken: verified.session.access_token,
    expiresAt: expiresAtMs,
    participantId: state.participant.id,
    supabaseUrl: publicEnv.supabaseUrl,
    supabasePublishableKey: publicEnv.supabasePublishableKey
  };
}
