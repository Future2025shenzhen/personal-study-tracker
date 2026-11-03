-- maths Library SHARED installation. Run ONLY after 00_check_math_library.sql matches.
-- Atomic: any failure rolls back the entire installation; never alter auth settings.
begin;
set local lock_timeout='5s';
do $study_preflight$
begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.pp_new_user()') and p.prosecdef and p.prolang=(select oid from pg_language where lanname='plpgsql') and p.proconfig=array['search_path=pg_catalog']::text[] and p.prosrc in (E'\ndeclare nick text; key text; expected_email text;\nbegin\n nick:=normalize(btrim(coalesce(new.raw_user_meta_data->>''nickname'','''')),NFKC);\n if nick !~ ''^[A-Za-z0-9_一-鿿]{2,20}$'' then raise exception ''昵称须为2至20个中文、英文字母、数字或下划线''; end if;\n key:=lower(nick);\n expected_email:=encode(extensions.digest(convert_to(key,''UTF8''),''sha256''),''hex'')||''@accounts.example.com'';\n if lower(new.email) is distinct from expected_email then raise exception ''账户标识不匹配''; end if;\n insert into public.pp_profiles(id,nickname,nickname_key) values(new.id,nick,key);\n return new;\nend ', E'\ndeclare\n nick text;\n key text;\n expected_email text;\nbegin\n nick:=normalize(\n  btrim(coalesce(new.raw_user_meta_data->>''nickname'','''')),\n  NFKC\n );\n\n if nick !~ ''^[A-Za-z0-9_一-鿿]{2,20}$'' then\n  raise exception ''昵称须为2至20个中文、英文字母、数字或下划线'';\n end if;\n\n key:=lower(nick);\n\n expected_email:=\n  encode(\n   extensions.digest(convert_to(key,''UTF8''),''sha256''),\n   ''hex''\n  )||''@accounts.example.com'';\n\n if lower(new.email) is distinct from expected_email then\n  raise exception ''账户标识不匹配'';\n end if;\n\n insert into public.pp_profiles(id,nickname,nickname_key)\n values(new.id,nick,key);\n\n return new;\nend\n', E'\r\ndeclare\r\n nick text;\r\n key text;\r\n expected_email text;\r\nbegin\r\n nick:=normalize(\r\n  btrim(coalesce(new.raw_user_meta_data->>''nickname'','''')),\r\n  NFKC\r\n );\r\n\r\n if nick !~ ''^[A-Za-z0-9_一-鿿]{2,20}$'' then\r\n  raise exception ''昵称须为2至20个中文、英文字母、数字或下划线'';\r\n end if;\r\n\r\n key:=lower(nick);\r\n\r\n expected_email:=\r\n  encode(\r\n   extensions.digest(convert_to(key,''UTF8''),''sha256''),\r\n   ''hex''\r\n  )||''@accounts.example.com'';\r\n\r\n if lower(new.email) is distinct from expected_email then\r\n  raise exception ''账户标识不匹配'';\r\n end if;\r\n\r\n insert into public.pp_profiles(id,nickname,nickname_key)\r\n values(new.id,nick,key);\r\n\r\n return new;\r\nend\r\n')) then
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
end $study_preflight$;

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

create table public.study_workspaces (
 user_id uuid primary key references auth.users(id) on delete cascade,
 version bigint not null default 0 check (version >= 0),
 document jsonb not null check (jsonb_typeof(document)='object' and document ?& array['schema','subjects','sessions','tasks','goals','timer','settings'] and document->>'schema'='1' and jsonb_typeof(document->'subjects')='array' and jsonb_typeof(document->'sessions')='array' and jsonb_typeof(document->'tasks')='array' and jsonb_typeof(document->'goals')='array' and jsonb_typeof(document->'settings')='object' and (document->'timer'='null'::jsonb or jsonb_typeof(document->'timer')='object')),
 updated_at timestamptz not null default now()
);
create table public.study_operations (
 user_id uuid not null references auth.users(id) on delete cascade,
 operation_id uuid not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(user_id,operation_id)
);
alter table public.study_workspaces enable row level security;
alter table public.study_operations enable row level security;
create policy own_workspace on public.study_workspaces for select to authenticated using (auth.uid()=user_id and (select public.study_has_access()));
create policy own_operations on public.study_operations for select to authenticated using (auth.uid()=user_id and (select public.study_has_access()));
revoke all on public.study_workspaces,public.study_operations from public,anon,authenticated;
grant select on public.study_workspaces,public.study_operations to authenticated;
-- One account has one workspace row, hence one active timer. FOR UPDATE serializes
-- all device writes; version compare prevents stale offline snapshots overwriting data.
create function public.commit_study_workspace(expected_version bigint,operation_id uuid,next_document jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); row_data public.study_workspaces; receipt jsonb; response jsonb;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if not public.study_has_access() then raise exception '请先通过邮箱验证码登录，完成首次邮箱验证' using errcode='42501'; end if;
 if expected_version is null or expected_version < 0 or operation_id is null or next_document is null or octet_length(next_document::text)>5000000 then raise exception 'Invalid operation'; end if;
 -- Create once; a concurrent initialization waits for the unique user_id constraint.
 insert into public.study_workspaces(user_id,document) values(actor,'{"schema":1,"subjects":[],"sessions":[],"tasks":[],"goals":[],"timer":null,"settings":{"theme":"system"}}') on conflict do nothing;
 select * into row_data from public.study_workspaces where user_id=actor for update;
 select o.result into receipt from public.study_operations o where o.user_id=actor and o.operation_id=commit_study_workspace.operation_id;
 if receipt is not null then return jsonb_build_object('conflict', (receipt->>'version')::bigint <> row_data.version,'version',row_data.version,'document',row_data.document); end if;
 if row_data.version<>expected_version then
  return jsonb_build_object('conflict',true,'version',row_data.version,'document',row_data.document);
 end if;
 update public.study_workspaces set document=next_document,version=version+1,updated_at=now() where user_id=actor returning * into row_data;
 response:=jsonb_build_object('conflict',false,'version',row_data.version,'document',row_data.document);
 insert into public.study_operations(user_id,operation_id,result) values(actor,operation_id,jsonb_build_object('version',row_data.version));
 return response;
end $$;
revoke all on function public.commit_study_workspace(bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.commit_study_workspace(bigint,uuid,jsonb) to authenticated;

do $study_verify_before_commit$
declare checks jsonb;
begin
 select to_jsonb(v) into checks from (select
 (select count(*)=4 from pg_class where oid in (to_regclass('public.study_workspaces'),to_regclass('public.study_operations'),to_regclass('public.study_verified_emails'),to_regclass('public.study_shared_installation'))) as study_tables_present,
 (select count(*)=3 and bool_and(relrowsecurity) from pg_class where oid in (to_regclass('public.study_workspaces'),to_regclass('public.study_operations'),to_regclass('public.study_verified_emails'))) as study_rls_enabled,
 exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.pp_new_user()') and p.prosecdef and p.prolang=(select oid from pg_language where lanname='plpgsql') and p.proconfig=array['search_path=pg_catalog']::text[] and md5(p.prosrc) in ('a5f606ebffd818001d6ae7b2457f0e3a','c023595549fa4e936e448a02edf3ea30','10b3e94a26bd7e25defe5891e86198b7')) as math_validator_unchanged,
 exists(select 1 from pg_trigger t join public.study_shared_installation i on i.id where t.tgrelid='auth.users'::regclass and t.tgname='pp_auth_user_created' and pg_get_triggerdef(t.oid)=i.installed_trigger_sql) as math_trigger_matches_install,
 (select count(*)=2 from pg_policies where schemaname='public' and ((tablename='study_workspaces' and policyname='own_workspace') or (tablename='study_operations' and policyname='own_operations')) and qual like '%study_has_access%') as verified_access_policies_present,
 not exists(select 1 from (values ('public.study_workspaces'),('public.study_operations'),('public.study_verified_emails'),('public.study_shared_installation')) t(name) cross join (values ('anon'),('authenticated')) r(name) cross join (values ('INSERT'),('UPDATE'),('DELETE')) p(name) where has_table_privilege(r.name,t.name,p.name)) as clients_cannot_write_tables,
 not has_table_privilege('authenticated','public.study_verified_emails','SELECT') and not has_table_privilege('anon','public.study_verified_emails','SELECT') and not has_table_privilege('authenticated','public.study_shared_installation','SELECT') and not has_table_privilege('anon','public.study_shared_installation','SELECT') as private_metadata_protected,
 not has_function_privilege('anon','public.commit_study_workspace(bigint,uuid,jsonb)','EXECUTE') and not has_function_privilege('anon','public.study_authorize_email()','EXECUTE') as anonymous_write_api_blocked) v;
 if checks is null or (select count(*) from jsonb_each(checks))<>8
 or exists(select 1 from jsonb_each(checks) c where c.value is distinct from 'true'::jsonb) then
  raise exception 'Shared installation verification failed; transaction rolled back: %',checks;
 end if;
end $study_verify_before_commit$;
commit;
select
 (select count(*)=4 from pg_class where oid in (to_regclass('public.study_workspaces'),to_regclass('public.study_operations'),to_regclass('public.study_verified_emails'),to_regclass('public.study_shared_installation'))) as study_tables_present,
 (select count(*)=3 and bool_and(relrowsecurity) from pg_class where oid in (to_regclass('public.study_workspaces'),to_regclass('public.study_operations'),to_regclass('public.study_verified_emails'))) as study_rls_enabled,
 exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.pp_new_user()') and p.prosecdef and p.prolang=(select oid from pg_language where lanname='plpgsql') and p.proconfig=array['search_path=pg_catalog']::text[] and md5(p.prosrc) in ('a5f606ebffd818001d6ae7b2457f0e3a','c023595549fa4e936e448a02edf3ea30','10b3e94a26bd7e25defe5891e86198b7')) as math_validator_unchanged,
 exists(select 1 from pg_trigger t join public.study_shared_installation i on i.id where t.tgrelid='auth.users'::regclass and t.tgname='pp_auth_user_created' and pg_get_triggerdef(t.oid)=i.installed_trigger_sql) as math_trigger_matches_install,
 (select count(*)=2 from pg_policies where schemaname='public' and ((tablename='study_workspaces' and policyname='own_workspace') or (tablename='study_operations' and policyname='own_operations')) and qual like '%study_has_access%') as verified_access_policies_present,
 not exists(select 1 from (values ('public.study_workspaces'),('public.study_operations'),('public.study_verified_emails'),('public.study_shared_installation')) t(name) cross join (values ('anon'),('authenticated')) r(name) cross join (values ('INSERT'),('UPDATE'),('DELETE')) p(name) where has_table_privilege(r.name,t.name,p.name)) as clients_cannot_write_tables,
 not has_table_privilege('authenticated','public.study_verified_emails','SELECT') and not has_table_privilege('anon','public.study_verified_emails','SELECT') and not has_table_privilege('authenticated','public.study_shared_installation','SELECT') and not has_table_privilege('anon','public.study_shared_installation','SELECT') as private_metadata_protected,
 not has_function_privilege('anon','public.commit_study_workspace(bigint,uuid,jsonb)','EXECUTE') and not has_function_privilege('anon','public.study_authorize_email()','EXECUTE') as anonymous_write_api_blocked;
