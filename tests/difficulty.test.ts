import { describe, expect, it } from "vitest";
import {
  adjustScoreForDifficulty,
  evaluateDifficulty
} from "../lib/difficulty";

describe("adaptive difficulty", () => {
  it("keeps a steady team on the standard policy", () => {
    expect(
      evaluateDifficulty({
        wrongAttempts: 1,
        hintsUsed: 0,
        completedCount: 1,
        minutesSinceProgress: 4
      })
    ).toMatchObject({
      level: "standard",
      wrongAttemptsToUnlock: 2,
      inactivityMinutesToUnlock: 7
    });
  });

  it("offers support after repeated errors or inactivity", () => {
    const policy = evaluateDifficulty({
      wrongAttempts: 2,
      hintsUsed: 0,
      completedCount: 1,
      minutesSinceProgress: 2
    });
    expect(policy.level).toBe("assisted");
    expect(policy.wrongAttemptsToUnlock).toBe(1);
    expect(adjustScoreForDifficulty(-10, policy)).toBe(-5);
  });

  it("rewards sustained fast progress and can be disabled", () => {
    const challenge = evaluateDifficulty({
      wrongAttempts: 0,
      hintsUsed: 0,
      completedCount: 3,
      minutesSinceProgress: 1
    });
    expect(challenge.level).toBe("challenge");
    expect(adjustScoreForDifficulty(100, challenge)).toBe(110);
    expect(
      evaluateDifficulty({
        enabled: false,
        wrongAttempts: 9,
        hintsUsed: 9,
        completedCount: 0,
        minutesSinceProgress: 40
      }).level
    ).toBe("standard");
  });
});
