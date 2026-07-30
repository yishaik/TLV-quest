import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260730063500_private_realtime_presence.sql",
  "utf8"
);
const provider = readFileSync("components/QuestRealtimeProvider.tsx", "utf8");
const statusPanel = readFileSync(
  "components/QuestRealtimeStatusPanel.tsx",
  "utf8"
);
const authService = readFileSync("lib/realtime-auth.ts", "utf8");
const authRoute = readFileSync(
  "app/api/participants/[token]/realtime-auth/route.ts",
  "utf8"
);
const experienceMeta = readFileSync("lib/experience-meta.ts", "utf8");

describe("private quest realtime", () => {
  it("authorizes participant-bound event and presence tables", () => {
    expect(migration).toContain("realtime_participant_authorizations");
    expect(migration).toContain("quest_realtime_binding_allowed");
    expect(migration).toContain("quest_realtime_events_participant_read");
    expect(migration).toContain("quest_presence_team_read");
    expect(migration).toContain("quest_presence_own_insert");
    expect(migration).toContain("alter publication supabase_realtime");
    expect(migration).toContain("quest_realtime_event_state");
    expect(migration).not.toContain("on realtime.messages");
  });

  it("issues short-lived access without exposing a refresh token", () => {
    expect(authService).toContain("generateLink");
    expect(authService).toContain("verifyOtp");
    expect(authService).toContain("accessToken");
    expect(authService).not.toContain("refreshToken");
    expect(authRoute).toContain("export async function POST");
    expect(authRoute).toContain("issueParticipantRealtimeAccess");
  });

  it("subscribes with RLS and maintains presence heartbeats without state polling", () => {
    expect(provider).toContain("getQuestRealtimeClient");
    expect(provider).toContain('table: "quest_realtime_events"');
    expect(provider).toContain('table: "quest_presence"');
    expect(provider).toContain("Presence heartbeat failed");
    expect(provider).toContain("PRESENCE_HEARTBEAT_MS");
    expect(provider).not.toContain("setInterval");
  });

  it("returns a safe persisted activity feed and renders connection health", () => {
    expect(experienceMeta).toContain("ACTIVITY_EVENT_TYPES");
    expect(experienceMeta).toContain("actorName");
    expect(experienceMeta).toContain('from("quest_presence")');
    expect(experienceMeta).not.toContain("normalized_answer");
    expect(statusPanel).toContain("connectionState");
    expect(statusPanel).toContain("presence.length");
    expect(statusPanel).toContain("activity.slice(0, 8)");
  });
});
