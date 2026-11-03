// Build a standalone SQL Editor installation from the existing migration and
// an exact, read-only fixture of the legacy math account schema.
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
const legacy = await fs.readFile(
  "tests/fixtures/math-001-accounts.sql",
  "utf8",
);
const source = legacy.match(
  /create or replace function public\.pp_new_user\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/,
)?.[1];
if (!source) throw Error("Cannot extract known math registration validator");
const exported = await fs.readFile(
  "tests/fixtures/math-pp-new-user-export.sql",
  "utf8",
);
const exportedSource = exported.match(
  /AS \$function\$([\s\S]*?)\$function\$/,
)?.[1];
if (!exportedSource) throw Error("Cannot extract reviewed owner export");
const liveDiagnostic = JSON.parse(
  await fs.readFile("tests/fixtures/math-pp-new-user-crlf.json", "utf8"),
);
const crlfSource = liveDiagnostic.validator.source;
if (
  crlfSource.replaceAll("\r\n", "\n") !== exportedSource ||
  !liveDiagnostic.validator.security_definer ||
  JSON.stringify(liveDiagnostic.validator.settings) !==
    JSON.stringify(["search_path=pg_catalog"])
)
  throw Error("CRLF fixture differs from the reviewed owner function");
// Escape every internal line ending. Copying the installer between Windows and
// browser editors must NOT change the bytes of the expected source strings.
const sqlText = (text) =>
  "E'" +
  text
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "''")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n") +
  "'";
const reviewedSources = [source, exportedSource, crlfSource];
const expected = reviewedSources.map(sqlText).join(", ");
const check = `do $study_preflight$
begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.pp_new_user()') and p.prosecdef and p.prolang=(select oid from pg_language where lanname='plpgsql') and p.proconfig=array['search_path=pg_catalog']::text[] and p.prosrc in (${expected})) then
  raise exception 'Math registration validator differs from the reviewed version. STOP: do not edit or disable the existing function; send the preflight result for review.';
 end if;
 if not exists(select 1 from pg_trigger t where t.tgrelid='auth.users'::regclass and t.tgname='pp_auth_user_created' and t.tgfoid=to_regprocedure('public.pp_new_user()') and t.tgtype=5 and t.tgenabled='O' and t.tgnargs=0 and t.tgqual is null) then
  raise exception 'Math registration trigger differs from the reviewed version. STOP: manual inspection required.';
 end if;
 if exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal and (tgtype&4)=4 and tgname<>'pp_auth_user_created') then
  raise exception 'Additional auth INSERT triggers exist; STOP for compatibility review.';
 end if;
 if to_regclass('public.study_workspaces') is not null or to_regclass('public.study_operations') is not null or to_regclass('public.study_verified_emails') is not null or to_regclass('public.study_shared_installation') is not null or to_regprocedure('public.study_has_access()') is not null or to_regprocedure('public.study_authorize_email()') is not null or to_regprocedure('public.commit_study_workspace(bigint,uuid,jsonb)') is not null then
  raise exception 'Study objects already exist. Do not reinstall over existing data. Ask for an upgrade/check instead.';
 end if;
end $study_preflight$;`;
const fingerprints = reviewedSources
  .map((s) => "\'" + createHash("md5").update(s).digest("hex") + "\'")
  .join(",");
