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
  it("authorizes participant-bound private Broadcast and Presence topics", () => {
    expect(migration).toContain("realtime_participant_authorizations");
    expect(migration).toContain("quest_realtime_topic_allowed");
    expect(migration).toContain("quest_participant_receive_realtime");
    expect(migration).toContain("quest_participant_publish_presence");
    expect(migration).toContain("realtime.messages.extension = 'presence'");
    expect(migration).toContain("'state_changed'");
    expect(migration).toContain("true");
    expect(migration).toContain("quest_realtime_event_state");
  });

  it("issues short-lived access without exposing a refresh token", () => {
    expect(authService).toContain("generateLink");
    expect(authService).toContain("verifyOtp");
    expect(authService).toContain("accessToken");
    expect(authService).not.toContain("refreshToken");
    expect(authRoute).toContain('method: "POST"').not;
    expect(authRoute).toContain("issueParticipantRealtimeAccess");
  });

  it("joins private channels and tracks one presence record per device", () => {
    expect(provider).toContain("getQuestRealtimeClient");
    expect(provider).toContain("private: true");
    expect(provider).toContain('event: "sync"');
    expect(provider).toContain("teamChannel.track");
    expect(provider).toContain("tlvQuestRealtimeDeviceId");
    expect(provider).not.toContain("setInterval");
  });

  it("returns a safe persisted activity feed and renders connection health", () => {
    expect(experienceMeta).toContain("ACTIVITY_EVENT_TYPES");
    expect(experienceMeta).toContain("actorName");
    expect(experienceMeta).not.toContain("normalized_answer");
    expect(statusPanel).toContain("connectionState");
    expect(statusPanel).toContain("presence.length");
    expect(statusPanel).toContain("activity.slice(0, 8)");
  });
});
