// Integration: full unchanged legacy math SQL + shared installer in a disposable
// Postgres 17. Never targets a hosted database or reads any real user data.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const env = { ...process.env };
for (const k of [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
])
  delete env[k];
const name = `study-shared-test-${process.pid}`;
function docker(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn("docker", ["--host=unix:///var/run/docker.sock", ...args], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    p.stdout.on("data", (v) => (out += v));
    p.stderr.on("data", (v) => (err += v));
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve(out) : reject(Error(err || out))));
    p.stdin.end(input);
  });
}
const sql = (text) =>
  docker(
    [
      "exec",
      "-i",
      "-e",
      "PGPASSWORD=local-test-only",
      name,
      "psql",
      "-h",
      "127.0.0.1",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-qAt",
    ],
    text,
  );
const q = (s) => "'" + s.replaceAll("'", "''") + "'";
const user = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const email = (nick) =>
  createHash("sha256")
    .update(nick.normalize("NFKC").trim().toLowerCase())
    .digest("hex") + "@accounts.example.com";
const insert = (n, address, meta = {}) =>
  sql(
    `insert into auth.users(id,email,raw_user_meta_data) values(${q(user(n))},${q(address)},${q(JSON.stringify(meta))}::jsonb);`,
  );
const as = (n, query, claims = {}) =>
  sql(
    `set role authenticated;select set_config('request.jwt.claim.sub',${q(user(n))},false);select set_config('request.jwt.claims',${q(JSON.stringify(claims))},false);${query}`,
  );
const last = (r) => r.trim().split("\n").at(-1);
let passed = 0;
const pass = (n) => {
  passed++;
  console.log("PASS " + n);
};
const document = {
  schema: 1,
  subjects: [],
  sessions: [],
  tasks: [],
  goals: [],
  timer: null,
  settings: { theme: "system" },
};
const commit = (ver, n, doc = document) =>
  `select public.commit_study_workspace(${ver},${q(user(100 + n))},${q(JSON.stringify(doc))}::jsonb);`;
