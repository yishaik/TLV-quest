import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const initialMigration = readFileSync(
  "supabase/migrations/20260730054500_quest_realtime_topics.sql",
  "utf8"
);
const privateMigration = readFileSync(
  "supabase/migrations/20260730063500_private_realtime_presence.sql",
  "utf8"
);
const provider = readFileSync("components/QuestRealtimeProvider.tsx", "utf8");
const player = readFileSync("components/PremiumQuestPlayer.tsx", "utf8");
const safetyNet = readFileSync("components/QuestRuntimeSafetyNet.tsx", "utf8");
const stationVisual = readFileSync("components/QuestStationVisual.tsx", "utf8");
const liveBoard = readFileSync("components/PremiumLiveLeaderboard.tsx", "utf8");
const experienceMeta = readFileSync("lib/experience-meta.ts", "utf8");

describe("quest realtime architecture", () => {
  it("keeps private gameplay tables outside direct Postgres Changes", () => {
    expect(initialMigration).toContain("realtime_topic");
    expect(initialMigration).not.toContain(
      "alter publication supabase_realtime add table public.teams"
    );
    expect(initialMigration).not.toContain(
      "alter publication supabase_realtime add table public.participants"
    );
    expect(privateMigration).toContain("quest_realtime_events");
    expect(privateMigration).toContain("quest_presence");
    expect(privateMigration).not.toContain(
      "alter publication supabase_realtime add table public.game_events"
    );
  });

  it("keeps one shared player state source without interval polling", () => {
    expect(provider).toContain("QuestRealtimeContext.Provider");
    expect(provider).toContain('table: "quest_realtime_events"');
    expect(provider).toContain('table: "quest_presence"');
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

  it("returns safe activity and current presence through the protected API", () => {
    expect(experienceMeta).toContain("activity");
    expect(experienceMeta).toContain("presence");
    expect(experienceMeta).toContain('from("quest_presence")');
    expect(experienceMeta).not.toContain("normalized_answer");
  });
});
