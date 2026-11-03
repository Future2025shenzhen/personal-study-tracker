// Disposable Postgres 17 only: never connect this runner to a hosted database.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const env = { ...process.env };
for (const key of [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
])
  delete env[key];
const container =
  process.env.STUDY_TEST_CONTAINER || `study-tracker-acceptance-${process.pid}`;
const owns = !process.env.STUDY_TEST_CONTAINER;
function docker(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn("docker", ["--host=unix:///var/run/docker.sock", ...args], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    p.stdout.on("data", (x) => (out += x));
    p.stderr.on("data", (x) => (err += x));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve(out) : reject(Error(err || out)),
    );
    p.stdin.end(input);
  });
}
const exec = (...args) => docker(["exec", "-i", container, ...args]);
const sql = (db, text) =>
  docker(
    [
      "exec",
      "-i",
      "-e",
      "PGPASSWORD=local-test-only",
      container,
      "psql",
      "-h",
      "127.0.0.1",
      "-U",
      "postgres",
      "-d",
      db,
      "-v",
      "ON_ERROR_STOP=1",
      "-qAt",
    ],
    text,
  );
const bootstrap = `create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;insert into auth.users values('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');`;
const actor = "00000000-0000-4000-8000-000000000001";
const doc = {
  schema: 1,
  subjects: [],
  sessions: [],
  tasks: [],
  goals: [],
  timer: null,
  settings: { theme: "system" },
};
const as = (text) =>
  `set role authenticated;select set_config('request.jwt.claim.sub','${actor}',false);${text}`;
const json = (x) => "'" + JSON.stringify(x).replaceAll("'", "''") + "'::jsonb";
const commit = (v, n, w) =>
  `select public.commit_study_workspace(${v},'00000000-0000-4000-8001-${String(n).padStart(12, "0")}',${json(w)});`;
const result = (output) => JSON.parse(output.trim().split("\n").at(-1));
try {
  if (owns)
    await docker([
      "run",
      "--rm",
      "-d",
      "--name",
      container,
      "-e",
      "POSTGRES_PASSWORD=local-test-only",
      "postgres:17",
    ]);
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      // initdb starts a temporary Unix-socket-only server, then stops it.
      // A successful local pg_isready can race that shutdown. Require an
      // authenticated TCP query against the final server before any setup.
      await sql("postgres", "select 1;");
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!ready) throw Error("Postgres did not become ready");
  await sql(
    "postgres",
    `create role anon;create role authenticated;create database study_tracker_acceptance;create database study_restore_acceptance;`,
  );
  await sql("study_tracker_acceptance", bootstrap);
  await sql(
    "study_tracker_acceptance",
    await fs.readFile("supabase/migrations/001_workspace.sql", "utf8"),
  );
  await sql("study_tracker_acceptance", as(commit(0, 1, doc)));
  const [a, b] = await Promise.all([
    sql(
      "study_tracker_acceptance",
      as(commit(1, 2, { ...doc, timer: { id: "device-a" } })),
    ),
    sql(
      "study_tracker_acceptance",
      as(commit(1, 3, { ...doc, timer: { id: "device-b" } })),
    ),
  ]);
  const starts = [result(a), result(b)];
  assert.equal(starts.filter((r) => !r.conflict).length, 1);
  assert.equal(starts.filter((r) => r.conflict).length, 1);
  assert.equal(starts[0].document.timer.id, starts[1].document.timer.id);
  console.log(
    "PASS real parallel database connections: only one timer start commits",
  );
  const finished = {
    ...doc,
    sessions: [
      {
        id: starts[0].document.timer.id,
        durationMs: 60000,
        note: "restore me",
      },
    ],
  };
  const ends = await Promise.all([
    sql("study_tracker_acceptance", as(commit(2, 4, finished))),
    sql("study_tracker_acceptance", as(commit(2, 5, finished))),
  ]);
  assert.equal(ends.map(result).filter((r) => !r.conflict).length, 1);
  assert.equal(ends.map(result).filter((r) => r.conflict).length, 1);
  console.log("PASS real parallel finishes: one session, no duplicate");
  const count = (
    await sql(
      "study_tracker_acceptance",
      `set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);select count(*) from public.study_workspaces;`,
    )
  )
    .trim()
    .split("\n")
    .at(-1);
  assert.equal(count, "0");
  console.log("PASS actual PostgreSQL RLS blocks another user");
  const old = result(
    await sql("study_tracker_acceptance", as(commit(1, 6, doc))),
  );
  assert.equal(old.conflict, true);
  assert.equal(old.document.sessions.length, 1);
  console.log("PASS stale offline state cannot erase latest record");
  await exec(
    "pg_dump",
    "-U",
    "postgres",
    "-d",
    "study_tracker_acceptance",
    "--schema=public",
    "--format=custom",
    "--no-owner",
    "--no-acl",
    "--file=/tmp/study-test.dump",
  );
  await sql("study_restore_acceptance", bootstrap + "drop schema public;");
  await exec(
    "pg_restore",
    "-U",
    "postgres",
    "-d",
    "study_restore_acceptance",
    "--no-owner",
    "--no-acl",
    "--exit-on-error",
    "/tmp/study-test.dump",
  );
  for (const table of ["study_workspaces", "study_operations"]) {
    const query = `select coalesce(jsonb_agg(t order by ${table === "study_operations" ? "user_id,operation_id" : "user_id"}),'[]'::jsonb) from public.${table} t;`;
    assert.equal(
      await sql("study_tracker_acceptance", query),
      await sql("study_restore_acceptance", query),
    );
  }
  console.log(
    "PASS pg_dump/pg_restore into independent database: workspaces and idempotency receipts identical",
  );
  console.log(
    "5 multi-connection, isolation and database recovery checks passed. No hosted service was used.",
  );
} finally {
  if (owns) await docker(["stop", container]).catch(() => {});
}
