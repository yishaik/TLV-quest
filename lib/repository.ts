import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  decryptPii,
  encryptPii,
  hashSecret,
  normalizePhone,
  randomCode,
  randomToken
} from "@/lib/crypto";
import {
  calculateScoreDelta,
  evaluateTextAnswer,
  localized,
  type Locale,
  type LocalizedText,
  type ScoringConfig,
  type TextValidation
} from "@/lib/game-engine";
import {
  findParticipantIdempotencyEvent,
  isIdempotencyReplay,
  throwIdempotencyConflict
} from "@/lib/idempotency";
import { publicEnv } from "@/lib/env";
import { stableParticipantPlayToken } from "@/lib/participant-resume";
import {
  resolveWhatsappContextCandidates,
  type WhatsappContextResolution,
  type WhatsappGameContext
} from "@/lib/whatsapp-status";
import {
  deriveCheckpointHealth,
  deriveTeamTelemetry,
  stuckThresholdFromSettings,
  type CheckpointFieldHealth
} from "@/lib/live-ops";

const TEMPLATE_SLUG = "tel-aviv-port-time-capsule";
const DEFAULT_TEAM_SIZE = 4;

const TEAM_NAMES = [
  "צוללי הזמן",
  "שומרי הרציף",
  "סוכני המגדלור",
  "ציידי הקפסולה",
  "מגלי הנמל",
  "קוד הגלים",
  "The Time Divers",
  "The Dock Keepers",
  "The Lighthouse Agents",
  "The Capsule Hunters"
];

type UnknownRecord = Record<string, unknown>;

const objectValue = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};

