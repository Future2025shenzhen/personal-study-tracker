import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(
  `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`,
);
await db.exec(
  await fs.readFile("supabase/migrations/001_workspace.sql", "utf8"),
);
const A = "00000000-0000-4000-8000-000000000001",
  B = "00000000-0000-4000-8000-000000000002";
await db.query("insert into auth.users values($1),($2)", [A, B]);
const workspace = {
  schema: 1,
  subjects: [{ id: "math", name: "Math", color: "#4F86D4" }],
  sessions: [],
  tasks: [],
  goals: [],
  timer: null,
  settings: { theme: "system" },
};
const as = async (user, fn) => {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
};
let count = 0;
const pass = (name) => {
  count++;
  console.log("PASS " + name);
};
const commit = async (version, id, doc = workspace) =>
  (
    await db.query(
      "select public.commit_study_workspace($1,$2,$3::jsonb) as result",
      [version, id, JSON.stringify(doc)],
    )
  ).rows[0].result;
const id = (n) => `00000000-0000-4000-8001-${String(n).padStart(12, "0")}`;
await as(A, async () => {
  const r = await commit(0, id(1));
  assert.equal(r.version, 1);
  pass("authenticated initial workspace");
  assert.deepEqual(await commit(0, id(1)), r);
  pass("idempotent retry does not duplicate writes");
  await assert.rejects(
    db.query("update public.study_workspaces set version=999"),
  );
  await assert.rejects(
    db.query(
      "insert into public.study_workspaces(user_id,document) values($1,$2)",
      [B, workspace],
    ),
  );
  pass("direct writes denied; mutations only through transactional RPC");
});
await as(B, async () => {
  assert.equal(
    (await db.query("select * from public.study_workspaces")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("select * from public.study_operations")).rows.length,
    0,
  );
  pass("user B cannot read A workspace or operation receipts");
  const r = await commit(0, id(2), { ...workspace, subjects: [] });
  assert.equal(r.version, 1);
  pass("B gets separate workspace from authenticated identity");
});
await as(A, async () => {
  const q = await db.query(
    "select * from public.study_workspaces where user_id=$1",
    [B],
  );
  assert.equal(q.rows.length, 0);
  pass("forged target-user query returns zero rows");
  const timer = {
    id: "timer-one",
    subjectId: "math",
    startedAt: new Date().toISOString(),
    runningSince: new Date().toISOString(),
    segments: [],
    note: "",
  };
  const first = await commit(1, id(3), { ...workspace, timer });
  const second = await commit(1, id(4), {
    ...workspace,
    timer: { ...timer, id: "timer-two" },
  });
  assert.equal(first.conflict, false);
  assert.equal(second.conflict, true);
  assert.equal(second.document.timer.id, "timer-one");
  pass("simultaneous stale starts serialize to one active timer");
  const doc = { ...workspace, timer: null, sessions: [{ id: "timer-one" }] };
  const finish = await commit(2, id(5), doc);
  const stale = await commit(2, id(6), doc);
  assert.equal(finish.conflict, false);
  assert.equal(stale.conflict, true);
  assert.equal(stale.document.sessions.length, 1);
  pass("two device finishes cannot double count");
  const offline = await commit(1, id(7), workspace);
  assert.equal(offline.conflict, true);
  assert.equal(offline.version, 3);
  pass("stale offline snapshot cannot overwrite latest cloud state");
  await assert.rejects(commit(null, id(8)));
  pass("null version cannot bypass optimistic concurrency");
  await assert.rejects(commit(3, id(9), { schema: 1 }));
  pass("malformed workspace rejected");
});
await db.exec("set role anon");
await assert.rejects(db.query("select * from public.study_workspaces"));
await assert.rejects(
  db.query("select public.commit_study_workspace(0,$1,$2::jsonb)", [
    id(10),
    workspace,
  ]),
);
await db.exec("reset role");
pass("anonymous reads and RPC writes denied");
await as("", async () => {
  await assert.rejects(commit(0, id(11)));
});
pass("missing authenticated subject rejected");
await db.close();
console.log(
  `${count} real Postgres/RLS checks passed (PGlite). Hosted Supabase Auth and multi-connection load are separate deployment checks.`,
);
