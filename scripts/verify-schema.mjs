#!/usr/bin/env node
// Schema gate.
//
// Builds the database from `supabase/migrations/` alone, then asserts that
// every table and RPC the application actually references exists in the
// result. Without this, application code can be merged against objects that
// only exist in the live project, which is exactly how `main` came to ship
// bulk import, recap sharing, the epilogue, translation and route generation
// against tables no migration in this repository creates.
//
//   npm run verify:schema
//
// By default the gate manages its own throwaway `supabase/postgres` container.
// Set SCHEMA_GATE_PSQL to a psql command prefix to run against a database you
// manage yourself, e.g.
//
//   SCHEMA_GATE_PSQL='psql -h 127.0.0.1 -p 5432 -U postgres -d postgres' \
//     node scripts/verify-schema.mjs
//
// See docs/schema-integrity.md.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const IMAGE = process.env.SCHEMA_GATE_IMAGE ?? "supabase/postgres:17.6.1.005";
const CONTAINER = "tlv-quest-schema-gate";
const MIGRATIONS_DIR = "supabase/migrations";
const BOOTSTRAP = "scripts/schema-gate-bootstrap.sql";
const SOURCE_DIRS = ["app", "lib", "components", "scripts"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js"]);

// Supabase's PostgREST client also exposes `.from()` on the storage client,
// where the argument is a bucket name rather than a table. Bucket names in
// this project are hyphenated, so requiring snake_case keeps them out. The
// same filter drops `Array.from("...")` and friends.
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

const FROM_CALL = /\.from\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
const RPC_CALL = /\.rpc\(\s*["'`]([^"'`]+)["'`]/g;

const log = (message) => process.stdout.write(`${message}\n`);

const run = (command, args, options = {}) =>
  spawnSync(command, args, { encoding: "utf8", ...options });

const walk = (dir) => {
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...walk(path));
    } else if (SOURCE_EXTENSIONS.has(extname(path))) {
      found.push(path);
    }
  }
  return found;
};

const collectReferences = () => {
  const tables = new Map();
  const routines = new Map();

  for (const dir of SOURCE_DIRS) {
    for (const file of walk(dir)) {
      const source = readFileSync(file, "utf8");
      for (const [, name] of source.matchAll(FROM_CALL)) {
        if (!IDENTIFIER.test(name)) continue;
        if (!tables.has(name)) tables.set(name, new Set());
        tables.get(name).add(file);
      }
      for (const [, name] of source.matchAll(RPC_CALL)) {
        if (!IDENTIFIER.test(name)) continue;
        if (!routines.has(name)) routines.set(name, new Set());
        routines.get(name).add(file);
      }
    }
  }

  return { tables, routines };
};

// --- database lifecycle -----------------------------------------------------

const externalPsql = process.env.SCHEMA_GATE_PSQL;
let startedContainer = false;

const psqlArgs = (user) =>
  externalPsql
    ? externalPsql.split(/\s+/).filter(Boolean)
    : [
        "exec",
        "-i",
        CONTAINER,
        "psql",
        "-h",
        "127.0.0.1",
        "-U",
        user,
        "-d",
        "postgres",
      ];

const psqlBinary = () => (externalPsql ? psqlArgs("postgres")[0] : "docker");
const psqlRest = (user) =>
  externalPsql ? psqlArgs(user).slice(1) : psqlArgs(user);

const applyFile = (file, user) => {
  const sql = readFileSync(file, "utf8");
  const result = run(
    psqlBinary(),
    [...psqlRest(user), "-v", "ON_ERROR_STOP=1", "-q"],
    { input: sql },
  );
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`
      .split("\n")
      .filter((line) => /^(ERROR|DETAIL|HINT|LINE|CONTEXT)/.test(line))
      .slice(0, 8)
      .join("\n");
    throw new Error(`${file} failed to apply:\n${detail}`);
  }
};

const query = (sql) => {
  const result = run(
    psqlBinary(),
    [...psqlRest("postgres"), "-tA", "-v", "ON_ERROR_STOP=1"],
    { input: sql },
  );
  if (result.status !== 0) {
    throw new Error(`query failed: ${result.stderr}`);
  }
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
};

const startContainer = () => {
  run("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  const started = run("docker", [
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-e",
    "POSTGRES_PASSWORD=postgres",
    IMAGE,
  ]);
  if (started.status !== 0) {
    throw new Error(`could not start ${IMAGE}: ${started.stderr}`);
  }
  startedContainer = true;

  for (let attempt = 0; attempt < 90; attempt += 1) {
    const ready = run("docker", ["exec", CONTAINER, "pg_isready", "-U", "postgres"]);
    if (ready.status === 0) return;
    execFileSync("sleep", ["2"]);
  }
  throw new Error("database did not become ready in time");
};

const stopContainer = () => {
  if (!startedContainer) return;
  run("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
};

// --- main -------------------------------------------------------------------

const main = () => {
  const { tables, routines } = collectReferences();
  log(
    `Found ${tables.size} referenced tables and ${routines.size} referenced RPCs in source.`,
  );

  if (!externalPsql) {
    log(`Starting ${IMAGE}...`);
    startContainer();
  }

  log("Applying CI bootstrap (service-owned schemas)...");
  applyFile(BOOTSTRAP, "supabase_admin");

  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  log(`Applying ${migrations.length} migrations...`);
  for (const migration of migrations) {
    applyFile(join(MIGRATIONS_DIR, migration), "postgres");
  }

  const existingTables = new Set(
    query(
      "select table_name from information_schema.tables where table_schema = 'public';",
    ),
  );
  const existingRoutines = new Set(
    query(
      "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';",
    ),
  );

  const missingTables = [...tables.keys()]
    .filter((name) => !existingTables.has(name))
    .sort();
  const missingRoutines = [...routines.keys()]
    .filter((name) => !existingRoutines.has(name))
    .sort();

  if (missingTables.length === 0 && missingRoutines.length === 0) {
    log(
      `\nOK — every referenced object exists. ${existingTables.size} tables and ${existingRoutines.size} functions built from migrations alone.`,
    );
    return 0;
  }

  log("\nSchema gate FAILED. The following objects are used by application");
  log("code but are not created by any migration in this repository:\n");
  for (const name of missingTables) {
    log(`  table    ${name}`);
    for (const file of [...tables.get(name)].sort()) log(`             ${file}`);
  }
  for (const name of missingRoutines) {
    log(`  function ${name}`);
    for (const file of [...routines.get(name)].sort()) log(`             ${file}`);
  }
  log(
    "\nIf these exist in the live project, they were applied out of band. Add a" +
      "\nmigration that reproduces them. See docs/schema-integrity.md.",
  );
  return 1;
};

let exitCode = 1;
try {
  exitCode = main();
} catch (error) {
  log(`\nSchema gate ERROR: ${error.message}`);
} finally {
  stopContainer();
}
process.exit(exitCode);
