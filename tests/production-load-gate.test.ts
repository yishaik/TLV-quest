import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The production runner intentionally stays dependency-free Node ESM.
// @ts-expect-error The runtime .mjs module does not ship TypeScript declarations.
import * as loadGate from "../scripts/quest-load-test.mjs";

const {
  classifySubmission,
  readLoadGateConfig,
  summarizeTeamOutcomes
} = loadGate;

const response = (status: number) => ({
  status
});

const runDeletionMigration = readFileSync(
  "supabase/migrations/20260730210000_allow_game_run_deletion.sql",
  "utf8"
);
const parentDeleteGuardMigration = readFileSync(
  "supabase/migrations/20260730211000_guard_realtime_event_parent_deletes.sql",
  "utf8"
);

describe("production-like load gate", () => {
  it("requires the exact release gate size and refuses production by default", () => {
    const common = {
      LOAD_TEST_APP_URL: "https://preview.example.test",
      LOAD_TEST_RUN_CODE: "LOAD30",
      LOAD_TEST_ANSWER: "expected",
      LOAD_TEST_PARTICIPANTS: "30",
      LOAD_TEST_TEAMS: "10"
    };

    expect(readLoadGateConfig(common)).toMatchObject({
      participants: 30,
      teamCount: 10,
      appUrl: "https://preview.example.test"
    });
    expect(() =>
      readLoadGateConfig({ ...common, LOAD_TEST_PARTICIPANTS: "29" })
    ).toThrow("exactly 30 participants");
    expect(() =>
      readLoadGateConfig({
        ...common,
        LOAD_TEST_APP_URL: "https://play.yishaik.com"
      })
    ).toThrow("Refusing to load-test production");
  });

  it("accepts one winner and controlled stale conflicts per team", () => {
    const accepted = classifySubmission({
      response: response(200),
      payload: {
        ok: true,
        data: {
          evaluation: { correct: true },
          result: { duplicate: false }
        }
      }
    });
    const conflict = classifySubmission({
      response: response(409),
      payload: { error: { details: { code: "checkpoint_locked" } } }
    });

    expect(accepted).toBe("accepted");
    expect(conflict).toBe("controlled_conflict");
    expect(() =>
      classifySubmission({
        response: response(429),
        payload: { error: { details: { code: "rate_limited" } } }
      })
    ).toThrow("unexpected HTTP 429");

    const outcomes = summarizeTeamOutcomes({
      submissions: [
        { teamId: "team-1", outcome: accepted },
        { teamId: "team-1", outcome: conflict },
        { teamId: "team-1", outcome: conflict }
      ],
      participantsPerTeam: 3,
      expectedTeams: 1
    });
    expect(outcomes.get("team-1").accepted).toHaveLength(1);
    expect(outcomes.get("team-1").controlledConflicts).toHaveLength(2);
  });

  it("does not emit a child realtime event after its run is deleted", () => {
    const deleteGuard = runDeletionMigration.indexOf("if tg_op = 'DELETE'");
    const emit = runDeletionMigration.indexOf(
      "perform public.quest_emit_realtime_event"
    );
    expect(deleteGuard).toBeGreaterThan(-1);
    expect(deleteGuard).toBeLessThan(emit);
    expect(runDeletionMigration).toContain(
      "after insert or update on public.game_runs"
    );
    expect(runDeletionMigration).not.toContain(
      "after insert or update or delete on public.game_runs"
    );

    const parentGuard = parentDeleteGuardMigration.indexOf(
      "if not exists ("
    );
    const eventInsert = parentDeleteGuardMigration.indexOf(
      "insert into public.quest_realtime_events"
    );
    expect(parentGuard).toBeGreaterThan(-1);
    expect(parentGuard).toBeLessThan(eventInsert);
    expect(parentDeleteGuardMigration).toContain("v_team_id := null");
  });
});
