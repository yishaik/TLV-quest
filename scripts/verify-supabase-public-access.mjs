const serviceOnlyTables = [
  "admin_allowlist",
  "anonymous_run_metrics",
  "checkpoint_health",
  "content_audit_log",
  "content_riddles",
  "content_route_stops",
  "content_stations",
  "game_events",
  "game_runs",
  "game_templates",
  "marketing_leads",
  "media_assets",
  "message_outbox",
  "organizer_invites",
  "participants",
  "photo_uploads",
  "rate_limit_buckets",
  "realtime_participant_authorizations",
  "run_checkpoints",
  "submissions",
  "teams",
  "template_checkpoints",
  "template_versions"
];

const anonDeniedRealtimeTables = [
  "quest_realtime_events",
  "quest_presence"
];

const required = (names) => {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required environment variable: ${names.join(" or ")}`);
};

const supabaseUrl = required([
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL"
]).replace(/\/+$/, "");
const publishableKey = required([
  "SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
]);

const probe = async (table) => {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/${table}?select=*&limit=1`,
        {
          headers: {
            apikey: publishableKey,
            authorization: `Bearer ${publishableKey}`
          },
          signal: AbortSignal.timeout(20_000)
        }
      );
      const body = await response.text();
      return { table, status: response.status, body };
    } catch (cause) {
      if (attempt === 2) {
        throw new Error(
          `${table} request failed: ${
            cause instanceof Error ? cause.message : "unknown network error"
          }`
        );
      }
    }
  }
  throw new Error(`${table} request failed`);
};

const parseRows = ({ table, body }) => {
  try {
    const parsed = JSON.parse(body);
    if (!Array.isArray(parsed)) {
      throw new Error("response is not an array");
    }
    return parsed;
  } catch (cause) {
    throw new Error(
      `${table} returned invalid JSON: ${
        cause instanceof Error ? cause.message : "unknown parse error"
      }`
    );
  }
};

const failures = [];
const deniedTables = [
  ...serviceOnlyTables,
  ...anonDeniedRealtimeTables
];

const probeAll = async (tables, concurrency = 5) => {
  const results = new Array(tables.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < tables.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await probe(tables[index]);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, tables.length) },
      worker
    )
  );
  return results;
};

const deniedResults = await probeAll(deniedTables);

for (const result of deniedResults) {
  const { table } = result;
  if (result.status === 401 || result.status === 403) {
    console.log(`${table}: ${result.body} [HTTP ${result.status}]`);
    continue;
  }

  if (result.status === 200) {
    const rows = parseRows(result);
    if (rows.length === 0) {
      console.log(`${table}: [] [HTTP 200]`);
      continue;
    }
    console.log(`${table}: [REDACTED ${rows.length} ROW(S)] [HTTP 200]`);
    failures.push(`${table} exposed rows to anon`);
    continue;
  }

  console.log(`${table}: ${result.body} [HTTP ${result.status}]`);
  failures.push(`${table} returned unexpected HTTP ${result.status}`);
}

const leaderboard = await probe("leaderboard_entries");
if (leaderboard.status !== 200) {
  console.log(
    `leaderboard_entries: ${leaderboard.body} [HTTP ${leaderboard.status}]`
  );
  failures.push(
    `leaderboard_entries returned HTTP ${leaderboard.status}, expected 200`
  );
} else {
  const rows = parseRows(leaderboard);
  console.log(
    `leaderboard_entries: ${JSON.stringify(rows)} [HTTP 200]`
  );
}

if (failures.length > 0) {
  throw new Error(
    `Supabase browser-role verification failed:\n- ${failures.join("\n- ")}`
  );
}

console.log(
  `Supabase browser-role verification passed for ${
    deniedTables.length + 1
  } tables.`
);