const readOnly = `-- READ ONLY: safe to run in maths Library SQL Editor. No user emails or data are returned.
select
 exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.pp_new_user()') and p.prosecdef and p.prolang=(select oid from pg_language where lanname='plpgsql') and p.proconfig=array['search_path=pg_catalog']::text[] and md5(p.prosrc) in (${fingerprints})) as math_validator_matches,
 exists(select 1 from pg_trigger t where t.tgrelid='auth.users'::regclass and t.tgname='pp_auth_user_created' and t.tgfoid=to_regprocedure('public.pp_new_user()') and t.tgtype=5 and t.tgenabled='O' and t.tgnargs=0 and t.tgqual is null) as math_trigger_matches,
 to_regclass('public.study_workspaces') is not null as study_already_installed,
 (select count(*) from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal and (tgtype&4)=4 and tgname<>'pp_auth_user_created') as other_insert_triggers;
`;
const gate = `
create table public.study_shared_installation (
 id boolean primary key default true check(id), previous_trigger_sql text not null,
 installed_trigger_sql text, installed_at timestamptz not null default now()
);
revoke all on public.study_shared_installation from public,anon,authenticated;
insert into public.study_shared_installation(previous_trigger_sql)
 select pg_get_triggerdef(oid) from pg_trigger where tgrelid='auth.users'::regclass and tgname='pp_auth_user_created';

-- The old validation function is NEVER replaced. It still handles reserved
-- nickname identities and any signup presenting nickname metadata.
drop trigger pp_auth_user_created on auth.users;
create trigger pp_auth_user_created after insert on auth.users for each row
 when (lower(split_part(coalesce(new.email,''),'@',2))='accounts.example.com' or coalesce(new.raw_user_meta_data,'{}'::jsonb) ? 'nickname')
 execute function public.pp_new_user();
update public.study_shared_installation set installed_trigger_sql=(select pg_get_triggerdef(oid) from pg_trigger where tgrelid='auth.users'::regclass and tgname='pp_auth_user_created');

-- Do not turn global Confirm Email on: the legacy nickname login requires it off.
-- A server-owned membership ledger instead requires an inbox-proven OTP session
-- before this app can read or write data. user_metadata is NOT proof of inbox access.
create table public.study_verified_emails (
 user_id uuid primary key references auth.users(id) on delete cascade,
 verified_email text not null, verified_at timestamptz not null default now()
);
alter table public.study_verified_emails enable row level security;
revoke all on public.study_verified_emails from public,anon,authenticated;

create function public.study_has_access() returns boolean
 language sql stable security definer set search_path='' as $study_access$
 select exists(select 1 from public.study_verified_emails v join auth.users u on u.id=v.user_id
 where v.user_id=auth.uid() and lower(u.email)=v.verified_email
 and lower(split_part(u.email,'@',2))<>'accounts.example.com');
$study_access$;
revoke all on function public.study_has_access() from public,anon,authenticated;
grant execute on function public.study_has_access() to authenticated;

create function public.study_authorize_email() returns boolean
 language plpgsql security definer set search_path='' as $study_authorize$
declare actor uuid:=auth.uid(); current_email text; claims jsonb:=auth.jwt();
begin
 if actor is null then raise exception '请先登录' using errcode='42501'; end if;
 if public.study_has_access() then return true; end if;
 select lower(email) into current_email from auth.users where id=actor;
 if current_email is null or position('@' in current_email)=0 or split_part(current_email,'@',2)='accounts.example.com' then
  raise exception '学习记录请使用真实邮箱登录，数学题库昵称账号保持独立' using errcode='42501';
 end if;
 if lower(coalesce(claims->>'email',''))<>current_email
 or jsonb_typeof(claims->'amr') is distinct from 'array' then
  raise exception '首次使用请先通过邮箱验证码或邮件登录链接验证' using errcode='42501';
 end if;
 if not exists(select 1 from jsonb_array_elements(claims->'amr') a where a->>'method'='otp') then
  raise exception '首次使用请先通过邮箱验证码或邮件登录链接验证' using errcode='42501';
 end if;
 insert into public.study_verified_emails(user_id,verified_email) values(actor,current_email)
 on conflict(user_id) do update set verified_email=excluded.verified_email,verified_at=now();
 return true;
end $study_authorize$;
revoke all on function public.study_authorize_email() from public,anon,authenticated;
grant execute on function public.study_authorize_email() to authenticated;
`;
let workspace = await fs.readFile(
  "supabase/migrations/001_workspace.sql",
  "utf8",
);
workspace = workspace
  .replace(/^--[^\n]*\n/, "")
  .replace(/^begin;\s*/i, "")
  .replace(/commit;\s*$/i, "");
