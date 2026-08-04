import { describe, expect, it } from "vitest";
import {
  publicFallbackSummary,
  toPublicCheckpoint
} from "../lib/public-checkpoint";
import type { ParticipantState } from "../lib/repository";

const checkpoint: NonNullable<ParticipantState["checkpoint"]> = {
  id: "checkpoint-1",
  slug: "secret-stop",
  sequenceNo: 3,
  kind: "choice",
  content: {
    he: { title: "חידה", prompt: "בחרו תשובה" },
    en: { title: "Riddle", prompt: "Choose an answer" }
  },
  validation: {
    type: "choice",
    options: ["A", "B", "C"],
    accepted: ["server-only-answer"],
    acceptedOption: "C",
    confidenceThreshold: 0.91
  },
  hints: [{ he: "רמז סודי", penalty: 5 }],
  scoring: { basePoints: 100, wrongPenalty: 10 },
  fallback: {
    he: "שאלת גיבוי",
    en: "Fallback question",
    accepted: ["fallback-secret"]
  },
  latitude: 32.08,
  longitude: 34.77,
  radiusMeters: 40
};

describe("public checkpoint projection", () => {
  it("allowlists participant-safe fields and choice options", () => {
    const projected = toPublicCheckpoint(checkpoint, {
      locale: "he",
      isOptional: false,
      scanVerified: false,
      photoFallbackAvailable: true,
      participantCount: 3
    });

    expect(projected.choiceOptions).toEqual(["A", "B", "C"]);
    expect(projected.validationType).toBe("choice");
    expect(projected.fallbackPrompt).toBe("שאלת גיבוי");
    expect(projected.hasFallback).toBe(true);

    const serialized = JSON.stringify(projected);
    expect(serialized).not.toMatch(
      /accepted|acceptedOption|confidenceThreshold|server-only-answer|fallback-secret/
    );
    expect(serialized).not.toContain("basePoints");
    expect(serialized).not.toContain("רמז סודי");
  });

  it("does not reveal the fallback prompt before it is unlocked", () => {
    const projected = toPublicCheckpoint(checkpoint, {
      locale: "en",
      isOptional: false,
      scanVerified: false,
      photoFallbackAvailable: false,
      participantCount: 3
    });

    expect(projected.hasFallback).toBe(true);
    expect(projected.fallbackPrompt).toBeNull();
  });

  it("summarizes fallback availability without returning accepted answers", () => {
    expect(publicFallbackSummary(checkpoint.fallback, "en")).toEqual({
      hasFallback: true,
      fallbackPrompt: "Fallback question"
    });
  });
});
