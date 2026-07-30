import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatCheckpointSkipMessage } from "../lib/checkpoint-messages";

const migration = readFileSync(
  "supabase/migrations/20260730180000_checkpoint_skip_delivery.sql",
  "utf8"
);
const organizerRoute = readFileSync(
  "app/api/organizer/[token]/control/route.ts",
  "utf8"
);
const participantProgression = readFileSync(
  "lib/runtime-progression.ts",
  "utf8"
);
const participantRoute = readFileSync(
  "app/api/participants/[token]/skip/route.ts",
  "utf8"
);
const experienceMeta = readFileSync("lib/experience-meta.ts", "utf8");

describe("transactional checkpoint skipping", () => {
  it("formats localized next-checkpoint and final completion messages", () => {
    const content = {
      he: {
        title: "התחנה הבאה",
        story: "הסיפור ממשיך.",
        prompt: "מצאו את הסמל.",
        locationHint: "ליד המגדל"
      },
      en: {
        title: "Next checkpoint",
        story: "The story continues.",
        prompt: "Find the symbol.",
        locationHint: "By the tower"
      }
    };

    expect(
      formatCheckpointSkipMessage({
        contentValue: content,
        locale: "he",
        sequenceNo: 3,
        resumeLink: "https://example.test/resume"
      })
    ).toContain("תחנה 3 — התחנה הבאה");
    expect(
      formatCheckpointSkipMessage({
        contentValue: content,
        locale: "en",
        sequenceNo: 3,
        resumeLink: "https://example.test/resume"
      })
    ).toContain("Checkpoint 3 — Next checkpoint");
    expect(
      formatCheckpointSkipMessage({
        locale: "he",
        resumeLink: "https://example.test/results",
        finished: true
      })
    ).toContain("המסלול הושלם");
    expect(
      formatCheckpointSkipMessage({
        locale: "en",
        resumeLink: "https://example.test/results",
        finished: true
      })
    ).toContain("route is complete");
  });

  it("commits progression, outbox rows, and a typed event in one RPC", () => {
    const functionStart = migration.indexOf(
      "create or replace function public.progress_checkpoint_skip"
    );
    const functionBody = migration.slice(functionStart);
    const duplicateGuard = functionBody.indexOf(
      "where idempotency_key = p_idempotency_key"
    );
    const teamUpdate = functionBody.indexOf("update public.teams");
    const outboxInsert = functionBody.indexOf(
      "insert into public.message_outbox"
    );
    const eventInsert = functionBody.indexOf("insert into public.game_events");

    expect(functionBody).toContain("for update");
    expect(duplicateGuard).toBeGreaterThan(0);
    expect(duplicateGuard).toBeLessThan(teamUpdate);
    expect(teamUpdate).toBeLessThan(outboxInsert);
    expect(outboxInsert).toBeLessThan(eventInsert);
    expect(functionBody).toContain("'ORGANIZER_CHECKPOINT_SKIPPED'");
    expect(functionBody).toContain("'OPTIONAL_CHECKPOINT_SKIPPED'");
    expect(functionBody).toContain("'previousCheckpointSlug'");
    expect(functionBody).toContain("'nextCheckpointSlug'");
    expect(functionBody).toContain("'outcome'");
  });

  it("queues only connected teammates and handles the final checkpoint", () => {
    expect(migration).toContain(
      "participant.whatsapp_connected_at is not null"
    );
    expect(migration).toContain(
      "participant.id is distinct from p_actor_participant_id"
    );
    expect(migration).toContain("'checkpoint_skip_completed'");
    expect(migration).toContain("'checkpoint_skip_transition'");
    expect(migration).toContain(
      "private.format_checkpoint_skip_message"
    );
    expect(participantRoute).toContain("processOutbox");
  });

  it("routes organizer and participant skips through the same service", () => {
    expect(organizerRoute).toContain("skipCheckpointForTeam");
    expect(participantProgression).toContain("skipCheckpointForTeam");
    expect(migration).toContain(
      "return public.progress_checkpoint_skip"
    );
    expect(organizerRoute).not.toContain(
      "current_checkpoint_slug: next?.slug"
    );
  });

  it("makes multi-team failures observable and safely retryable", () => {
    expect(organizerRoute).toContain("Promise.all");
    expect(organizerRoute).toContain("failures");
    expect(organizerRoute).toContain('status: skip?.failures.length ? "partial"');
    expect(organizerRoute).toContain('"idempotency-key"');
    expect(migration).toContain(
      "return jsonb_build_object('duplicate', true)"
    );
  });

  it("emits safe Realtime activity without mission content", () => {
    const resultStart = migration.indexOf("v_result := jsonb_build_object(");
    const eventInsert = migration.indexOf(
      "insert into public.game_events",
      resultStart
    );
    const eventPayload = migration.slice(resultStart, eventInsert);

    expect(eventPayload).not.toContain("'body'");
    expect(eventPayload).not.toContain("'content'");
    expect(experienceMeta).toContain("ORGANIZER_CHECKPOINT_SKIPPED");
  });

  it("keeps all progression functions service-role-only", () => {
    expect(migration).toContain(
      "from public, anon, authenticated"
    );
    expect(migration).toContain("to service_role");
  });
});