try {
  await docker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=local-test-only",
    "postgres:17",
  ]);
  for (let i = 0; i < 30; i++) {
    try {
      await sql("select 1");
      break;
    } catch (e) {
      if (i === 29) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await sql(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid(),auth.jwt() to anon,authenticated;`,
  );
  await sql(await fs.readFile("tests/fixtures/math-001-accounts.sql", "utf8"));
  const exportedVariant = process.env.STUDY_TEST_LEGACY_VARIANT === "export";
  const ownerExport = await fs.readFile(
    "tests/fixtures/math-pp-new-user-export.sql",
    "utf8",
  );
  if (exportedVariant) await sql(ownerExport);
  console.log(
    "Testing validator variant: " +
      (exportedVariant ? "owner-export" : "repository"),
  );
  await insert(1, email("Student_One"), { nickname: "Student_One" });
  await sql(
    `insert into public.pp_question_catalog values('math-q','original','P1');insert into public.pp_records(user_id,question_id,saved,done,version) values(${q(user(1))},'math-q',true,true,9);insert into public.pp_admins values(${q(user(1))});`,
  );
  const snapshot = () =>
    sql(
      `select jsonb_build_object('profiles',(select jsonb_agg(t) from public.pp_profiles t),'records',(select jsonb_agg(t) from public.pp_records t),'admins',(select jsonb_agg(t) from public.pp_admins t),'function',(select prosrc from pg_proc where oid='public.pp_new_user()'::regprocedure));`,
    );
  const before = await snapshot();
  const triggerBefore = await sql(
    `select pg_get_triggerdef(oid) from pg_trigger where tgname='pp_auth_user_created';`,
  );
  await assert.rejects(insert(2, "owner@example.net"));
  pass(
    "baseline confirms ordinary email is rejected by the unchanged legacy trigger",
  );
  const check = last(
    await sql(
      await fs.readFile("supabase/shared/00_check_math_library.sql", "utf8"),
    ),
  );
  assert.equal(check.split("|").slice(0, 3).join("|"), "t|t|f");
  pass("read-only preflight recognizes exact legacy validator and trigger");
  const install = await fs.readFile(
    "supabase/shared/01_install_shared.sql",
    "utf8",
  );
  const fixture = await fs.readFile(
    "tests/fixtures/math-001-accounts.sql",
    "utf8",
  );
  const validator = exportedVariant
    ? ownerExport
    : fixture.match(
        /create or replace function public\.pp_new_user\(\)[\s\S]*?\$\$;/,
      )[0];
  await sql(
    validator.replace(
      /(as \$\$|AS \$function\$)/,
      (value) => value + "\n-- custom deployment change",
    ),
  );
  await assert.rejects(sql(install));
  assert.equal(
    last(await sql("select to_regclass('public.study_workspaces') is null")),
    "t",
  );
  await sql(validator);
  pass(
    "unreviewed live validator changes stop installation before creating tables",
  );
  await sql(
    "create function public.temporary_auth_hook() returns trigger language plpgsql as $$begin return new;end$$;create trigger temporary_auth_hook after insert on auth.users for each row execute function public.temporary_auth_hook();",
  );
  await assert.rejects(sql(install));
  assert.equal(
    last(await sql("select to_regclass('public.study_workspaces') is null")),
    "t",
  );
  await sql(
    "drop trigger temporary_auth_hook on auth.users;drop function public.temporary_auth_hook();",
  );
  pass("unknown auth insert hooks stop installation without overriding them");
  await sql(install);
  assert.equal(await snapshot(), before);
  pass(
    "installation preserves all original profiles, progress, admin membership and validator source",
  );
  const postCheck = last(
    await sql(
      await fs.readFile("supabase/shared/03_verify_install.sql", "utf8"),
    ),
  );
  assert.equal(postCheck, "t|t|t|t|t|t|t|t");
  pass(
    "read-only post-install check confirms all eight schema, legacy and permission flags",
  );
  await assert.rejects(sql(install));
  assert.equal(await snapshot(), before);
  pass("repeat installation stops atomically without touching existing data");
  await insert(2, "owner@example.net");
  assert.equal(
    last(
      await sql(
        `select count(*) from public.pp_profiles where id=${q(user(2))}`,
      ),
    ),
    "0",
  );
  pass("ordinary learning email can register without creating a math profile");
  await insert(3, email("New_Student"), { nickname: "New_Student" });
  assert.equal(
    last(
      await sql(
        `select nickname from public.pp_profiles where id=${q(user(3))}`,
      ),
    ),
    "New_Student",
  );
  pass("new nickname registrations still create valid legacy math profiles");
  await assert.rejects(
    insert(4, "bad@accounts.example.com", { nickname: "Student_One" }),
  );
  await assert.rejects(insert(4, "bad@accounts.example.com"));
  await assert.rejects(
    insert(4, "fake@example.net", { nickname: "Student_One" }),
  );
  pass("malformed nickname identities and spoofed metadata still rejected");
  await assert.rejects(
    as(2, "select public.study_authorize_email();", {
      email: "owner@example.net",
      amr: [{ method: "password" }],
      user_metadata: { email_verified: true },
    }),
  );
  await assert.rejects(as(2, commit(0, 1)));
  pass(
    "auto-confirmed password signup and editable metadata cannot bypass first inbox verification",
  );
  await assert.rejects(
    as(2, "select public.study_authorize_email();", {
      email: "someone-else@example.net",
      amr: [{ method: "otp" }],
    }),
  );
  pass("OTP claims must match the actual current account email");
  const claims = { email: "owner@example.net", amr: [{ method: "otp" }] };
  assert.equal(
    last(await as(2, "select public.study_authorize_email();", claims)),
    "t",
  );
  pass("signed OTP session establishes server-owned study membership");
  const c = JSON.parse(last(await as(2, commit(0, 2))));
  assert.equal(c.version, 1);
  pass("verified learning account commits through versioned transactional RPC");
  assert.equal(
    last(
      await as(2, "select public.study_authorize_email();", {
        email: "owner@example.net",
        amr: [{ method: "password" }],
      }),
    ),
    "t",
  );
  pass("verified account can subsequently use password login");
  await assert.rejects(
    as(1, "select public.study_authorize_email();", {
      email: email("Student_One"),
      amr: [{ method: "otp" }],
    }),
  );
  await assert.rejects(as(1, commit(0, 3)));
  assert.equal(
    last(await as(1, "select count(*) from public.study_workspaces")),
    "0",
  );
  pass(
    "math nickname account cannot claim a study membership or read learning records",
  );
  assert.equal(
    last(await as(2, "select count(*) from public.pp_profiles")),
    "0",
  );
  assert.equal(
    last(await as(2, "select count(*) from public.pp_records")),
    "0",
  );
  await assert.rejects(as(2, "select public.pp_admin_users();"));
  await assert.rejects(as(2, "select public.pp_snapshot();"));
  pass(
    "learning account cannot read math profiles/progress/admin data or use math snapshot",
  );
  const mathSnapshot = JSON.parse(
    last(await as(1, "select public.pp_snapshot();")),
  );
  assert.equal(mathSnapshot.records[0].version, 9);
  assert.equal(mathSnapshot.profile.is_admin, true);
  pass("existing math snapshot and admin privileges remain functional");
  const changed = JSON.parse(
    last(
      await as(
        1,
        `select public.pp_apply_records('[{"question_id":"math-q","base_version":9,"done":false}]'::jsonb);`,
      ),
    ),
  );
  assert.equal(changed[0].version, 10);
  pass("existing math record update and version validation remain functional");
  await insert(5, "second@example.net");
  await as(5, "select public.study_authorize_email();", {
    email: "second@example.net",
    amr: [{ method: "otp" }],
  });
  assert.equal(
    last(await as(5, "select count(*) from public.study_workspaces")),
    "0",
  );
  pass("two learning accounts remain isolated by RLS");
  await assert.rejects(
    as(
      2,
      `insert into public.study_verified_emails values(${q(user(5))},'second@example.net',now());`,
    ),
  );
  await assert.rejects(
    as(2, `update public.study_workspaces set version=100;`),
  );
  pass(
    "client cannot forge email-verification ledger or directly update workspace",
  );
  await sql(
    `update auth.users set email='changed@example.net' where id=${q(user(2))}`,
  );
  assert.equal(
    last(await as(2, "select count(*) from public.study_workspaces")),
    "0",
  );
  await assert.rejects(as(2, commit(1, 4)));
  await assert.rejects(as(2, "select public.study_authorize_email();", claims));
  pass(
    "changed email loses study access until new matching inbox verification",
  );
  await as(2, "select public.study_authorize_email();", {
    email: "changed@example.net",
    amr: [{ method: "otp" }],
  });
  assert.equal(
    last(await as(2, "select count(*) from public.study_workspaces")),
    "1",
  );
  pass("reverification after email change restores the same existing data");
  await sql("set role anon;");
  await assert.rejects(
    sql("set role anon;select public.study_authorize_email();"),
  );
  pass("anonymous authorization calls rejected");
  await sql(await fs.readFile("supabase/shared/02_disable_shared.sql", "utf8"));
  assert.equal(
    await sql(
      `select pg_get_triggerdef(oid) from pg_trigger where tgname='pp_auth_user_created';`,
    ),
    triggerBefore,
  );
  assert.equal(
    last(await sql("select count(*) from public.study_workspaces")),
    "1",
  );
  await assert.rejects(as(2, "select * from public.study_workspaces"));
  pass(
    "disable restores exact original trigger and retains learning data while removing access",
  );
  await assert.rejects(insert(6, "rollback-test@example.net"));
  await insert(6, email("After_Rollback"), { nickname: "After_Rollback" });
  pass(
    "legacy registrations still function after disable; ordinary-email registration returns to original rule",
  );
  console.log(
    `${passed} shared-backend Postgres checks passed. Hosted Auth, email delivery and live deployment remain unverified.`,
  );
} finally {
  await docker(["stop", name]).catch(() => {});
}
