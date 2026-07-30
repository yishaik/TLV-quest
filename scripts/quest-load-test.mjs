import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { setTimeout as wait } from "node:timers/promises";

const CONTROLLED_CONFLICT_CODES = new Set([
  "checkpoint_locked",
  "conflict",
  "team_not_active"
]);

const integerEnv = (env, name, fallback) => {
  const value = Number(env[name] ?? fallback);
  assert(
    Number.isSafeInteger(value),
    `${name} must be a safe integer, received ${env[name]}`
  );
  return value;
};

const normalizedAppUrl = (env) => {
  const raw = (env.LOAD_TEST_APP_URL ?? "").trim().replace(/\/$/, "");
  assert(raw, "LOAD_TEST_APP_URL is required");
  const url = new URL(raw);
  const allowHttp = env.LOAD_TEST_ALLOW_HTTP === "true";
  assert(
    url.protocol === "https:" || (allowHttp && url.protocol === "http:"),
    "LOAD_TEST_APP_URL must use HTTPS"
  );
  assert(!url.username && !url.password, "LOAD_TEST_APP_URL cannot contain credentials");
  assert(
    url.pathname === "/" && !url.search && !url.hash,
    "LOAD_TEST_APP_URL must be an origin without a path, query, or fragment"
  );

  const productionHosts = new Set(["play.yishaik.com", "tlv-quest.vercel.app"]);
  assert(
    env.LOAD_TEST_ALLOW_PRODUCTION === "true" ||
      !productionHosts.has(url.hostname.toLowerCase()),
    "Refusing to load-test production without LOAD_TEST_ALLOW_PRODUCTION=true"
  );
  return url.origin;
};

export const readLoadGateConfig = (env = process.env) => {
  const participants = integerEnv(env, "LOAD_TEST_PARTICIPANTS", "30");
  const teamCount = integerEnv(env, "LOAD_TEST_TEAMS", "10");
  const joinBatch = integerEnv(env, "LOAD_TEST_JOIN_BATCH", "5");
  const joinWindowMs = integerEnv(env, "LOAD_TEST_JOIN_WINDOW_MS", "61000");
  const requestTimeoutMs = integerEnv(
    env,
    "LOAD_TEST_REQUEST_TIMEOUT_MS",
    "30000"
  );
  const runCode = (env.LOAD_TEST_RUN_CODE ?? "").trim().toUpperCase();
  const correctAnswer = env.LOAD_TEST_ANSWER ?? "";
  const teamPrefix = (env.LOAD_TEST_TEAM_PREFIX ?? "P0 Load Team").trim();

  assert.equal(participants, 30, "The production gate requires exactly 30 participants");
  assert.equal(teamCount, 10, "The production gate requires exactly 10 teams");
  assert.equal(
    participants % teamCount,
    0,
    "Participants must divide evenly across teams"
  );
  assert(
    Number.isInteger(joinBatch) && joinBatch >= 1 && joinBatch <= 5,
    "LOAD_TEST_JOIN_BATCH must be between 1 and 5"
  );
  assert(joinWindowMs >= 0, "LOAD_TEST_JOIN_WINDOW_MS cannot be negative");
  assert(requestTimeoutMs >= 1_000, "LOAD_TEST_REQUEST_TIMEOUT_MS is too small");
  assert(/^[A-Z0-9]{6}$/.test(runCode), "LOAD_TEST_RUN_CODE must be six letters or digits");
  assert(correctAnswer.trim(), "LOAD_TEST_ANSWER is required");
  assert(teamPrefix, "LOAD_TEST_TEAM_PREFIX is required");

  return {
    appUrl: normalizedAppUrl(env),
    runCode,
    correctAnswer,
    participants,
    teamCount,
    joinBatch,
    joinWindowMs,
    requestTimeoutMs,
    teamPrefix,
    cookieFile: env.LOAD_TEST_COOKIE_FILE?.trim() || null,
    resultPath: env.LOAD_TEST_RESULT_PATH?.trim() || null
  };
};

export const readCookieHeader = async (cookieFile) => {
  if (!cookieFile) return null;
  const contents = await readFile(cookieFile, "utf8");
  const cookies = contents
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.trim() &&
        (!line.startsWith("#") || line.startsWith("#HttpOnly_"))
    )
    .map((line) => line.split("\t"))
    .filter((fields) => fields.length >= 7)
    .map((fields) => `${fields[5]}=${fields[6]}`);
  assert(cookies.length, "LOAD_TEST_COOKIE_FILE contains no cookies");
  return cookies.join("; ");
};

const responseError = ({ method, path, response, rawBody }) =>
  `${method} ${path} returned HTTP ${response.status} ` +
  `${response.headers.get("content-type") ?? "without content-type"}: ` +
  rawBody.slice(0, 300);

