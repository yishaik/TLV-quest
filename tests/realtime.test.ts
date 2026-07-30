import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260730054500_quest_realtime_topics.sql",
  "utf8"
);
const provider = readFileSync("components/QuestRealtimeProvider.tsx", "utf8");
const player = readFileSync("components/PremiumQuestPlayer.tsx", "utf8");
const safetyNet = readFileSync("components/QuestRuntimeSafetyNet.tsx", "utf8");
const stationVisual = readFileSync("components/QuestStationVisual.tsx", "utf8");
const liveBoard = readFileSync("components/PremiumLiveLeaderboard.tsx", "utf8");
const experienceMeta = readFileSync("lib/experience-meta.ts", "utf8");

describe("quest realtime architecture", () => {
  it("uses random wake-up topics and minimal public broadcasts", () => {
    expect(migration).toContain("realtime_topic");
    expect(migration).toContain("realtime.send");
    expect(migration).toContain("'state_changed'");
    expect(migration).toContain("false");
    expect(migration).not.toContain("alter publication supabase_realtime add table public.teams");
    expect(migration).not.toContain("alter publication supabase_realtime add table public.participants");
  });

  it("keeps one shared player state source without interval polling", () => {
    expect(provider).toContain("QuestRealtimeContext.Provider");
    expect(provider).toContain('.on("broadcast", { event: "state_changed" }');
    expect(provider).toContain('table: "leaderboard_entries"');
    expect(provider).not.toContain("setInterval");
    expect(player).not.toContain("setInterval");
    expect(safetyNet).not.toContain("setInterval");
    expect(stationVisual).not.toContain("setInterval");
  });

  it("makes the public leaderboard event-driven", () => {
    expect(liveBoard).toContain("postgres_changes");
    expect(liveBoard).not.toContain("setInterval");
  });

  it("returns only opaque realtime topics through the protected state API", () => {
    expect(experienceMeta).toContain("teamTopic");
    expect(experienceMeta).toContain("runTopic");
    expect(experienceMeta).toContain("realtime_topic");
  });
});
