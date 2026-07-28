import { describe, expect, it } from "vitest";
import {
  calculateScoreDelta,
  distanceMeters,
  evaluateTextAnswer,
  normalizeAnswer
} from "../lib/game-engine";

describe("game engine", () => {
  it("normalizes Hebrew punctuation, niqqud and final letters", () => {
    expect(normalizeAnswer("  כִּיכָּר-הַנָּמֵל! ")).toBe("כיכר הנמל");
  });

  it("accepts exact and configured fuzzy answers", () => {
    expect(
      evaluateTextAnswer("שנת 1936", {
        type: "text",
        accepted: ["1936", "שנת 1936"],
        fuzzyThreshold: 0.94
      }).correct
    ).toBe(true);

    expect(
      evaluateTextAnswer("מגדלור רידנג", {
        type: "text",
        accepted: ["מגדלור רידינג"],
        fuzzyThreshold: 0.9
      }).correct
    ).toBe(true);
  });

  it("calculates bounded combined scoring", () => {
    const fast = calculateScoreDelta({
      correct: true,
      wrongAttempts: 0,
      hintsUsed: 0,
      elapsedSeconds: 30,
      scoring: { basePoints: 100, speedBonusMax: 20, speedBonusWindowSeconds: 420 }
    });
    const slowWithHint = calculateScoreDelta({
      correct: true,
      wrongAttempts: 1,
      hintsUsed: 1,
      elapsedSeconds: 420,
      scoring: { basePoints: 100, wrongPenalty: 5, hintPenalty: 10, speedBonusMax: 20 }
    });
    expect(fast).toBeGreaterThan(slowWithHint);
    expect(slowWithHint).toBeGreaterThanOrEqual(10);
    expect(
      calculateScoreDelta({
        correct: false,
        wrongAttempts: 0,
        hintsUsed: 0,
        elapsedSeconds: 0
      })
    ).toBe(-5);
  });

  it("computes geographic distance in meters", () => {
    const distance = distanceMeters(
      { latitude: 32.103572, longitude: 34.776975 },
      { latitude: 32.103672, longitude: 34.776975 }
    );
    expect(distance).toBeGreaterThan(10);
    expect(distance).toBeLessThan(12);
  });
});
