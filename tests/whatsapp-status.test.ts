import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatWhatsappRunStatus,
  parseWhatsappCommand,
  resolveWhatsappContextCandidates,
  type WhatsappGameContext,
  type WhatsappRunStatus,
  type WhatsappTeamStatus
} from "../lib/whatsapp-status";

const migration = readFileSync(
  "supabase/migrations/20260730190000_whatsapp_context_resolver.sql",
  "utf8"
);
const repository = readFileSync("lib/repository.ts", "utf8");
const whatsappRoute = readFileSync(
  "app/api/twilio/whatsapp/route.ts",
  "utf8"
);

const makeContext = ({
  code = "RUN123",
  runStatus = "active",
  teamStatus = "solving",
  joinedAt = "2026-07-30T10:00:00.000Z",
  runFinishedAt = null,
  teamFinishedAt = null,
  retentionUntil = "2026-08-02T10:00:00.000Z",
  checkpoint = true
}: {
  code?: string;
  runStatus?: WhatsappRunStatus;
  teamStatus?: WhatsappTeamStatus;
  joinedAt?: string;
  runFinishedAt?: string | null;
  teamFinishedAt?: string | null;
  retentionUntil?: string | null;
  checkpoint?: boolean;
} = {}): WhatsappGameContext => ({
  joined_at: joinedAt,
  participant: {
    id: `participant-${code}`,
    language: "he"
  },
  run: {
    id: `run-${code}`,
    public_code: code,
    status: runStatus,
    scheduled_at: "2026-07-30T18:00:00.000Z",
    started_at: runStatus === "draft" ? null : "2026-07-30T10:05:00.000Z",
    finished_at: runFinishedAt,
    retention_until: retentionUntil
  },
  team: {
    id: `team-${code}`,
    status: teamStatus,
    current_checkpoint_slug: checkpoint ? "lighthouse" : null,
    score: 125,
    completed_count: checkpoint ? 2 : 3,
    wrong_attempts: 0,
    hints_used: 1,
    started_at: "2026-07-30T10:05:00.000Z",
    finished_at: teamFinishedAt,
    last_progress_at: "2026-07-30T10:20:00.000Z"
  },
  checkpoint_count: 3,
  checkpoint: checkpoint
    ? {
        id: `checkpoint-${code}`,
        slug: "lighthouse",
        sequence_no: 3,
        kind: "text",
        content: {
          he: {
            title: "האור האחרון",
            story: "הסיפור ממשיך.",
            prompt: "מצאו את האות.",
            locationHint: "ליד המגדלור"
          },
          en: {
            title: "The final light",
            prompt: "Find the signal."
          }
        },
        validation: { type: "text", accepted: ["אור"] },
        hints: [],
        scoring: {},
        fallback_checkpoint: null,
        latitude: null,
        longitude: null,
        radius_meters: null
      }
    : null
});

