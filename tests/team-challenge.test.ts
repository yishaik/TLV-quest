import { describe, expect, it } from "vitest";
import { teamRolesForCheckpoint } from "@/lib/team-challenge";

describe("two-player challenge roles", () => {
  it("does not burden a solo player with team instructions", () => {
    expect(teamRolesForCheckpoint({ kind: "text", participantCount: 1, locale: "he" })).toEqual([]);
  });

  it("splits reasoning tasks into observation and decoding", () => {
    const roles = teamRolesForCheckpoint({ kind: "choice", participantCount: 2, locale: "he" });
    expect(roles).toHaveLength(2);
    expect(roles[0].title).toContain("סורק");
    expect(roles[1].title).toContain("מפענח");
  });

  it("gives photo tasks production roles", () => {
    const roles = teamRolesForCheckpoint({ kind: "photo", participantCount: 2, locale: "en" });
    expect(roles.map((role) => role.title)).toEqual(["Director", "Performer"]);
  });
});
