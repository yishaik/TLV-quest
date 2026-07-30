import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  deriveCheckpointHealth,
  deriveTeamTelemetry,
  stuckThresholdFromSettings,
  summarizeOutbox
} from "../lib/live-ops";
import { RATE_LIMIT_POLICIES } from "../lib/rate-limit-core";

const migration = readFileSync(
  "supabase/migrations/20260730105213_live_ops_control_room.sql",
  "utf8"
);
const bannerRealtimeMigration = readFileSync(
  "supabase/migrations/20260730205835_live_ops_banner_realtime.sql",
  "utf8"
);
const controlRoute = readFileSync(
  "app/api/organizer/[token]/control/route.ts",
  "utf8"
);
const organizerRepository = readFileSync("lib/repository.ts", "utf8");
const organizerDashboard = readFileSync(
  "components/PremiumOrganizerDashboard.tsx",
  "utf8"
);
const experienceMeta = readFileSync("lib/experience-meta.ts", "utf8");
const premiumPlayer = readFileSync(
  "components/PremiumQuestPlayer.tsx",
  "utf8"
);

describe("live event operations", () => {
  it("flags active teams after a configurable stalled threshold", () => {
    expect(stuckThresholdFromSettings({ stuck_threshold_minutes: 14.6 })).toBe(
      15
    );
    expect(stuckThresholdFromSettings({ stuckThresholdMinutes: 1 })).toBe(3);
    expect(stuckThresholdFromSettings({ stuckThresholdMinutes: 200 })).toBe(
      60
    );

    const now = new Date("2026-07-30T12:30:00.000Z");
    const teams = deriveTeamTelemetry(
      [
        {
          id: "team-a",
          status: "solving",
          last_progress_at: "2026-07-30T12:10:00.000Z",
          started_at: "2026-07-30T12:00:00.000Z"
        },
        {
          id: "team-b",
          status: "finished",
          last_progress_at: "2026-07-30T11:00:00.000Z",
          started_at: "2026-07-30T10:00:00.000Z"
        }
      ],
      [
        { team_id: "team-a", participant_id: "participant-1" },
        { team_id: "team-a", participant_id: "participant-1" },
        { team_id: "team-a", participant_id: "participant-2" }
      ],
      now,
      10
    );

    expect(teams[0]).toMatchObject({
      online_count: 2,
      minutes_since_progress: 20,
      is_stuck: true
    });
    expect(teams[1].is_stuck).toBe(false);
  });

  it("combines source, field verification, and fallback health", () => {
    const checkpoints = deriveCheckpointHealth(
      [
        {
          id: "run-checkpoint-a",
          source_checkpoint_id: "source-a",
          kind: "photo",
          is_disabled: false,
          fallback_checkpoint: {
            he: "שאלת גיבוי",
            accepted: ["תשובה"]
          }
        },
        {
          id: "run-checkpoint-b",
          source_checkpoint_id: "source-b",
          kind: "text",
          is_disabled: false,
          fallback_checkpoint: null
        }
      ],
      new Map([
        ["source-a", true],
        ["source-b", true]
      ]),
      new Map([
        [
          "source-a",
          {
            status: "verified",
            notes: null,
            lastCheckedAt: "2026-07-30T10:00:00.000Z"
          }
        ],
        [
          "source-b",
          { status: "blocked", notes: "רחוב חסום", lastCheckedAt: null }
        ]
      ])
    );

    expect(checkpoints[0]).toMatchObject({
      source_active: true,
      field_health_status: "verified",
      fallback_ready: true,
      healthy: true
    });
    expect(checkpoints[1]).toMatchObject({
      field_health_status: "blocked",
      healthy: false
    });
  });

  it("exposes queued, provider delivery, and failure states", () => {
    expect(
      summarizeOutbox([
        { status: "pending", provider_status: null },
        { status: "processing", provider_status: "sending" },
        { status: "sent", provider_status: "sent" },
        { status: "sent", provider_status: "delivered" },
        { status: "failed", provider_status: "undelivered" }
      ])
    ).toEqual({
      total: 5,
      queued: 1,
      processing: 1,
      sent: 1,
      delivered: 1,
      failed: 1
    });
  });

  it("keeps every control mutation authorized, reasoned, rate-limited, and idempotent", () => {
    expect(RATE_LIMIT_POLICIES.organizerControl).toMatchObject({
      limit: 30,
      windowSeconds: 60
    });
    expect(RATE_LIMIT_POLICIES.organizerState).toMatchObject({
      limit: 60,
      windowSeconds: 60
    });
    expect(controlRoute).toContain("organizer_token_hash");
    expect(controlRoute).toContain('reason.length < 5');
    expect(controlRoute).toContain("requireIdempotencyKey(request)");
    expect(controlRoute).toContain('"queue_organizer_broadcast"');
    expect(controlRoute).toContain('"retry_outbox_message"');
    expect(controlRoute).toContain('"apply_organizer_override"');
    expect(controlRoute).toContain("skipCheckpointForTeam");
    expect(controlRoute).toContain("processOutbox");
  });

  it("defines immutable before/after audits and least-privilege RPC access", () => {
    expect(migration).toContain("create table public.organizer_audit_log");
    expect(migration).toContain("before_state jsonb not null");
    expect(migration).toContain("after_state jsonb not null");
    expect(migration).toContain(
      "revoke all on table public.organizer_audit_log"
    );
    expect(migration).toContain(
      "grant select, insert on table public.organizer_audit_log to service_role"
    );
    expect(migration).toContain(
      "create or replace function public.apply_organizer_override"
    );
    expect(migration).toContain(
      "create or replace function public.queue_organizer_broadcast"
    );
    expect(migration).toContain(
      "create or replace function public.retry_outbox_message"
    );
    expect(migration).toContain(
      "on conflict (idempotency_key) do nothing"
    );
  });

  it("wires actionable telemetry, delivery recovery, and in-app banners", () => {
    expect(organizerRepository).toContain('"checkpoint_health"');
    expect(organizerRepository).toContain("deriveTeamTelemetry");
    expect(organizerRepository).toContain("blockedCheckpoints");
    expect(organizerDashboard).toContain('control("grant_hint"');
    expect(organizerDashboard).toContain('control("force_complete"');
    expect(organizerDashboard).toContain('control("move_participant"');
    expect(organizerDashboard).toContain('control("disable_checkpoint"');
    expect(organizerDashboard).toContain('control("retry_message"');
    expect(organizerDashboard).toContain('name="teamId"');
    expect(experienceMeta).toContain('"in_app_banners"');
    expect(premiumPlayer).toContain("ParticipantBanners");
    expect(bannerRealtimeMigration).toContain(
      "create trigger quest_realtime_banner_state"
    );
    expect(bannerRealtimeMigration).toContain(
      "perform public.quest_emit_realtime_event"
    );
  });
});
