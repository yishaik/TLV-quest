import { describe, expect, it } from "vitest";
import { toPublicCheckpoint } from "@/lib/public-checkpoint";

const checkpoint = {
  id: "checkpoint-1",
  slug: "human-wave",
  sequenceNo: 1,
  kind: "photo",
  content: { he: { prompt: "צרו גל אנושי" } },
  validation: { type: "photo", minParticipants: 3 },
  fallback: {
    he: "צלמו קו גלי שמצאתם בנמל",
    en: "Photograph a wave-like line",
    accepted: ["גל"]
  },
  latitude: null,
  longitude: null,
  radiusMeters: null
} as never;

const options = {
  locale: "he" as const,
  isOptional: false,
  scanVerified: false,
  photoFallbackAvailable: false
};

describe("team-size-aware photo fallback", () => {
  it("opens the alternative immediately for an undersized team", () => {
    const result = toPublicCheckpoint(checkpoint, {
      ...options,
      participantCount: 2
    });
    expect(result.photoFallbackAvailable).toBe(true);
    expect(result.fallbackPrompt).toBe("צלמו קו גלי שמצאתם בנמל");
    expect(result.minimumParticipants).toBe(3);
  });

  it("keeps the alternative locked when the team is large enough", () => {
    const result = toPublicCheckpoint(checkpoint, {
      ...options,
      participantCount: 3
    });
    expect(result.photoFallbackAvailable).toBe(false);
    expect(result.fallbackPrompt).toBeNull();
  });
});
