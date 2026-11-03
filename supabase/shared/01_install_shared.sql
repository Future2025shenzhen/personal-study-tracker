-- maths Library SHARED installation. Run ONLY after 00_check_math_library.sql matches.
-- Atomic: any failure rolls back the entire installation; never alter auth settings.
begin;
set local lock_timeout='5s';
do $study_preflight$
begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.pp_new_user()') and p.prosecdef and p.prosrc in ($study_legacy_source$
declare nick text; key text; expected_email text;
begin
 nick:=normalize(btrim(coalesce(new.raw_user_meta_data->>'nickname','')),NFKC);
 if nick !~ '^[A-Za-z0-9_一-鿿]{2,20}$' then raise exception '昵称须为2至20个中文、英文字母、数字或下划线'; end if;
 key:=lower(nick);
 expected_email:=encode(extensions.digest(convert_to(key,'UTF8'),'sha256'),'hex')||'@accounts.example.com';
 if lower(new.email) is distinct from expected_email then raise exception '账户标识不匹配'; end if;
 insert into public.pp_profiles(id,nickname,nickname_key) values(new.id,nick,key);
 return new;
end $study_legacy_source$, $study_owner_source$
declare
 nick text;
 key text;
 expected_email text;
begin
 nick:=normalize(
  btrim(coalesce(new.raw_user_meta_data->>'nickname','')),
  NFKC
 );

 if nick !~ '^[A-Za-z0-9_一-鿿]{2,20}$' then
  raise exception '昵称须为2至20个中文、英文字母、数字或下划线';
 end if;

 key:=lower(nick);

 expected_email:=
  encode(
   extensions.digest(convert_to(key,'UTF8'),'sha256'),
   'hex'
  )||'@accounts.example.com';

 if lower(new.email) is distinct from expected_email then
  raise exception '账户标识不匹配';
 end if;

 insert into public.pp_profiles(id,nickname,nickname_key)
 values(new.id,nick,key);

 return new;
end
$study_owner_source$)) then
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
revoke all on public.study_workspaces,public.study_operations from anon,authenticated;
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
revoke all on function public.commit_study_workspace(bigint,uuid,jsonb) from public;
grant execute on function public.commit_study_workspace(bigint,uuid,jsonb) to authenticated;

commit;
