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
  await sql(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,email text unique,encrypted_password text,created_at timestamptz default now(),last_sign_in_at timestamptz,raw_user_meta_data jsonb default '{}');
 create table auth.audit_log_entries(id uuid primary key,payload jsonb,created_at timestamptz default now());
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade);
 create table auth.identities(id uuid primary key,user_id uuid references auth.users on delete cascade);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid(),auth.jwt() to anon,authenticated;
 alter default privileges in schema public grant all on functions to anon,authenticated;
 alter default privileges in schema public grant all on tables to anon,authenticated;`);
  await sql(await fs.readFile("tests/fixtures/math-001-accounts.sql", "utf8"));
  const crlf = JSON.parse(
    await fs.readFile("tests/fixtures/math-pp-new-user-crlf.json", "utf8"),
  ).validator.source;
  await sql(
    "create or replace function public.pp_new_user() returns trigger language plpgsql security definer set search_path=pg_catalog as $f$" +
      crlf +
      "$f$;",
  );
  await insert(1, email("Math_Student"), { nickname: "Math_Student" });
  await sql(await fs.readFile("supabase/shared/01_install_shared.sql", "utf8"));
  const math = await sql(
    "select prosrc from pg_proc where oid='public.pp_new_user()'::regprocedure;select pg_get_triggerdef(oid) from pg_trigger where tgname='pp_auth_user_created';select row_to_json(p) from public.pp_profiles p;",
  );
  const migration = await fs.readFile(
    "supabase/shared/05_username_accounts.sql",
    "utf8",
  );
  await sql(migration);
  assert.equal(
    await sql(
      "select prosrc from pg_proc where oid='public.pp_new_user()'::regprocedure;select pg_get_triggerdef(oid) from pg_trigger where tgname='pp_auth_user_created';select row_to_json(p) from public.pp_profiles p;",
    ),
    math,
  );
  pass("upgrade preserves exact CRLF maths function, trigger and profiles");
  const ns = last(
    await sql("select namespace from public.study_account_config"),
  );
  const alias = (nick) =>
    createHash("sha256")
      .update(nick.normalize("NFKC").trim().toLowerCase())
      .digest("hex") +
    "@" +
    ns;
  const signup = (n, nick, extra = {}) =>
    insert(n, alias(nick), { study_username: nick, ...extra });
  assert.equal(
    JSON.parse(
      last(
        await sql("set role anon;select public.study_public_account_mode();"),
      ),
    ).mode,
    "username",
  );
  await assert.rejects(
    sql("set role anon;select public.study_owner_create_admin_invites();"),
  );
  await assert.rejects(
    as(1, "select public.study_owner_create_admin_invites();"),
  );
  pass("public config contains no secrets; invitation generator is owner-only");
  await assert.rejects(signup(2, "Kevinwang", { role: "admin" }));
  await assert.rejects(
    signup(3, "Jackwang", { study_invite: "guessed-token" }),
  );
  assert.equal(
    last(await sql("select count(*) from public.study_accounts;")),
    "0",
  );
  pass("both reserved admin names require private invitations");
  const invites = JSON.parse(
    last(
      await sql(
        "select jsonb_agg(i) from public.study_owner_create_admin_invites() i;",
      ),
    ),
  );
  await signup(2, "Kevinwang", {
    study_invite: invites.find((i) => i.username === "Kevinwang").invitation,
  });
  await signup(3, "Jackwang", {
    study_invite: invites.find((i) => i.username === "Jackwang").invitation,
  });
  assert.equal(
    last(
      await sql(
        "select count(*) from auth.users where raw_user_meta_data ? 'study_invite'",
      ),
    ),
    "0",
  );
  assert.equal(
    JSON.parse(last(await as(2, "select public.study_account_identity();")))
      .must_change_password,
    true,
  );
  assert.equal(last(await as(2, "select public.study_has_access();")), "f");
  await assert.rejects(as(2, "select public.study_admin_users();"));
  await assert.rejects(
    as(2, "update public.study_accounts set must_change_password=false;"),
  );
  pass(
    "single-use tokens stripped; admin must rotate password before data or administration",
  );
  await sql(
    `update auth.users set encrypted_password='server-auth-new-hash' where id in (${q(user(2))},${q(user(3))});`,
  );
  assert.equal(last(await as(2, "select public.study_has_access();")), "t");
  await signup(4, "普通用户", { role: "admin", must_change_password: false });
  assert.equal(
    JSON.parse(last(await as(4, "select public.study_account_identity();")))
      .role,
    "user",
  );
  assert.equal(last(await as(4, "select public.study_has_access();")), "t");
  await assert.rejects(as(4, "select public.study_admin_users();"));
  await assert.rejects(as(4, "select public.study_admin_events();"));
  await assert.rejects(
    as(4, `select public.study_admin_manage(${q(user(2))},'delete','');`),
  );
  pass(
    "ordinary username signup needs no email; spoofed roles cannot grant administration",
  );
  await signup(5, "Ｆｏｏ＿１２");
  await assert.rejects(signup(6, "foo_12"));
  await assert.rejects(
    insert(7, alias("Test_07"), { study_username: "Other_07" }),
  );
  await assert.rejects(signup(8, "Test_08", { nickname: "Math_Student" }));
  pass(
    "NFKC and case normalization, unique names, namespaces and maths metadata enforced",
  );
  await as(4, commit(0, 1));
  await sql(
    `insert into auth.sessions values(${q(user(40))},${q(user(4))});insert into auth.identities values(${q(user(41))},${q(user(4))});`,
  );
  await as(2, `select public.study_admin_manage(${q(user(4))},'disable','');`);
  assert.equal(last(await as(4, "select public.study_has_access();")), "f");
  await assert.rejects(as(4, "select public.study_account_identity();"));
  await assert.rejects(as(4, commit(1, 2)));
  assert.equal(
    last(await as(4, "select count(*) from public.study_workspaces;")),
    "0",
  );
  await as(4, `select public.study_authorize_email();`, {
    email: alias("普通用户"),
    amr: [{ method: "otp" }],
  });
  assert.equal(last(await as(4, "select public.study_has_access();")), "f");
  await as(2, `select public.study_admin_manage(${q(user(4))},'enable','');`);
  assert.equal(last(await as(4, "select public.study_has_access();")), "t");
  pass(
    "disable revokes existing JWT access; OTP ledger cannot bypass; enable restores records",
  );
  await assert.rejects(
    as(2, `select public.study_admin_manage(${q(user(2))},'delete','');`),
  );
  await assert.rejects(
    as(2, `select public.study_admin_manage(${q(user(3))},'delete','');`),
  );
  await assert.rejects(
    as(2, `select public.study_admin_manage(${q(user(1))},'delete','');`),
  );
  await assert.rejects(
    as(
      2,
      `select public.study_admin_manage(${q(user(4))},'purge','普通用户');`,
    ),
  );
  pass("admins, maths users, active users protected from permanent deletion");
  await sql(
    `insert into auth.audit_log_entries values(${q(user(200))},jsonb_build_object('action','login','actor_id',${q(user(4))}),now());insert into auth.audit_log_entries values(${q(user(201))},jsonb_build_object('action','logout','actor_id',${q(user(4))}),now());insert into auth.audit_log_entries values(${q(user(202))},jsonb_build_object('action','login','actor_id',${q(user(1))}),now());`,
  );
  assert.equal(
    JSON.parse(last(await as(2, "select public.study_admin_events();"))).length,
    2,
  );
  await assert.rejects(
    as(
      4,
      "insert into public.study_account_events(user_id,username,event) values(auth.uid(),'fake','logout');",
    ),
  );
  await assert.rejects(as(4, "select * from public.study_admin_invites;"));
  await assert.rejects(as(4, "select * from public.study_admin_actions;"));
  pass(
    "server audit stores only study events; browser cannot forge events or read private tables",
  );
  await as(2, `select public.study_admin_manage(${q(user(4))},'delete','');`);
  assert.equal(last(await as(4, "select public.study_has_access();")), "f");
  await as(2, `select public.study_admin_manage(${q(user(4))},'restore','');`);
  assert.equal(last(await as(4, "select public.study_has_access();")), "t");
  await as(2, `select public.study_admin_manage(${q(user(4))},'delete','');`);
  await assert.rejects(
    as(2, `select public.study_admin_manage(${q(user(4))},'purge','wrong');`),
  );
  await as(
    2,
    `select public.study_admin_manage(${q(user(4))},'purge','普通用户');`,
  );
  assert.equal(
    last(
      await sql(
        `select (select count(*) from auth.users where id=${q(user(4))})+(select count(*) from public.study_workspaces where user_id=${q(user(4))})+(select count(*) from public.study_operations where user_id=${q(user(4))})+(select count(*) from auth.sessions where user_id=${q(user(4))})+(select count(*) from auth.identities where user_id=${q(user(4))});`,
      ),
    ),
    "0",
  );
  assert.equal(last(await as(4, "select public.study_has_access();")), "f");
  assert.equal(
    JSON.parse(last(await as(2, "select public.study_admin_events();"))).length,
    2,
  );
  pass(
    "recycle/restore preserves data; confirmed purge cascades sessions, identities, workspace and receipts, audit retained",
  );
  await sql(
    `update auth.users set last_sign_in_at=now() where id=${q(user(5))};insert into auth.sessions values(${q(user(50))},${q(user(5))});`,
  );
  assert.equal(
    JSON.parse(
      last(await as(2, `select public.study_admin_events(${q(user(5))});`)),
    ).length,
    1,
  );
  await assert.rejects(
    as(5, "select public.study_record_logout();", { session_id: user(50) }),
  );
  await assert.rejects(as(5, "select public.study_record_logout();"));
  await sql(`delete from auth.sessions where id=${q(user(50))};`);
  await as(5, "select public.study_record_logout();", { session_id: user(50) });
  await as(5, "select public.study_record_logout();", { session_id: user(50) });
  assert.equal(
    JSON.parse(
      last(await as(2, `select public.study_admin_events(${q(user(5))});`)),
    ).length,
    2,
  );
  pass(
    "login fallback uses Auth timestamp; logout requires ended signed session and is idempotent",
  );

  await insert(20, email("Math_After"), { nickname: "Math_After" });
  assert.equal(
    last(await sql("select count(*) from public.pp_profiles;")),
    "2",
  );
  await insert(21, "legacy@example.net");
  await as(21, "select public.study_authorize_email();", {
    email: "legacy@example.net",
    amr: [{ method: "otp" }],
  });
  assert.equal(last(await as(21, "select public.study_has_access();")), "t");
  pass("maths registration and existing verified email workflows still work");
  await assert.rejects(sql(migration));
  assert.equal(last(await as(2, "select public.study_has_access();")), "t");
  pass(
    "accidental second install rolls back without breaking existing accounts",
  );
  assert.equal(
    last(
      await sql(
        await fs.readFile(
          "supabase/shared/07_verify_username_accounts.sql",
          "utf8",
        ),
      ),
    ),
    "t|t|t|t|t|t",
  );
  pass(
    "read-only post-upgrade verification returns six true flags without secrets",
  );
  console.log(`${passed} username account integration checks passed`);
} finally {
  await docker(["rm", "-f", name]).catch(() => {});
}