describe("WhatsApp run-state resolution", () => {
  it("recognizes all supported status spellings and an explicit run selector", () => {
    expect(parseWhatsappCommand("status")).toEqual({ command: "status" });
    expect(parseWhatsappCommand("/status")).toEqual({ command: "status" });
    expect(parseWhatsappCommand("סטטוס")).toEqual({ command: "status" });
    expect(parseWhatsappCommand("  סטטוס   9sXsz6  ")).toEqual({
      command: "status",
      requestedRunCode: "9SXSZ6"
    });
  });

  it("prefers live, retained finished, and not-started registrations in order", () => {
    const ready = makeContext({
      code: "READY1",
      runStatus: "ready",
      teamStatus: "waiting",
      joinedAt: "2026-07-30T12:00:00.000Z"
    });
    const finished = makeContext({
      code: "DONE01",
      runStatus: "finished",
      teamStatus: "finished",
      joinedAt: "2026-07-30T09:00:00.000Z",
      runFinishedAt: "2026-07-30T10:30:00.000Z",
      teamFinishedAt: "2026-07-30T10:29:00.000Z",
      checkpoint: false
    });
    const paused = makeContext({
      code: "PAUSE1",
      runStatus: "paused",
      joinedAt: "2026-07-30T08:00:00.000Z"
    });

    expect(
      resolveWhatsappContextCandidates([ready, finished, paused], {
        now: new Date("2026-07-30T13:00:00.000Z")
      })
    ).toMatchObject({
      kind: "resolved",
      context: { run: { public_code: "PAUSE1" } }
    });
    expect(
      resolveWhatsappContextCandidates([ready, finished], {
        now: new Date("2026-07-30T13:00:00.000Z")
      })
    ).toMatchObject({
      kind: "resolved",
      context: { run: { public_code: "DONE01" } }
    });
    expect(
      resolveWhatsappContextCandidates(
        [
          ready,
          {
            ...finished,
            run: {
              ...finished.run,
              retention_until: "2026-07-30T11:00:00.000Z"
            }
          }
        ],
        { now: new Date("2026-07-30T13:00:00.000Z") }
      )
    ).toMatchObject({
      kind: "resolved",
      context: { run: { public_code: "READY1" } }
    });
  });

  it("never guesses between live registrations and accepts a safe public code", () => {
    const active = makeContext({ code: "LIVE01" });
    const paused = makeContext({
      code: "LIVE02",
      runStatus: "paused",
      joinedAt: "2026-07-30T11:00:00.000Z"
    });

    expect(resolveWhatsappContextCandidates([active, paused])).toEqual({
      kind: "ambiguous",
      locale: "he",
      runCodes: ["LIVE01", "LIVE02"]
    });
    expect(
      resolveWhatsappContextCandidates([active, paused], {
        requestedRunCode: "live01"
      })
    ).toMatchObject({
      kind: "resolved",
      context: { run: { public_code: "LIVE01" } }
    });
    expect(
      resolveWhatsappContextCandidates(
        [
          makeContext({
            code: "OLD001",
            runStatus: "finished",
            teamStatus: "finished",
            runFinishedAt: "2026-07-20T10:00:00.000Z",
            retentionUntil: "2026-07-23T10:00:00.000Z",
            checkpoint: false
          })
        ],
        {
          requestedRunCode: "OLD001",
          now: new Date("2026-07-30T10:00:00.000Z")
        }
      )
    ).toEqual({ kind: "none", requestedRunCode: "OLD001" });
  });

  it.each(["draft", "registration_open", "ready"] as WhatsappRunStatus[])(
    "reports %s as not started with organizer guidance",
    (runStatus) => {
      const message = formatWhatsappRunStatus({
        context: makeContext({
          runStatus,
          teamStatus: "waiting",
          checkpoint: false
        }),
        resumeLink: "https://example.test/resume"
      });
      expect(message).toContain("עדיין לא התחיל");
      expect(message).toContain("המארגן");
      expect(message).toContain("https://example.test/resume");
    }
  );

  it("reports active score, progress, checkpoint, and web link", () => {
    const message = formatWhatsappRunStatus({
      context: makeContext(),
      resumeLink: "https://example.test/resume"
    });
    expect(message).toContain("המשחק פעיל");
    expect(message).toContain("ניקוד: 125");
    expect(message).toContain("התקדמות: 2/3");
    expect(message).toContain("תחנה 3 — האור האחרון");
    expect(message).toContain("https://example.test/resume");
  });

  it("reports paused state while preserving the current checkpoint", () => {
    const message = formatWhatsappRunStatus({
      context: makeContext({ runStatus: "paused" }),
      resumeLink: "https://example.test/resume"
    });
    expect(message).toContain("מושהה");
    expect(message).toContain("התחנה הנוכחית נשמרה");
    expect(message).toContain("האור האחרון");
  });

  it("reports team completion before run completion and final-skip completion", () => {
    const teamFinished = formatWhatsappRunStatus({
      context: makeContext({
        runStatus: "active",
        teamStatus: "finished",
        teamFinishedAt: "2026-07-30T10:23:20.000Z",
        checkpoint: false
      }),
      resumeLink: "https://example.test/results"
    });
    const finalSkip = formatWhatsappRunStatus({
      context: makeContext({
        runStatus: "finished",
        teamStatus: "finished",
        runFinishedAt: "2026-07-30T10:23:20.000Z",
        teamFinishedAt: "2026-07-30T10:23:20.000Z",
        checkpoint: false
      }),
      resumeLink: "https://example.test/results"
    });
    expect(teamFinished).toContain("המסלול הושלם");
    expect(finalSkip).toContain("המסלול הושלם");
    expect(teamFinished).not.toContain("לא התחיל");
    expect(finalSkip).not.toContain("לא התחיל");
  });

  it("reports cancelled runs with organizer guidance", () => {
    const message = formatWhatsappRunStatus({
      context: makeContext({
        runStatus: "cancelled",
        teamStatus: "waiting",
        checkpoint: false
      }),
      resumeLink: "https://example.test/resume"
    });
    expect(message).toContain("בוטל");
    expect(message).toContain("למארגן");
  });

  it("fetches participant, run, team, and checkpoint in one service-only RPC", () => {
    expect(migration).toContain(
      "create or replace function public.get_whatsapp_game_contexts"
    );
    expect(migration).toContain("join public.game_runs");
    expect(migration).toContain("left join public.teams");
    expect(migration).toContain("left join public.run_checkpoints");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
    expect(repository).toContain('.rpc("get_whatsapp_game_contexts"');
    expect(repository).toContain("ambiguous_whatsapp_context");
    expect(whatsappRoute).toContain("Multiple live games were found");
  });
});
