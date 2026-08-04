import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  encryptPii,
  hashSecret,
  normalizePhone,
  randomCode,
  randomToken
} from "@/lib/crypto";
import { publicEnv } from "@/lib/env";
import type { Locale } from "@/lib/game-engine";
import { selectCoherentCheckpoints } from "@/lib/checkpoint-selection";

type UnknownRecord = Record<string, unknown>;

const objectValue = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};

const arrayValue = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

export type CreateRouteRunInput = {
  templateSlug: string;
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
  checkpointCount?: number;
  organizerEmail?: string;
  organizerPhone?: string;
  settings?: UnknownRecord;
};

export const createRouteRun = async (input: CreateRouteRunInput) => {
  const supabase = createAdminClient();
  const templateSlug = input.templateSlug.trim();
  if (!templateSlug) throw new Error("A published route must be selected");

  const { data: template, error: templateError } = await supabase
    .from("game_templates")
    .select("id,slug,title,active_version")
    .eq("slug", templateSlug)
    .eq("is_active", true)
    .single();

  if (templateError || !template) {
    throw new Error("The selected route is not published or no longer available");
  }

  const { data: version, error: versionError } = await supabase
    .from("template_versions")
    .select("status")
    .eq("template_id", template.id)
    .eq("version", template.active_version)
    .single();
  if (versionError || version?.status !== "published") {
    throw new Error("The selected route does not have a published active version");
  }

  const { data: checkpoints, error: checkpointError } = await supabase
    .from("template_checkpoints")
    .select("*")
    .eq("template_id", template.id)
    .eq("version", template.active_version)
    .eq("is_active", true)
    .order("sequence_no");

  if (checkpointError) throw checkpointError;
  if (!checkpoints?.length) throw new Error("The selected route has no active checkpoints");
  const selectedCheckpoints = selectCoherentCheckpoints(
    checkpoints,
    input.checkpointCount
  );
  const selectedSlugs = new Set(selectedCheckpoints.map((checkpoint) => checkpoint.slug));

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
    Math.min(8, input.desiredTeamSize ?? 4)
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
        templateSlug: template.slug,
        templateTitle: template.title,
        selectedCheckpointCount: selectedCheckpoints.length,
        sourceCheckpointCount: checkpoints.length,
        ...(input.settings ?? {})
      }
    })
    .select("id,public_code,status")
    .single();

  if (runError || !run) throw runError ?? new Error("Failed to create run");

  const snapshotRows = selectedCheckpoints.map((checkpoint, index) => {
    const config = objectValue(checkpoint.config);
    const content = objectValue(config.content);
    const previousConfig = index > 0
      ? objectValue(selectedCheckpoints[index - 1].config)
      : null;
    const previousContent = previousConfig
      ? objectValue(previousConfig.content)
      : null;
    const contentWithTransition = { ...content };
    if (previousContent) {
      for (const locale of ["he", "en"] as const) {
        const localized = objectValue(content[locale]);
        const previousLocalized = objectValue(previousContent[locale]);
        const previousTitle =
          typeof previousLocalized.title === "string"
            ? previousLocalized.title
            : "";
        const currentTitle =
          typeof localized.title === "string" ? localized.title : "";
        contentWithTransition[locale] = {
          ...localized,
          transition:
            locale === "he"
              ? `השלמתם את ${previousTitle || "התחנה הקודמת"}. עכשיו ממשיכים אל ${currentTitle || "התחנה הבאה"}.`
              : `${previousTitle || "The previous stop"} is complete. Continue to ${currentTitle || "the next stop"}.`
        };
      }
    }
    return {
      run_id: run.id,
      source_checkpoint_id: checkpoint.id,
      slug: checkpoint.slug,
      sequence_no: index + 1,
      kind: checkpoint.kind,
      latitude: checkpoint.latitude,
      longitude: checkpoint.longitude,
      radius_meters: checkpoint.radius_meters,
      content: contentWithTransition,
      validation: objectValue(config.validation),
      hints: arrayValue(config.hints),
      accessibility: checkpoint.accessibility,
      scoring: objectValue(config.scoring),
      prerequisites: Array.isArray(config.prerequisites)
        ? config.prerequisites.filter(
            (item): item is string =>
              typeof item === "string" && selectedSlugs.has(item)
          )
        : [],
      fallback_checkpoint: config.fallback ? objectValue(config.fallback) : null,
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
    payload: {
      templateSlug: template.slug,
      version: template.active_version,
      checkpointCount: selectedCheckpoints.length,
      sourceCheckpointCount: checkpoints.length
    }
  });

  return {
    runId: run.id,
    publicCode,
    organizerToken,
    route: {
      slug: template.slug,
      title: template.title,
      version: template.active_version
    },
    joinUrl: `${publicEnv.appUrl}/join/${publicCode}`,
    manageUrl: `${publicEnv.appUrl}/organize/${organizerToken}`,
    liveUrl: `${publicEnv.appUrl}/live/${publicCode}`
  };
};
