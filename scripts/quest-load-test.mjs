import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";

const appUrl = (process.env.LOAD_TEST_APP_URL ?? "").replace(/\/$/, "");
const runCode = (process.env.LOAD_TEST_RUN_CODE ?? "").trim().toUpperCase();
const correctAnswer = process.env.LOAD_TEST_ANSWER ?? "";
const participants = Number(process.env.LOAD_TEST_PARTICIPANTS ?? "30");
const teamCount = Number(process.env.LOAD_TEST_TEAMS ?? "10");
const joinBatch = Number(process.env.LOAD_TEST_JOIN_BATCH ?? "5");
const joinWindowMs = Number(process.env.LOAD_TEST_JOIN_WINDOW_MS ?? "61000");

assert(appUrl, "LOAD_TEST_APP_URL is required");
assert(runCode, "LOAD_TEST_RUN_CODE is required");
assert(correctAnswer, "LOAD_TEST_ANSWER is required");
assert.equal(participants, 30, "The production gate requires exactly 30 participants");
assert.equal(teamCount, 10, "The production gate requires exactly 10 teams");
assert.equal(participants % teamCount, 0, "Participants must divide evenly across teams");

const requestJson = async (path, init = {}) => {
  const response = await fetch(`${appUrl}${path}`, init);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
};

const registrations = [];
for (let offset = 0; offset < participants; offset += joinBatch) {
  const batch = Array.from(
    { length: Math.min(joinBatch, participants - offset) },
    (_, index) => offset + index
  );
  const joined = await Promise.all(
    batch.map(async (participantIndex) => {
      const teamIndex = participantIndex % teamCount;
      const { response, payload } = await requestJson(
        `/api/runs/${encodeURIComponent(runCode)}/join`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: `Load Player ${participantIndex + 1}`,
            publicAlias: `Load ${participantIndex + 1}`,
            requestedTeamName: `Load Team ${String(teamIndex + 1).padStart(2, "0")}`,
            language: participantIndex % 2 ? "en" : "he",
            consent: true
          })
        }
      );
      assert.equal(response.status, 201, JSON.stringify(payload));
      assert.equal(payload.ok, true, JSON.stringify(payload));
      return {
        participantId: payload.data.participantId,
        token: payload.data.participantToken,
        teamName: payload.data.teamName
      };
    })
  );
  registrations.push(...joined);
  if (registrations.length < participants) await wait(joinWindowMs);
}

const stateDeadline = Date.now() + 10 * 60_000;
let states = [];
while (Date.now() < stateDeadline) {
  states = await Promise.all(
    registrations.map(async (registration) => {
      const { response, payload } = await requestJson(
        `/api/participants/${encodeURIComponent(registration.token)}/state`
      );
      assert.equal(response.status, 200, JSON.stringify(payload));
      return { registration, state: payload.data };
    })
  );
  if (states.every(({ state }) => state.run.status === "active")) break;
  await wait(5000);
}
assert(states.every(({ state }) => state.run.status === "active"), "Run did not become active");

const teams = new Map();
for (const item of states) {
  const current = teams.get(item.state.team.id) ?? [];
  current.push(item);
  teams.set(item.state.team.id, current);
}
assert.equal(teams.size, teamCount, `Expected ${teamCount} teams`);

const startedAt = performance.now();
const submissionResults = await Promise.all(
  [...teams.entries()].flatMap(([teamId, teamMembers]) => {
    const idempotencyKey = `load-answer:${runCode}:${teamId}`;
    return teamMembers.map(async ({ registration }) => {
      const { response, payload } = await requestJson(
        `/api/participants/${encodeURIComponent(registration.token)}/answer`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey
          },
          body: JSON.stringify({ answer: correctAnswer })
        }
      );
      assert.equal(response.status, 200, JSON.stringify(payload));
      assert.equal(payload.ok, true, JSON.stringify(payload));
      assert.equal(payload.data.evaluation.correct, true, JSON.stringify(payload));
      return payload.data.result;
    });
  })
);
const durationMs = Math.round(performance.now() - startedAt);

const finalStates = await Promise.all(
  [...teams.values()].map(async (members) => {
    const { response, payload } = await requestJson(
      `/api/participants/${encodeURIComponent(members[0].registration.token)}/state`
    );
    assert.equal(response.status, 200, JSON.stringify(payload));
    return payload.data;
  })
);

for (const state of finalStates) {
  assert.equal(
    state.team.completedCount,
    1,
    `Team ${state.team.name} advanced more or less than once`
  );
}

const duplicateCount = submissionResults.filter(
  (result) => result?.duplicate === true
).length;
assert(
  duplicateCount >= participants - teamCount,
  `Expected at least ${participants - teamCount} idempotent duplicates`
);

console.log(
  JSON.stringify(
    {
      runCode,
      participants,
      teams: teams.size,
      concurrentSubmissionDurationMs: durationMs,
      idempotentDuplicates: duplicateCount,
      completedExactlyOnce: finalStates.length
    },
    null,
    2
  )
);

