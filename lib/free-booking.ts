import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hashSecret } from "@/lib/crypto";
import { createRouteRun } from "@/lib/run-creation";
import { AppError } from "@/lib/http";

/**
 * Free self-service booking.
 *
 * The promotional window lets anyone create a run from the marketing site
 * without an organizer invite. The only thing standing between that and abuse
 * is this cap, so it is enforced server-side against a keyed hash of the
 * booker's email rather than anything the client sends about itself.
 */
export const FREE_RUNS_PER_BOOKER = 3;

/** Cap participants below the schema maximum: a free run is a taster. */
export const FREE_RUN_MAX_PARTICIPANTS = 30;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;

export type FreeBookingInput = {
  email: string;
  name: string;
  templateSlug: string;
  scheduledAt?: string | null;
  maxParticipants?: number;
  checkpointCount?: number;
  locale?: "he" | "en";
};

export const normalizeBookerEmail = (value: unknown): string => {
  const email = String(value ?? "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    throw new AppError({
      message: "A valid email address is required",
      status: 400,
      code: "invalid_email"
    });
  }
  return email;
};

export const countFreeRunsForBooker = async (email: string): Promise<number> => {
  const supabase = createAdminClient();
  const { count, error } = await supabase
    .from("game_runs")
    .select("id", { count: "exact", head: true })
    .eq("booker_email_hash", hashSecret(email));
  if (error) throw error;
  return count ?? 0;
};

export const createFreeRun = async (input: FreeBookingInput) => {
  const email = normalizeBookerEmail(input.email);
  const name = String(input.name ?? "").trim();
  if (name.length < 2 || name.length > 120) {
    throw new AppError({
      message: "A name between 2 and 120 characters is required",
      status: 400,
      code: "invalid_name"
    });
  }

  // Checked before creating rather than after, and re-checked below against
  // what actually landed, because two requests can pass this line together.
  const already = await countFreeRunsForBooker(email);
  if (already >= FREE_RUNS_PER_BOOKER) {
    throw new AppError({
      message: `Free booking is limited to ${FREE_RUNS_PER_BOOKER} games per person`,
      status: 429,
      code: "free_booking_limit_reached"
    });
  }

  const requested = Number(input.maxParticipants);
  const maxParticipants =
    Number.isFinite(requested) && requested >= 2
      ? Math.min(Math.floor(requested), FREE_RUN_MAX_PARTICIPANTS)
      : FREE_RUN_MAX_PARTICIPANTS;

  const run = await createRouteRun({
    templateSlug: input.templateSlug,
    scheduledAt: input.scheduledAt ?? null,
    startMode: "manual",
    localeDefault: input.locale === "en" ? "en" : "he",
    maxParticipants,
    checkpointCount: input.checkpointCount,
    teamMode: "automatic",
    maxTeams: maxParticipants <= 6 ? 1 : undefined,
    desiredTeamSize: maxParticipants <= 6 ? maxParticipants : undefined,
    organizerEmail: email,
    settings: { freeBooking: true, bookerName: name }
  });

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("game_runs")
    .update({ booker_email_hash: hashSecret(email) })
    .eq("id", run.runId);
  if (error) throw error;

  // The stamp lands after creation, so a race could have let two runs through
  // at once. Detecting it here and cancelling the surplus keeps the cap honest
  // without needing a lock on a table this small and this rarely written.
  const total = await countFreeRunsForBooker(email);
  if (total > FREE_RUNS_PER_BOOKER) {
    await supabase
      .from("game_runs")
      .update({ status: "cancelled" })
      .eq("id", run.runId);
    throw new AppError({
      message: `Free booking is limited to ${FREE_RUNS_PER_BOOKER} games per person`,
      status: 429,
      code: "free_booking_limit_reached"
    });
  }

  return {
    ...run,
    remainingFreeRuns: Math.max(0, FREE_RUNS_PER_BOOKER - total)
  };
};