workspace = workspace.replaceAll(
  "using (auth.uid()=user_id)",
  "using (auth.uid()=user_id and (select public.study_has_access()))",
);
workspace = workspace.replace(
  "if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;",
  "if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;\n if not public.study_has_access() then raise exception '请先通过邮箱验证码登录，完成首次邮箱验证' using errcode='42501'; end if;",
);
await fs.writeFile("supabase/shared/00_check_math_library.sql", readOnly);
await fs.writeFile(
  "supabase/shared/01_install_shared.sql",
  `-- maths Library SHARED installation. Run ONLY after 00_check_math_library.sql matches.\n-- Atomic: any failure rolls back the entire installation; never alter auth settings.\nbegin;\nset local lock_timeout='5s';\n${check}\n${gate}\n${workspace}\ncommit;\n`,
);
await fs.writeFile(
  "supabase/shared/02_disable_shared.sql",
  `-- Disable learning app and restore the exact old math trigger. Does NOT delete data.\n-- Only use if rolling back this reviewed shared installation; it stops new email signups.\nbegin;\nset local lock_timeout='5s';\ndo $study_rollback$\ndeclare backup_trigger text; current_trigger text; expected_trigger text;\nbegin\n select previous_trigger_sql,installed_trigger_sql into strict backup_trigger,expected_trigger from public.study_shared_installation where id;\n select pg_get_triggerdef(oid) into current_trigger from pg_trigger where tgrelid='auth.users'::regclass and tgname='pp_auth_user_created';\n if current_trigger is distinct from expected_trigger then raise exception 'Trigger has changed since installation; refusing to overwrite it'; end if;\n execute 'drop trigger pp_auth_user_created on auth.users';\n execute backup_trigger;\nend $study_rollback$;\nrevoke all on public.study_workspaces,public.study_operations,public.study_verified_emails from anon,authenticated;\nrevoke all on function public.commit_study_workspace(bigint,uuid,jsonb),public.study_authorize_email(),public.study_has_access() from public,anon,authenticated;\ncommit;\n`,
);
console.log(
  "Generated read-only check, atomic shared installation, non-destructive disable script",
);

await fs.writeFile(
  "supabase/shared/03_verify_install.sql",
  `-- READ ONLY after installation: all eight results should be true. No user data returned.
select
 (select count(*)=4 from pg_class where oid in (to_regclass('public.study_workspaces'),to_regclass('public.study_operations'),to_regclass('public.study_verified_emails'),to_regclass('public.study_shared_installation'))) as study_tables_present,
 (select count(*)=3 and bool_and(relrowsecurity) from pg_class where oid in (to_regclass('public.study_workspaces'),to_regclass('public.study_operations'),to_regclass('public.study_verified_emails'))) as study_rls_enabled,
 exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.pp_new_user()') and p.prosecdef and p.prolang=(select oid from pg_language where lanname='plpgsql') and p.proconfig=array['search_path=pg_catalog']::text[] and md5(p.prosrc) in (${fingerprints})) as math_validator_unchanged,
 exists(select 1 from pg_trigger t join public.study_shared_installation i on i.id where t.tgrelid='auth.users'::regclass and t.tgname='pp_auth_user_created' and pg_get_triggerdef(t.oid)=i.installed_trigger_sql) as math_trigger_matches_install,
 (select count(*)=2 from pg_policies where schemaname='public' and ((tablename='study_workspaces' and policyname='own_workspace') or (tablename='study_operations' and policyname='own_operations')) and qual like '%study_has_access%') as verified_access_policies_present,
 not exists(select 1 from (values ('public.study_workspaces'),('public.study_operations'),('public.study_verified_emails'),('public.study_shared_installation')) t(name) cross join (values ('anon'),('authenticated')) r(name) cross join (values ('INSERT'),('UPDATE'),('DELETE')) p(name) where has_table_privilege(r.name,t.name,p.name)) as clients_cannot_write_tables,
 not has_table_privilege('authenticated','public.study_verified_emails','SELECT') and not has_table_privilege('anon','public.study_verified_emails','SELECT') and not has_table_privilege('authenticated','public.study_shared_installation','SELECT') and not has_table_privilege('anon','public.study_shared_installation','SELECT') as private_metadata_protected,
 not has_function_privilege('anon','public.commit_study_workspace(bigint,uuid,jsonb)','EXECUTE') and not has_function_privilege('anon','public.study_authorize_email()','EXECUTE') as anonymous_write_api_blocked;
`,
);

