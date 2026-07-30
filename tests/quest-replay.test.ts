import { describe, expect, it } from "vitest";
import {
  buildQuestReplay,
  sortReplayEvents,
  type ReplayEvent
} from "../lib/quest-replay";

const event = (
  id: string,
  eventType: string,
  overrides: Partial<ReplayEvent> = {}
): ReplayEvent => ({
  id,
  eventType,
  teamId: "team-1",
  participantId: null,
  actorName: null,
  checkpointSlug: "dock",
  scoreDelta: 0,
  penalty: 0,
  createdAt: "2026-07-30T10:00:00.000Z",
  payload: {},
  ...overrides
});

describe("deterministic quest replay", () => {
  it("uses the event identity as a deterministic timestamp tie-breaker", () => {
    expect(
      sortReplayEvents([
        event("12", "ANSWER_ACCEPTED"),
        event("2", "RUN_STARTED")
      ]).map((item) => item.id)
    ).toEqual(["2", "12"]);
  });

  it("reconstructs scores and team progression without mutable input state", () => {
    const source = [
      event("1", "RUN_STARTED"),
      event("2", "ANSWER_REJECTED", { scoreDelta: -5 }),
      event("3", "HINT_REQUESTED", { penalty: 10 }),
      event("4", "ANSWER_ACCEPTED", { scoreDelta: 100 })
    ];
    const frames = buildQuestReplay({
      teams: [{ id: "team-1", name: "Signal Keepers" }],
      events: source
    });
    expect(frames.at(-1)?.teams[0]).toMatchObject({
      score: 100,
      completedCount: 1,
      status: "travelling",
      wrongAttempts: 0,
      hintsUsed: 0
    });
    expect(source[0].eventType).toBe("RUN_STARTED");
  });
});
