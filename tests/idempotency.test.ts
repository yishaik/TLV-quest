import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ClientIdempotencyKeys,
  idempotencyAnswerScope
} from "../lib/idempotency-client";
import { requireIdempotencyKey } from "../lib/http";

const participantRoutes = [
  "answer",
  "hint",
  "location",
  "photo",
  "photo/upload",
  "scan",
  "skip"
].map((route) =>
  readFileSync(`app/api/participants/[token]/${route}/route.ts`, "utf8")
);
const answerSubmission = readFileSync("lib/answer-submission.ts", "utf8");
const repository = readFileSync("lib/repository.ts", "utf8");
const applySubmissionMigration = readFileSync(
  "supabase/migrations/20260730170000_rate_limits_and_answer_cooldown.sql",
  "utf8"
);

describe("participant action idempotency", () => {
  it("reuses a key while the outcome is unknown", () => {
    let sequence = 0;
    const keys = new ClientIdempotencyKeys(() => `uuid-${++sequence}`);

    const first = keys.acquire("answer:port:clock", "web-answer");
    keys.settle("answer:port:clock", first, undefined);
    const retry = keys.acquire("answer:port:clock", "web-answer");
    expect(retry).toBe(first);

    keys.settle("answer:port:clock", retry, 503);
    expect(keys.acquire("answer:port:clock", "web-answer")).toBe(first);
  });

  it("creates a new key only after a definitive response", () => {
    let sequence = 0;
    const keys = new ClientIdempotencyKeys(() => `uuid-${++sequence}`);
    const first = keys.acquire("hint:port", "web-hint");

    keys.settle("hint:port", first, 409);
    const second = keys.acquire("hint:port", "web-hint");

    expect(second).not.toBe(first);
    expect(keys.acquire("hint:port", "web-hint")).toBe(second);
  });

  it("does not let a stale completion release a newer action", () => {
    let sequence = 0;
    const keys = new ClientIdempotencyKeys(() => `uuid-${++sequence}`);
    const first = keys.acquire("location:port", "web-location");
    keys.release("location:port", first);
    const second = keys.acquire("location:port", "web-location");

    keys.release("location:port", first);
    expect(keys.acquire("location:port", "web-location")).toBe(second);
  });

  it("keeps the key when a nominal success response cannot be parsed", () => {
    let sequence = 0;
    const keys = new ClientIdempotencyKeys(() => `uuid-${++sequence}`);
    const first = keys.acquire("photo:port", "web-photo");

    keys.settleError("photo:port", first, { status: 200 });
    expect(keys.acquire("photo:port", "web-photo")).toBe(first);

    const validationKeys = new ClientIdempotencyKeys(
      () => `validation-${++sequence}`
    );
    const invalid = validationKeys.acquire("photo:invalid", "web-photo");
    validationKeys.settleError("photo:invalid", invalid, { status: 415 });
    expect(validationKeys.acquire("photo:invalid", "web-photo")).not.toBe(
      invalid
    );
  });

  it("keeps a shared key until all concurrent requests settle", () => {
    let sequence = 0;
    const keys = new ClientIdempotencyKeys(() => `uuid-${++sequence}`);
    const first = keys.acquire("answer:port:clock", "web-answer");
    const second = keys.acquire("answer:port:clock", "web-answer");

    keys.settle("answer:port:clock", second, 429);
    const third = keys.acquire("answer:port:clock", "web-answer");
    expect(third).toBe(first);

    keys.settle("answer:port:clock", first, 200);
    keys.settle("answer:port:clock", third, 200);
    expect(keys.acquire("answer:port:clock", "web-answer")).not.toBe(first);
  });

  it("normalizes equivalent answer attempts into the same local scope", () => {
    expect(idempotencyAnswerScope("port", "  CLOCK ")).toBe(
      idempotencyAnswerScope("port", "clock")
    );
  });

  it("rejects missing or malformed keys instead of inventing a UUID", () => {
    expect(() =>
      requireIdempotencyKey(new Request("https://example.test"))
    ).toThrow(
      expect.objectContaining({
        status: 400,
        code: "missing_idempotency_key"
      })
    );
    expect(() =>
      requireIdempotencyKey(
        new Request("https://example.test", {
          headers: { "idempotency-key": "too short" }
        })
      )
    ).toThrow(
      expect.objectContaining({
        status: 400,
        code: "invalid_idempotency_key"
      })
    );
    expect(
      requireIdempotencyKey(
        new Request("https://example.test", {
          headers: {
            "idempotency-key":
              " web-answer:123e4567-e89b-42d3-a456-426614174000 "
          }
        })
      )
    ).toBe("web-answer:123e4567-e89b-42d3-a456-426614174000");
  });

  it("requires an explicit key on every participant mutation route", () => {
    for (const route of participantRoutes) {
      expect(route).toContain("requireIdempotencyKey(request)");
      expect(route).not.toContain('headers.get("idempotency-key")');
      expect(route).not.toContain("randomUUID");
    }
  });

  it("does not repeat answer, hint, or delivery side effects on replay", () => {
    expect(answerSubmission).toContain("replayAnswerSubmission");
    expect(answerSubmission).toContain("if (isIdempotencyReplay(result))");
    expect(answerSubmission).toContain(
      "return { evaluation, scoreDelta, result, replayed: false }"
    );
    expect(repository).toContain("replayHintRequest");
    expect(repository).toContain("if (isIdempotencyReplay(result))");
    expect(repository).toContain(
      "return { hint: hintText, penalty, result, replayed: false }"
    );
  });

  it("keeps the database duplicate guard ahead of score mutation", () => {
    const functionStart = applySubmissionMigration.indexOf(
      "create or replace function public.apply_submission"
    );
    const functionBody = applySubmissionMigration.slice(functionStart);
    const teamLock = functionBody.indexOf("for update");
    const duplicateGuard = functionBody.indexOf(
      "where idempotency_key = p_idempotency_key"
    );
    const submissionInsert = functionBody.indexOf(
      "insert into public.submissions"
    );
    const teamUpdate = functionBody.indexOf("update public.teams");

    expect(teamLock).toBeGreaterThan(0);
    expect(duplicateGuard).toBeGreaterThan(teamLock);
    expect(duplicateGuard).toBeLessThan(submissionInsert);
    expect(submissionInsert).toBeLessThan(teamUpdate);
  });
});