// Catalog-only recovery check: unlike the installed-state verification above,
// this remains readable when one or ALL study tables have never been created.
await fs.writeFile(
  "supabase/shared/04_diagnose_registration.sql",
  `-- READ ONLY. Catalogs only; works before, after, or during a partial installation.
-- No user records, emails, credentials, or app table contents are returned.
with counts as (
 select
  (select count(*) from pg_class where oid in (to_regclass('public.study_workspaces'),to_regclass('public.study_operations'),to_regclass('public.study_verified_emails'),to_regclass('public.study_shared_installation'))) as table_count,
  (select count(*) from pg_proc where oid in (to_regprocedure('public.study_has_access()'),to_regprocedure('public.study_authorize_email()'),to_regprocedure('public.commit_study_workspace(bigint,uuid,jsonb)'))) as function_count
)
select
 case when table_count=0 and function_count=0 then 'NOT_INSTALLED'
      when table_count=4 and function_count=3 then 'OBJECTS_PRESENT'
      else 'PARTIAL_OR_DIFFERENT' end as install_state,
 table_count as study_tables_found, function_count as study_functions_found,
 exists(select 1 from pg_trigger where tgrelid=to_regclass('auth.users') and tgname='pp_auth_user_created' and not tgisinternal and tgqual is not null) as nickname_filter_present,
 exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.pp_new_user()') and p.prosecdef and p.prolang=(select oid from pg_language where lanname='plpgsql') and p.proconfig=array['search_path=pg_catalog']::text[] and md5(p.prosrc) in (${fingerprints})) as math_validator_matches,
 (select count(*) from pg_trigger where tgrelid=to_regclass('auth.users') and not tgisinternal and (tgtype&4)=4 and tgname<>'pp_auth_user_created') as other_insert_triggers
from counts;
`,
);

// Verify all eight permissions/schema checks inside the same transaction, then
// return them to the owner. "Success. No rows returned" is no longer the only
// feedback for this installer. Any failed check rolls everything back.
const verificationSql = (
  await fs.readFile("supabase/shared/03_verify_install.sql", "utf8")
)
  .replace(/^--[^\n]*(?:\n|$)/gm, "")
  .trim()
  .replace(/;$/, "");
const verifiedCommit = `do $study_verify_before_commit$
declare checks jsonb;
begin
 select to_jsonb(v) into checks from (${verificationSql}) v;
 if checks is null or (select count(*) from jsonb_each(checks))<>8
 or exists(select 1 from jsonb_each(checks) c where c.value is distinct from 'true'::jsonb) then
  raise exception 'Shared installation verification failed; transaction rolled back: %',checks;
 end if;
end $study_verify_before_commit$;
commit;
${verificationSql};
`;
const installationFile = "supabase/shared/01_install_shared.sql";
const installationText = await fs.readFile(installationFile, "utf8");
if (!/commit;\n$/.test(installationText))
  throw Error("Installer COMMIT marker not found");
await fs.writeFile(
  installationFile,
  installationText.replace(/commit;\n$/, () => verifiedCommit),
);