const arrayValue = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const textValue = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const numberValue = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const makeWaLink = (message: string): string =>
  `https://wa.me/${publicEnv.twilioSandboxNumber.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;

export type CreateRunInput = {
  scheduledAt?: string | null;
  routeMode?: "linear" | "circular" | "free";
  startMode?: "scheduled" | "manual" | "rolling";
  scoringMode?: "completion" | "combined" | "time";
  teamMode?: "solo" | "preassigned" | "automatic";
  localeDefault?: Locale;
  maxParticipants?: number;
  maxTeams?: number;
  graceMinutes?: number;
  desiredTeamSize?: number;
  organizerEmail?: string;
  organizerPhone?: string;
  settings?: UnknownRecord;
};

export type JoinRunInput = {
  runCode: string;
  firstName: string;
  publicAlias?: string;
  phone?: string;
  language: Locale;
  requestedTeamName?: string;
  consent: boolean;
};

export type ParticipantState = {
  participant: {
    id: string;
    firstName: string;
    publicAlias: string | null;
    language: Locale;
    whatsappConnected: boolean;
  };
  run: {
    id: string;
    publicCode: string;
    status: string;
    routeMode: string;
    scoringMode: string;
    scheduledAt: string | null;
  };
  team: {
    id: string;
    name: string;
    status: string;
    score: number;
    completedCount: number;
    wrongAttempts: number;
    hintsUsed: number;
    currentCheckpointSlug: string | null;
    startedAt: string | null;
    lastProgressAt: string | null;
  };
  members: Array<{ id: string; firstName: string }>;
  checkpoint: null | {
    id: string;
    slug: string;
    sequenceNo: number;
    kind: string;
    content: UnknownRecord;
    validation: UnknownRecord;
    hints: unknown[];
    scoring: UnknownRecord;
    fallback: UnknownRecord | null;
    latitude: number | null;
    longitude: number | null;
    radiusMeters: number | null;
  };
};

const queueTeamMessage = async ({
  runId,
  teamId,
  locale,
  body
}: {
  runId: string;
  teamId: string;
  locale: Locale;
  body: string;
}) => {
  const supabase = createAdminClient();
  const { data: participants, error } = await supabase
    .from("participants")
    .select("id,phone_ciphertext")
    .eq("team_id", teamId)
    .not("phone_ciphertext", "is", null);

  if (error) throw error;
  if (!participants?.length) return;

  const rows = participants.map((participant) => ({
    run_id: runId,
    participant_id: participant.id,
    channel: "whatsapp",
    recipient_ciphertext: participant.phone_ciphertext,
    payload: { body, locale }
  }));

  const { error: insertError } = await supabase.from("message_outbox").insert(rows);
  if (insertError) throw insertError;
};

export const createRun = async (input: CreateRunInput) => {
  const supabase = createAdminClient();
  const { data: template, error: templateError } = await supabase
    .from("game_templates")
    .select("id,active_version")
    .eq("slug", TEMPLATE_SLUG)
    .eq("is_active", true)
    .single();

  if (templateError || !template) {
    throw new Error("Active game template was not found");
  }

  const { data: checkpoints, error: checkpointError } = await supabase
    .from("template_checkpoints")
    .select("*")
    .eq("template_id", template.id)
    .eq("version", template.active_version)
    .eq("is_active", true)
    .order("sequence_no");

  if (checkpointError) throw checkpointError;
  if (!checkpoints?.length) throw new Error("Template has no active checkpoints");

  const organizerToken = randomToken();
  const publicCode = randomCode(6);
  const organizerContact =
    input.organizerEmail || input.organizerPhone
      ? encryptPii(
          JSON.stringify({
            email: input.organizerEmail?.trim().toLowerCase() || null,
            phone: input.organizerPhone
              ? normalizePhone(input.organizerPhone)
              : null
          })
        )
      : null;

  const desiredTeamSize = Math.max(
    1,
    Math.min(8, input.desiredTeamSize ?? DEFAULT_TEAM_SIZE)
  );

  const { data: run, error: runError } = await supabase
    .from("game_runs")
    .insert({
      template_id: template.id,
      template_version: template.active_version,
      public_code: publicCode,
      organizer_token_hash: hashSecret(organizerToken),
      status: "registration_open",
      route_mode: input.routeMode ?? "circular",
      start_mode: input.startMode ?? "scheduled",
      scoring_mode: input.scoringMode ?? "combined",
      team_mode: input.teamMode ?? "automatic",
      locale_default: input.localeDefault ?? "he",
      scheduled_at: input.scheduledAt ?? null,
      max_participants: Math.max(1, Math.min(30, input.maxParticipants ?? 30)),
      max_teams: Math.max(1, Math.min(10, input.maxTeams ?? 10)),
      grace_minutes: Math.max(0, Math.min(120, input.graceMinutes ?? 10)),
      organizer_contact_ciphertext: organizerContact,
      settings: {
        desiredTeamSize,
        boardVisibility: "ranking_status",
        galleryVisibility: "shared",
        routeLength: "short",
        accessibilityMode: "regular",
        ...(input.settings ?? {})
      }
    })
    .select("id,public_code,status")
    .single();

  if (runError || !run) throw runError ?? new Error("Failed to create run");

  const snapshotRows = checkpoints.map((checkpoint) => {
    const config = objectValue(checkpoint.config);
    return {
      run_id: run.id,
      source_checkpoint_id: checkpoint.id,
      slug: checkpoint.slug,
      sequence_no: checkpoint.sequence_no,
      kind: checkpoint.kind,
      latitude: checkpoint.latitude,
      longitude: checkpoint.longitude,
      radius_meters: checkpoint.radius_meters,
      content: objectValue(config.content),
      validation: objectValue(config.validation),
      hints: arrayValue(config.hints),
      accessibility: checkpoint.accessibility,
      scoring: objectValue(config.scoring),
      prerequisites: Array.isArray(config.prerequisites)
        ? config.prerequisites.filter((item): item is string => typeof item === "string")
        : [],
      fallback_checkpoint: config.fallback
        ? objectValue(config.fallback)
        : null,
      is_optional: checkpoint.is_optional,
      is_disabled: false
    };
  });

  const { error: snapshotError } = await supabase
    .from("run_checkpoints")
    .insert(snapshotRows);

  if (snapshotError) {
    await supabase.from("game_runs").delete().eq("id", run.id);
    throw snapshotError;
  }

  await supabase.from("game_events").insert({
    run_id: run.id,
    event_type: "RUN_CREATED",
    idempotency_key: `run-created:${run.id}`,
    payload: { templateSlug: TEMPLATE_SLUG, version: template.active_version }
  });

  return {
    runId: run.id,
    publicCode,
    organizerToken,
    joinUrl: `${publicEnv.appUrl}/join/${publicCode}`,
    manageUrl: `${publicEnv.appUrl}/organize/${organizerToken}`,
    liveUrl: `${publicEnv.appUrl}/live/${publicCode}`
  };
};

const chooseTeam = async ({
  run,
  requestedTeamName,
  publicAlias
}: {
  run: UnknownRecord;
  requestedTeamName?: string;
  publicAlias: string;
}) => {
  const supabase = createAdminClient();
  const runId = textValue(run.id);
  const teamMode = textValue(run.team_mode, "automatic");

  if (teamMode === "solo") {
    const teamAccessCode = randomCode(6);
    const { data, error } = await supabase
      .from("teams")
      .insert({
        run_id: runId,
        public_name: publicAlias,
        access_code_hash: hashSecret(teamAccessCode)
      })
      .select("id,public_name")
      .single();
    if (error || !data) throw error ?? new Error("Failed to create solo team");
    return data;
  }

  if (teamMode === "preassigned" && requestedTeamName?.trim()) {
    const desiredName = requestedTeamName.trim().slice(0, 40);
    const { data: existing } = await supabase
      .from("teams")
      .select("id,public_name")
      .eq("run_id", runId)
      .eq("public_name", desiredName)
      .maybeSingle();
    if (existing) return existing;

    const { data, error } = await supabase
      .from("teams")
      .insert({
        run_id: runId,
        public_name: desiredName,
        access_code_hash: hashSecret(randomCode(6))
      })
      .select("id,public_name")
      .single();
    if (error || !data) throw error ?? new Error("Failed to create team");
    return data;
  }

  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id,public_name,created_at")
    .eq("run_id", runId)
    .order("created_at");
  if (teamsError) throw teamsError;

  const { data: members, error: membersError } = await supabase
    .from("participants")
    .select("team_id")
    .eq("run_id", runId);
  if (membersError) throw membersError;

  const counts = new Map<string, number>();
  for (const member of members ?? []) {
    if (member.team_id) counts.set(member.team_id, (counts.get(member.team_id) ?? 0) + 1);
  }

  const settings = objectValue(run.settings);
  const desiredTeamSize = numberValue(settings.desiredTeamSize, DEFAULT_TEAM_SIZE);
  const available = (teams ?? []).find(
    (team) => (counts.get(team.id) ?? 0) < desiredTeamSize
  );
  if (available) return available;

  const maxTeams = numberValue(run.max_teams, 10);
  if ((teams?.length ?? 0) >= maxTeams) {
    const smallest = [...(teams ?? [])].sort(
      (left, right) => (counts.get(left.id) ?? 0) - (counts.get(right.id) ?? 0)
    )[0];
    if (!smallest) throw new Error("No team capacity available");
    return smallest;
  }

  const usedNames = new Set((teams ?? []).map((team) => team.public_name));
  const generatedName =
    TEAM_NAMES.find((name) => !usedNames.has(name)) ??
    `קבוצה ${(teams?.length ?? 0) + 1}`;

  const { data, error } = await supabase
    .from("teams")
    .insert({
      run_id: runId,
      public_name: generatedName,
      access_code_hash: hashSecret(randomCode(6))
    })
    .select("id,public_name")
    .single();
  if (error || !data) throw error ?? new Error("Failed to create automatic team");
  return data;
};

export const joinRun = async (input: JoinRunInput) => {
  if (!input.consent) throw new Error("Consent is required");
  const firstName = input.firstName.trim().slice(0, 40);
  if (!firstName) throw new Error("First name is required");

  const supabase = createAdminClient();
  const runCode = input.runCode.trim().toUpperCase();
  const { data: run, error: runError } = await supabase
    .from("game_runs")
    .select("*")
    .eq("public_code", runCode)
    .single();

  if (runError || !run) throw new Error("Game was not found");
  if (!["registration_open", "ready", "active"].includes(run.status)) {
    throw new Error("Registration is closed");
  }

  const { count, error: countError } = await supabase
    .from("participants")
    .select("id", { count: "exact", head: true })
    .eq("run_id", run.id);
  if (countError) throw countError;
  if ((count ?? 0) >= run.max_participants) throw new Error("Game is full");

  const normalizedPhone = input.phone?.trim()
    ? normalizePhone(input.phone)
    : null;
  const phoneHash = normalizedPhone ? hashSecret(normalizedPhone) : null;

  if (phoneHash) {
    const { data: existing } = await supabase
      .from("participants")
      .select("id")
      .eq("run_id", run.id)
      .eq("phone_hash", phoneHash)
      .maybeSingle();
    if (existing) throw new Error("This phone is already registered");
  }

  const publicAlias = (input.publicAlias?.trim() || firstName).slice(0, 40);
  const team = await chooseTeam({
    run: run as unknown as UnknownRecord,
    requestedTeamName: input.requestedTeamName,
    publicAlias
  });

  const provisionalToken = randomToken();
  const recoveryCode = randomCode(6);
  const { data: participant, error: participantError } = await supabase
    .from("participants")
    .insert({
      run_id: run.id,
      team_id: team.id,
      first_name_ciphertext: encryptPii(firstName),
      public_alias: publicAlias,
      phone_ciphertext: normalizedPhone ? encryptPii(normalizedPhone) : null,
      phone_hash: phoneHash,
      language: input.language,
      personal_token_hash: hashSecret(provisionalToken),
      recovery_code_hash: hashSecret(recoveryCode),
      consent_at: new Date().toISOString()
    })
    .select("id")
    .single();

  if (participantError || !participant) {
    throw participantError ?? new Error("Failed to register participant");
  }

  const personalToken = stableParticipantPlayToken(participant.id);
  const { error: stableTokenError } = await supabase
    .from("participants")
    .update({ personal_token_hash: hashSecret(personalToken) })
    .eq("id", participant.id);
  if (stableTokenError) throw stableTokenError;

  await supabase.from("game_events").insert({
    run_id: run.id,
    team_id: team.id,
    participant_id: participant.id,
    event_type: "PLAYER_JOINED",
    idempotency_key: `player-joined:${participant.id}`,
    payload: { language: input.language }
  });

  return {
    participantId: participant.id,
    participantToken: personalToken,
    recoveryCode,
    teamName: team.public_name,
    playUrl: `${publicEnv.appUrl}/play/${personalToken}`,
    sandboxJoinUrl: publicEnv.twilioSandboxJoinCode
      ? makeWaLink(`join ${publicEnv.twilioSandboxJoinCode}`)
      : null,
    gameLinkUrl: makeWaLink(`PLAY ${run.public_code} ${recoveryCode}`)
  };
};

const getParticipantRecordByToken = async (token: string) => {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("participants")
    .select("*")
    .eq("personal_token_hash", hashSecret(token))
    .single();
  if (error || !data) throw new Error("Participant link is invalid or expired");
  return data;
};

export const getParticipantState = async (token: string): Promise<ParticipantState> => {
  const supabase = createAdminClient();
  const participant = await getParticipantRecordByToken(token);
  if (!participant.team_id) throw new Error("Participant has no team");

  const [{ data: run, error: runError }, { data: team, error: teamError }] =
    await Promise.all([
      supabase.from("game_runs").select("*").eq("id", participant.run_id).single(),
      supabase.from("teams").select("*").eq("id", participant.team_id).single()
    ]);

  if (runError || !run) throw new Error("Game was not found");
  if (teamError || !team) throw new Error("Team was not found");

  const { data: memberRows, error: memberError } = await supabase
    .from("participants")
    .select("id,first_name_ciphertext")
    .eq("team_id", team.id)
    .order("joined_at");
  if (memberError) throw memberError;

  let checkpoint: ParticipantState["checkpoint"] = null;
  if (team.current_checkpoint_slug) {
    const { data, error } = await supabase
      .from("run_checkpoints")
      .select("*")
      .eq("run_id", run.id)
      .eq("slug", team.current_checkpoint_slug)
      .single();
    if (error) throw error;
    if (data) {
      checkpoint = {
        id: data.id,
        slug: data.slug,
        sequenceNo: data.sequence_no,
        kind: data.kind,
        content: objectValue(data.content),
        validation: objectValue(data.validation),
        hints: arrayValue(data.hints),
        scoring: objectValue(data.scoring),
        fallback: data.fallback_checkpoint
          ? objectValue(data.fallback_checkpoint)
          : null,
        latitude: data.latitude,
        longitude: data.longitude,
        radiusMeters: data.radius_meters
      };
    }
  }

  await supabase
    .from("participants")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", participant.id);

  return {
    participant: {
      id: participant.id,
      firstName: decryptPii(participant.first_name_ciphertext),
      publicAlias: participant.public_alias,
      language: participant.language as Locale,
      whatsappConnected: Boolean(participant.whatsapp_connected_at)
    },
    run: {
      id: run.id,
      publicCode: run.public_code,
      status: run.status,
      routeMode: run.route_mode,
      scoringMode: run.scoring_mode,
      scheduledAt: run.scheduled_at
    },
    team: {
      id: team.id,
      name: team.public_name,
      status: team.status,
      score: team.score,
      completedCount: team.completed_count,
      wrongAttempts: team.wrong_attempts,
      hintsUsed: team.hints_used,
      currentCheckpointSlug: team.current_checkpoint_slug,
      startedAt: team.started_at,
      lastProgressAt: team.last_progress_at
    },
    members: (memberRows ?? []).map((member) => ({
      id: member.id,
      firstName: decryptPii(member.first_name_ciphertext)
    })),
    checkpoint
  };
};

const textValidationForCheckpoint = (
  state: ParticipantState
): TextValidation => {
  const checkpoint = state.checkpoint;
  if (!checkpoint) throw new Error("No active checkpoint");

  const validation = checkpoint.validation;
  if (validation.type === "text" && Array.isArray(validation.accepted)) {
    return {
      type: "text",
      accepted: validation.accepted.filter(
        (item): item is string => typeof item === "string"
      ),
      fuzzyThreshold:
        typeof validation.fuzzyThreshold === "number"
          ? validation.fuzzyThreshold
          : undefined
    };
  }

  const fallback = checkpoint.fallback;
  if (fallback && Array.isArray(fallback.accepted)) {
    return {
      type: "text",
      accepted: fallback.accepted.filter(
        (item): item is string => typeof item === "string"
      ),
      fuzzyThreshold: 0.94
    };
  }

  throw new Error("This checkpoint does not accept a text answer");
};

export const submitTextAnswer = async ({
  token,
  answer,
  idempotencyKey
}: {
  token: string;
  answer: string;
  idempotencyKey: string;
}) => {
  const state = await getParticipantState(token);
  if (state.run.status !== "active") throw new Error("Game is not active");
  if (!state.checkpoint) throw new Error("No active checkpoint");

  const validation = textValidationForCheckpoint(state);
  const evaluation = evaluateTextAnswer(answer, validation);
  const scoring = state.checkpoint.scoring as ScoringConfig;
  const referenceTime =
    state.team.lastProgressAt ?? state.team.startedAt ?? new Date().toISOString();
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(referenceTime).getTime()) / 1000)
  );
  const scoreDelta = calculateScoreDelta({
    correct: evaluation.correct,
    wrongAttempts: state.team.wrongAttempts,
    hintsUsed: state.team.hintsUsed,
    elapsedSeconds,
    scoring
  });

  const supabase = createAdminClient();
  const { data: nextCheckpoint, error: nextError } = await supabase
    .from("run_checkpoints")
    .select("slug,sequence_no")
    .eq("run_id", state.run.id)
    .eq("is_disabled", false)
    .gt("sequence_no", state.checkpoint.sequenceNo)
    .order("sequence_no")
    .limit(1)
    .maybeSingle();
  if (nextError) throw nextError;

  const isFinal = state.checkpoint.kind === "finale" || !nextCheckpoint;
  const { data: result, error } = await supabase.rpc("apply_submission", {
    p_team_id: state.team.id,
    p_participant_id: state.participant.id,
    p_checkpoint_id: state.checkpoint.id,
    p_submission_type: "text",
    p_normalized_answer: evaluation.normalizedAnswer,
    p_payload: { rawLength: answer.length, reason: evaluation.reason },
    p_is_correct: evaluation.correct,
    p_score_delta: scoreDelta,
    p_validation_reason: evaluation.reason,
    p_idempotency_key: idempotencyKey,
    p_next_checkpoint_slug: nextCheckpoint?.slug ?? null,
    p_is_final: isFinal
  });
  if (error) throw error;

  const replayed = isIdempotencyReplay(result);
  if (evaluation.correct && !replayed) {
    const locale = state.participant.language;
    const contentForLocale = objectValue(state.checkpoint.content[locale]);
    const success = textValue(contentForLocale.success, locale === "he" ? "נכון!" : "Correct!");
    await queueTeamMessage({
      runId: state.run.id,
      teamId: state.team.id,
      locale,
      body: success
    });
  }

  return {
    evaluation,
    scoreDelta,
    result,
    replayed
  };
};

const replayHintRequest = async ({
  state,
  idempotencyKey
}: {
  state: ParticipantState;
  idempotencyKey: string;
}) => {
  const event = await findParticipantIdempotencyEvent({
    idempotencyKey,
    teamId: state.team.id,
    participantId: state.participant.id,
    eventTypes: ["HINT_REQUESTED"]
  });
  if (!event) return null;

  const hint = textValue(event.payload.hint_text);
  if (!hint) throwIdempotencyConflict();

  return {
    hint,
    penalty: numberValue(event.payload.penalty, 10),
    result: {
      duplicate: true,
      score: state.team.score,
      hints_used: state.team.hintsUsed
    },
    replayed: true
  };
};

export const requestHint = async ({
  token,
  idempotencyKey
}: {
  token: string;
  idempotencyKey: string;
}) => {
  const state = await getParticipantState(token);
  const previous = await replayHintRequest({ state, idempotencyKey });
  if (previous) return previous;

  if (state.run.status !== "active" || !state.checkpoint) {
    throw new Error("No active checkpoint");
  }

  const supabase = createAdminClient();
  const { data: hintEvents, error: hintError } = await supabase
    .from("game_events")
    .select("id")
    .eq("team_id", state.team.id)
    .eq("event_type", "HINT_REQUESTED")
    .contains("payload", { checkpoint_slug: state.checkpoint.slug });
  if (hintError) throw hintError;

  const hintIndex = hintEvents?.length ?? 0;
  const rawHint = state.checkpoint.hints[hintIndex];
  const hint = objectValue(rawHint);
  if (!Object.keys(hint).length) throw new Error("No more hints are available");

  const hintText = textValue(hint[state.participant.language], textValue(hint.he));
  const penalty = numberValue(hint.penalty, 10);
  const { data: result, error } = await supabase.rpc("request_hint", {
    p_team_id: state.team.id,
    p_participant_id: state.participant.id,
    p_checkpoint_id: state.checkpoint.id,
    p_hint_index: hintIndex,
    p_penalty: penalty,
    p_hint_text: hintText,
    p_idempotency_key: idempotencyKey
  });
  if (error) throw error;

  if (isIdempotencyReplay(result)) {
    const replay = await replayHintRequest({ state, idempotencyKey });
    if (replay) return replay;
    throwIdempotencyConflict();
  }

  await queueTeamMessage({
    runId: state.run.id,
    teamId: state.team.id,
    locale: state.participant.language,
    body: `${state.participant.language === "he" ? "רמז" : "Hint"}: ${hintText}`
  });

  return { hint: hintText, penalty, result, replayed: false };
};

export const startRunByOrganizerToken = async (organizerToken: string) => {
  const supabase = createAdminClient();
  const { data: run, error } = await supabase
    .from("game_runs")
    .select("id,public_code,status")
    .eq("organizer_token_hash", hashSecret(organizerToken))
    .single();
  if (error || !run) throw new Error("Organizer link is invalid or expired");

  const { data: result, error: startError } = await supabase.rpc("start_run", {
    p_run_id: run.id
  });
  if (startError) throw startError;
  return { run, result };
};

export const getOrganizerRun = async (organizerToken: string) => {
  const supabase = createAdminClient();
  const { data: run, error } = await supabase
    .from("game_runs")
    .select("*")
    .eq("organizer_token_hash", hashSecret(organizerToken))
    .single();
  if (error || !run) throw new Error("Organizer link is invalid or expired");

  const now = new Date();
  const [
    teamsResult,
    participantsResult,
    checkpointsResult,
    presenceResult,
    outboxResult,
    auditResult,
    deliveryResult
  ] = await Promise.all([
    supabase
      .from("teams")
      .select(
        "id,public_name,status,score,completed_count,current_checkpoint_slug,wrong_attempts,hints_used,last_progress_at,started_at,finished_at"
      )
      .eq("run_id", run.id)
      .order("score", { ascending: false }),
    supabase
      .from("participants")
      .select(
        "id,team_id,public_alias,language,whatsapp_connected_at,last_seen_at"
      )
      .eq("run_id", run.id),
    supabase
      .from("run_checkpoints")
      .select(
        "id,source_checkpoint_id,slug,sequence_no,kind,is_disabled,is_optional,fallback_checkpoint,validation"
      )
      .eq("run_id", run.id)
      .order("sequence_no"),
    supabase
      .from("quest_presence")
      .select("team_id,participant_id,visible,online_at,expires_at")
      .eq("run_id", run.id)
      .gt("expires_at", now.toISOString()),
    supabase
      .from("message_outbox")
      .select(
        "id,participant_id,status,attempts,last_error,provider_status,provider_error_code,created_at,sent_at,delivered_at,send_after,target_scope"
      )
      .eq("run_id", run.id)
      .order("created_at", { ascending: false })
      .limit(250),
    supabase
      .from("organizer_audit_log")
      .select(
        "id,action,actor,reason,before_state,after_state,created_at"
      )
      .eq("run_id", run.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.rpc("get_outbox_status_counts", { p_run_id: run.id })
  ]);

  for (const result of [
    teamsResult,
    participantsResult,
    checkpointsResult,
    presenceResult,
    outboxResult,
    auditResult,
    deliveryResult
  ]) {
    if (result.error) throw result.error;
  }

  const checkpointRows = checkpointsResult.data ?? [];
  const sourceIds = checkpointRows
    .map((checkpoint) => checkpoint.source_checkpoint_id)
    .filter((sourceId): sourceId is string => Boolean(sourceId));
  const sourceActiveById = new Map<string, boolean>();
  const fieldHealthById = new Map<string, CheckpointFieldHealth>();
  if (sourceIds.length) {
    const [sourcesResult, healthResult] = await Promise.all([
      supabase
        .from("template_checkpoints")
        .select("id,is_active")
        .in("id", sourceIds),
      supabase
        .from("checkpoint_health")
        .select("checkpoint_id,status,notes,last_checked_at")
        .in("checkpoint_id", sourceIds)
    ]);
    if (sourcesResult.error) throw sourcesResult.error;
    if (healthResult.error) throw healthResult.error;
    for (const source of sourcesResult.data ?? []) {
      sourceActiveById.set(source.id, source.is_active);
    }
    for (const health of healthResult.data ?? []) {
      fieldHealthById.set(health.checkpoint_id, {
        status: health.status,
        notes: health.notes,
        lastCheckedAt: health.last_checked_at
      });
    }
  }

  const stuckThresholdMinutes = stuckThresholdFromSettings(run.settings);
  const teams = deriveTeamTelemetry(
    teamsResult.data ?? [],
    presenceResult.data ?? [],
    now,
    stuckThresholdMinutes
  );
  const checkpoints = deriveCheckpointHealth(
    checkpointRows,
    sourceActiveById,
    fieldHealthById
  );
  const outbox = outboxResult.data ?? [];
  const rawDelivery = Array.isArray(deliveryResult.data)
    ? deliveryResult.data[0]
    : null;
  const outboxSummary = {
    queued: Number(rawDelivery?.queued ?? 0),
    processing: Number(rawDelivery?.processing ?? 0),
    sent: Number(rawDelivery?.sent ?? 0),
    delivered: Number(rawDelivery?.delivered ?? 0),
    failed: Number(rawDelivery?.failed ?? 0),
    total:
      Number(rawDelivery?.queued ?? 0) +
      Number(rawDelivery?.processing ?? 0) +
      Number(rawDelivery?.sent ?? 0) +
      Number(rawDelivery?.delivered ?? 0) +
      Number(rawDelivery?.failed ?? 0)
  };
  const activeCheckpoints = checkpoints.filter(
    (checkpoint) => !checkpoint.is_disabled
  );
  const unhealthyCheckpoints = activeCheckpoints.filter(
    (checkpoint) => !checkpoint.healthy
  );
  const blockedCheckpoints = activeCheckpoints.filter(
    (checkpoint) =>
      !checkpoint.source_active ||
      ["blocked", "needs_attention"].includes(
        checkpoint.field_health_status
      )
  );
  const pendingCheckpoints = activeCheckpoints.filter(
    (checkpoint) => checkpoint.field_health_status === "pending"
  );
  const missingFallbacks = activeCheckpoints.filter(
    (checkpoint) =>
      ["photo", "hybrid"].includes(checkpoint.kind) &&
      !checkpoint.fallback_ready
  );

  return {
    run,
    teams,
    participants: participantsResult.data ?? [],
    checkpoints,
    presence: presenceResult.data ?? [],
    outbox,
    outboxSummary,
    audit: auditResult.data ?? [],
    goNoGo: {
      ready:
        activeCheckpoints.length > 0 &&
        unhealthyCheckpoints.length === 0 &&
        outboxSummary.failed === 0,
      activeCheckpoints: activeCheckpoints.length,
      verifiedCheckpoints: activeCheckpoints.filter((checkpoint) =>
        ["verified", "not_required"].includes(
          checkpoint.field_health_status
        )
      ).length,
      pendingCheckpoints: pendingCheckpoints.length,
      blockedCheckpoints: blockedCheckpoints.length,
      unhealthyCheckpoints: unhealthyCheckpoints.length,
      missingFallbacks: missingFallbacks.length,
      failedMessages: outboxSummary.failed,
      stuckThresholdMinutes
    },
    joinUrl: `${publicEnv.appUrl}/join/${run.public_code}`,
    liveUrl: `${publicEnv.appUrl}/live/${run.public_code}`
  };
};

export const getLeaderboard = async (publicCode: string) => {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("leaderboard_entries")
    .select("team_name,score,completed_count,status,last_progress_at,updated_at")
    .eq("run_public_code", publicCode.trim().toUpperCase())
    .order("score", { ascending: false })
    .order("completed_count", { ascending: false });
  if (error) throw error;
  return data ?? [];
};

export const linkWhatsappParticipant = async ({
  from,
  body
}: {
  from: string;
  body: string;
}) => {
  const match = body.trim().match(/^PLAY\s+([A-Z0-9]{4,12})\s+([A-Z0-9]{4,12})$/i);
  if (!match) return null;

  const runCode = match[1].toUpperCase();
  const recoveryCode = match[2].toUpperCase();
  const normalizedPhone = normalizePhone(from.replace(/^whatsapp:/, ""));
  const supabase = createAdminClient();
  const { data: run, error: runError } = await supabase
    .from("game_runs")
    .select("id")
    .eq("public_code", runCode)
    .single();
  if (runError || !run) throw new Error("Game was not found");

  const { data: participant, error: participantError } = await supabase
    .from("participants")
    .select("id,team_id,first_name_ciphertext,language")
    .eq("run_id", run.id)
    .eq("recovery_code_hash", hashSecret(recoveryCode))
    .single();
  if (participantError || !participant) throw new Error("Recovery code is invalid");

  const { error: updateError } = await supabase
    .from("participants")
    .update({
      phone_ciphertext: encryptPii(normalizedPhone),
      phone_hash: hashSecret(normalizedPhone),
      whatsapp_connected_at: new Date().toISOString()
    })
    .eq("id", participant.id);
  if (updateError) throw updateError;

  await supabase.from("game_events").insert({
    run_id: run.id,
    team_id: participant.team_id,
    participant_id: participant.id,
    event_type: "PLAYER_CONFIRMED_WHATSAPP",
    idempotency_key: `wa-connected:${participant.id}`,
    payload: {}
  });

  const firstName = decryptPii(participant.first_name_ciphertext);
  return {
    participantId: participant.id,
    message:
      participant.language === "en"
        ? `Connected, ${firstName}. You will receive game messages here.`
        : `החיבור הושלם, ${firstName}. הודעות המשחק יגיעו לכאן.`
  };
};

export const resolveWhatsappGameContextByPhone = async ({
  from,
  requestedRunCode,
  now
}: {
  from: string;
  requestedRunCode?: string;
  now?: Date;
}): Promise<WhatsappContextResolution> => {
  const normalizedPhone = normalizePhone(from.replace(/^whatsapp:/, ""));
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("get_whatsapp_game_contexts", {
    p_phone_hash: hashSecret(normalizedPhone)
  });
  if (error) throw error;

  const candidates = Array.isArray(data)
    ? (data as unknown as WhatsappGameContext[])
    : [];
  return resolveWhatsappContextCandidates(candidates, {
    requestedRunCode,
    now
  });
};

export const findParticipantTokenlessByPhone = async (from: string) => {
  const resolution = await resolveWhatsappGameContextByPhone({ from });
  if (resolution.kind === "ambiguous") {
    throw new Error(
      `ambiguous_whatsapp_context:${resolution.runCodes.join(",")}`
    );
  }
  if (resolution.kind === "none") return null;

  const { participant, run, team } = resolution.context;
  return {
    id: participant.id,
    run_id: run.id,
    team_id: team?.id ?? null,
    language: participant.language
  };
};

export const localizedCheckpointPrompt = (
  state: ParticipantState,
  locale: Locale
) => {
  if (!state.checkpoint) return "";
  const content = objectValue(state.checkpoint.content[locale]);
  return {
    title: textValue(content.title),
    story: textValue(content.story),
    prompt: textValue(content.prompt),
    locationHint: textValue(content.locationHint),
    success: textValue(content.success)
  };
};

export const localizedFromJson = (
  value: unknown,
  locale: Locale
): string => localized(objectValue(value) as Partial<LocalizedText>, locale);