const requestJson = async ({
  fetchImpl,
  appUrl,
  requestTimeoutMs,
  path,
  authHeaders = {},
  init = {}
}) => {
  const method = init.method ?? "GET";
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(authHeaders)) {
    headers.set(name, value);
  }
  const response = await fetchImpl(`${appUrl}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  const rawBody = await response.text();
  let payload;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw new Error(responseError({ method, path, response, rawBody }));
  }
  return { response, payload, rawBody };
};

export const classifySubmission = ({ response, payload }) => {
  if (response.status === 200) {
    assert.equal(payload?.ok, true, JSON.stringify(payload));
    assert.equal(payload?.data?.evaluation?.correct, true, JSON.stringify(payload));
    assert.equal(payload?.data?.result?.duplicate, false, JSON.stringify(payload));
    return "accepted";
  }

  if (response.status === 409) {
    const code = payload?.error?.details?.code;
    assert(
      CONTROLLED_CONFLICT_CODES.has(code),
      `Unexpected concurrency conflict: ${JSON.stringify(payload)}`
    );
    return "controlled_conflict";
  }

  throw new Error(
    `Submission returned unexpected HTTP ${response.status}: ${JSON.stringify(payload)}`
  );
};

const teamName = (prefix, teamIndex) =>
  `${prefix} ${String(teamIndex + 1).padStart(2, "0")}`;

export const summarizeTeamOutcomes = ({
  submissions,
  participantsPerTeam,
  expectedTeams
}) => {
  const byTeam = new Map();
  for (const submission of submissions) {
    const current = byTeam.get(submission.teamId) ?? {
      accepted: [],
      controlledConflicts: []
    };
    if (submission.outcome === "accepted") current.accepted.push(submission);
    else current.controlledConflicts.push(submission);
    byTeam.set(submission.teamId, current);
  }

  assert.equal(byTeam.size, expectedTeams, `Expected ${expectedTeams} result groups`);
  for (const [teamId, outcome] of byTeam) {
    assert.equal(
      outcome.accepted.length,
      1,
      `Team ${teamId} must have exactly one accepted concurrent answer`
    );
    assert.equal(
      outcome.controlledConflicts.length,
      participantsPerTeam - 1,
      `Team ${teamId} must reject every stale concurrent answer`
    );
  }
  return byTeam;
};

export const runLoadGate = async ({
  env = process.env,
  fetchImpl = fetch,
  waitImpl = wait
} = {}) => {
  const config = readLoadGateConfig(env);
  const participantsPerTeam = config.participants / config.teamCount;
  const registrations = [];
  const cookie = await readCookieHeader(config.cookieFile);
  const authHeaders = cookie ? { cookie } : {};

  for (let offset = 0; offset < config.participants; offset += config.joinBatch) {
    const batch = Array.from(
      {
        length: Math.min(config.joinBatch, config.participants - offset)
      },
      (_, index) => offset + index
    );
    const joined = await Promise.all(
      batch.map(async (participantIndex) => {
        const teamIndex = participantIndex % config.teamCount;
        const path = `/api/runs/${encodeURIComponent(config.runCode)}/join`;
        const { response, payload, rawBody } = await requestJson({
          fetchImpl,
          appUrl: config.appUrl,
          requestTimeoutMs: config.requestTimeoutMs,
          path,
          authHeaders,
          init: {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              firstName: `P0 Load Player ${participantIndex + 1}`,
              publicAlias: `P0 Load ${participantIndex + 1}`,
              requestedTeamName: teamName(config.teamPrefix, teamIndex),
              language: participantIndex % 2 ? "en" : "he",
              consent: true
            })
          }
        });
        assert.equal(
          response.status,
          201,
          responseError({ method: "POST", path, response, rawBody })
        );
        assert.equal(payload.ok, true, JSON.stringify(payload));
        return {
          participantIndex,
          participantId: payload.data.participantId,
          token: payload.data.participantToken,
          teamName: payload.data.teamName
        };
      })
    );
    registrations.push(...joined);
    if (registrations.length < config.participants) {
      await waitImpl(config.joinWindowMs);
    }
  }

  assert.equal(registrations.length, config.participants);
  for (let teamIndex = 0; teamIndex < config.teamCount; teamIndex += 1) {
    assert.equal(
      registrations.filter(
        (registration) =>
          registration.teamName === teamName(config.teamPrefix, teamIndex)
      ).length,
      participantsPerTeam,
      `Unexpected membership for ${teamName(config.teamPrefix, teamIndex)}`
    );
  }

  const states = await Promise.all(
    registrations.map(async (registration) => {
      const path =
        `/api/participants/${encodeURIComponent(registration.token)}/state`;
      const { response, payload, rawBody } = await requestJson({
        fetchImpl,
        appUrl: config.appUrl,
        requestTimeoutMs: config.requestTimeoutMs,
        path,
        authHeaders
      });
      assert.equal(
        response.status,
        200,
        responseError({ method: "GET", path, response, rawBody })
      );
      assert.equal(payload.ok, true, JSON.stringify(payload));
      assert.equal(payload.data.run.status, "active", JSON.stringify(payload));
      assert(payload.data.checkpoint, "Every participant must have an active checkpoint");
      return { registration, state: payload.data };
    })
  );

  const teams = new Map();
  for (const item of states) {
    const current = teams.get(item.state.team.id) ?? [];
    current.push(item);
    teams.set(item.state.team.id, current);
  }
  assert.equal(teams.size, config.teamCount, `Expected ${config.teamCount} teams`);
  for (const members of teams.values()) {
    assert.equal(members.length, participantsPerTeam);
  }

  const startedAt = performance.now();
  const submissions = await Promise.all(
    [...teams.entries()].flatMap(([teamId, teamMembers]) =>
      teamMembers.map(async ({ registration }) => {
        const idempotencyKey =
          `load-answer:${config.runCode}:${registration.participantId}`;
        const path =
          `/api/participants/${encodeURIComponent(registration.token)}/answer`;
        const result = await requestJson({
          fetchImpl,
          appUrl: config.appUrl,
          requestTimeoutMs: config.requestTimeoutMs,
          path,
          authHeaders,
          init: {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": idempotencyKey
            },
            body: JSON.stringify({ answer: config.correctAnswer })
          }
        });
        return {
          teamId,
          registration,
          idempotencyKey,
          outcome: classifySubmission(result),
          payload: result.payload
        };
      })
    )
  );
  const concurrentSubmissionDurationMs = Math.round(
    performance.now() - startedAt
  );
  const outcomes = summarizeTeamOutcomes({
    submissions,
    participantsPerTeam,
    expectedTeams: config.teamCount
  });

  const replayResults = await Promise.all(
    [...outcomes.values()].map(async ({ accepted }) => {
      const winner = accepted[0];
      const path =
        `/api/participants/${encodeURIComponent(winner.registration.token)}/answer`;
      const { response, payload, rawBody } = await requestJson({
        fetchImpl,
        appUrl: config.appUrl,
        requestTimeoutMs: config.requestTimeoutMs,
        path,
        authHeaders,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": winner.idempotencyKey
          },
          body: JSON.stringify({ answer: config.correctAnswer })
        }
      });
      assert.equal(
        response.status,
        200,
        responseError({ method: "POST", path, response, rawBody })
      );
      assert.equal(payload.ok, true, JSON.stringify(payload));
      assert.equal(payload.data.result.duplicate, true, JSON.stringify(payload));
      assert.equal(payload.data.replayed, true, JSON.stringify(payload));
      return payload.data;
    })
  );

  const finalStates = await Promise.all(
    [...teams.values()].map(async (members) => {
      const representative = members[0].registration;
      const path =
        `/api/participants/${encodeURIComponent(representative.token)}/state`;
      const { response, payload, rawBody } = await requestJson({
        fetchImpl,
        appUrl: config.appUrl,
        requestTimeoutMs: config.requestTimeoutMs,
        path,
        authHeaders
      });
      assert.equal(
        response.status,
        200,
        responseError({ method: "GET", path, response, rawBody })
      );
      assert.equal(payload.ok, true, JSON.stringify(payload));
      return payload.data;
    })
  );

  for (const state of finalStates) {
    assert.equal(
      state.team.completedCount,
      1,
      `Team ${state.team.name} advanced more or less than once`
    );
    assert.equal(state.team.score, 100, `Team ${state.team.name} scored incorrectly`);
    assert.equal(state.team.status, "finished", `Team ${state.team.name} did not finish`);
  }

  const result = {
    runCode: config.runCode,
    targetOrigin: config.appUrl,
    participants: config.participants,
    teams: teams.size,
    participantsPerTeam,
    concurrentSubmissionDurationMs,
    acceptedAnswers: submissions.filter(
      (submission) => submission.outcome === "accepted"
    ).length,
    controlledRaceConflicts: submissions.filter(
      (submission) => submission.outcome === "controlled_conflict"
    ).length,
    idempotentWinnerReplays: replayResults.length,
    completedExactlyOnce: finalStates.length,
    finishedAt: new Date().toISOString()
  };

  if (config.resultPath) {
    await writeFile(config.resultPath, `${JSON.stringify(result, null, 2)}\n`, {
      mode: 0o600
    });
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
};

const isEntrypoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  runLoadGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
