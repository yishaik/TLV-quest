import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const player = readFileSync("components/PremiumQuestPlayer.tsx", "utf8");

describe("explicit checkpoint completion moment", () => {
  it("waits for the team to continue instead of auto-advancing", () => {
    expect(player).toContain("CompletionMoment");
    expect(player).toContain("ממשיכים לתחנה הבאה");
    expect(player).not.toContain("setTimeout(() => void refresh(), 850)");
  });

  it("shows the actor, answer and score", () => {
    expect(player).toContain("מי פתר/ה");
    expect(player).toContain("completion.answer");
    expect(player).toContain("completion.points");
  });

  it("does not force map links into new tabs", () => {
    const mapDrawer = player.slice(player.indexOf('drawer === "map"'), player.indexOf('drawer === "board"'));
    expect(mapDrawer).not.toContain('target="_blank"');
  });
});
