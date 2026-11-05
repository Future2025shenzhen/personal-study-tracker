-- Run once in the Maths Library SQL Editor AFTER 01_install_shared.sql.
-- Atomic upgrade. No passwords, no global Auth settings, no changes to pp_*.
begin;
do $$ begin
 if to_regclass('public.study_shared_installation') is null then
  raise exception '请先完成共享后端安装';
 end if;
 if not exists(select 1 from pg_trigger t join public.study_shared_installation i on i.id
   where t.tgrelid='auth.users'::regclass and t.tgname='pp_auth_user_created'
   and pg_get_triggerdef(t.oid)=i.installed_trigger_sql) then
  raise exception '数学题库触发器发生变化，升级已取消';
 end if;
 if to_regclass('auth.audit_log_entries') is null then raise exception '缺少 Auth 审计表'; end if;
end $$;

create table public.study_account_config(id boolean primary key default true check(id), namespace text not null unique);
insert into public.study_account_config(namespace) values('study-'||encode(extensions.gen_random_bytes(12),'hex')||'.accounts.example.com');
create table public.study_accounts(
 user_id uuid primary key references auth.users(id) on delete cascade,
 username text not null, username_key text not null unique,
 role text not null check(role in ('user','admin')) default 'user',
 status text not null check(status in ('active','disabled','deleted')) default 'active',
 must_change_password boolean not null default false,
 created_at timestamptz not null default now()
);
create table public.study_admin_invites(
 username_key text primary key check(username_key in ('kevinwang','jackwang')),
 token_hash bytea not null, expires_at timestamptz not null,
 used_by uuid unique, used_at timestamptz
);
create table public.study_account_events(
 id uuid primary key default gen_random_uuid(), source_id uuid unique,
 user_id uuid not null, username text not null, event text not null,
 happened_at timestamptz not null default now()
);
create index on public.study_account_events(happened_at desc);
create table public.study_admin_actions(
 id uuid primary key default gen_random_uuid(), actor uuid not null,
 target uuid not null, username text not null, action text not null,
 happened_at timestamptz not null default now()
);
alter table public.study_account_config enable row level security;
alter table public.study_accounts enable row level security;
alter table public.study_admin_invites enable row level security;
alter table public.study_account_events enable row level security;
alter table public.study_admin_actions enable row level security;
revoke all on public.study_account_config,public.study_accounts,public.study_admin_invites,public.study_account_events,public.study_admin_actions from public,anon,authenticated;

create function public.study_public_account_mode() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('mode','username','namespace',namespace,'minimum_password_length',12) from public.study_account_config where id;
$$;

-- Owner only: output contains PRIVATE, single-use invitation codes (not passwords).
create function public.study_owner_create_admin_invites() returns table(username text, invitation text, expires_at timestamptz)
 language plpgsql security definer set search_path='' as $$
declare name text; secret text; deadline timestamptz;
begin
 foreach name in array array['Kevinwang','Jackwang'] loop
  if exists(select 1 from public.study_accounts a where a.username_key=lower(name)) then continue; end if;
  secret:=encode(extensions.gen_random_bytes(32),'hex'); deadline:=now()+interval '24 hours';
  insert into public.study_admin_invites as i(username_key,token_hash,expires_at) values(lower(name),extensions.digest(secret,'sha256'),deadline)
  on conflict(username_key) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at where i.used_by is null;
  if found then username:=name; invitation:=secret; expires_at:=deadline; return next; end if;
 end loop;
end $$;

create function public.study_guard_signup() returns trigger language plpgsql security definer set search_path='' as $$
declare ns text; name text; key text; expected text;
begin
 select namespace into ns from public.study_account_config where id;
 if lower(split_part(coalesce(new.email,''),'@',2))<>ns and not (coalesce(new.raw_user_meta_data,'{}') ? 'study_username') then return new; end if;
 name:=normalize(btrim(coalesce(new.raw_user_meta_data->>'study_username','')),NFKC);
 if name !~ '^[A-Za-z0-9_一-鿿]{2,24}$' or new.raw_user_meta_data ? 'nickname' then raise exception '学习账号用户名格式不正确'; end if;
 key:=lower(name);
 expected:=encode(extensions.digest(convert_to(key,'UTF8'),'sha256'),'hex')||'@'||ns;
 if lower(new.email) is distinct from expected then raise exception '学习账号标识不匹配'; end if;
 if key in ('kevinwang','jackwang') then
  update public.study_admin_invites set used_by=new.id,used_at=now()
   where username_key=key and used_by is null and expires_at>now()
   and token_hash=extensions.digest(coalesce(new.raw_user_meta_data->>'study_invite',''),'sha256');
  if not found then raise exception '管理员邀请码无效或已过期'; end if;
 end if;
 new.raw_user_meta_data:=new.raw_user_meta_data-'study_invite';
 return new;
end $$;
create function public.study_create_account() returns trigger language plpgsql security definer set search_path='' as $$
declare ns text; name text; admin boolean;
begin
 select namespace into ns from public.study_account_config where id;
 if lower(split_part(coalesce(new.email,''),'@',2))<>ns then return new; end if;
 name:=normalize(btrim(new.raw_user_meta_data->>'study_username'),NFKC);
 admin:=exists(select 1 from public.study_admin_invites where used_by=new.id and username_key=lower(name));
 insert into public.study_accounts(user_id,username,username_key,role,must_change_password)
 values(new.id,name,lower(name),case when admin then 'admin' else 'user' end,admin);
 return new;
end $$;
create trigger study_guard_signup before insert on auth.users for each row execute function public.study_guard_signup();
create trigger study_create_account after insert on auth.users for each row execute function public.study_create_account();

create function public.study_password_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.encrypted_password is distinct from old.encrypted_password then
  update public.study_accounts set must_change_password=false where user_id=new.id and must_change_password;
 end if;
 return new;
end $$;
create trigger study_password_changed after update of encrypted_password on auth.users for each row execute function public.study_password_changed();

create or replace function public.study_has_access() returns boolean language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.study_accounts where user_id=auth.uid()) then
  exists(select 1 from public.study_accounts a join auth.users u on u.id=a.user_id cross join public.study_account_config c
   where a.user_id=auth.uid() and a.status='active' and not a.must_change_password
   and lower(u.email)=encode(extensions.digest(convert_to(a.username_key,'UTF8'),'sha256'),'hex')||'@'||c.namespace)
 else exists(select 1 from public.study_verified_emails v join auth.users u on u.id=v.user_id
  where v.user_id=auth.uid() and lower(u.email)=v.verified_email and lower(split_part(u.email,'@',2))<>'accounts.example.com'
  and lower(split_part(u.email,'@',2))<>(select namespace from public.study_account_config where id)) end;
$$;
create function public.study_account_identity() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.study_accounts; address text; ns text;
begin
 select * into a from public.study_accounts where user_id=auth.uid();
 if not found then return null; end if;
 if a.status<>'active' then raise exception '账号已停用或删除，请联系管理员' using errcode='42501'; end if;
 select email into address from auth.users where id=auth.uid(); select namespace into ns from public.study_account_config where id;
 if lower(address) is distinct from encode(extensions.digest(convert_to(a.username_key,'UTF8'),'sha256'),'hex')||'@'||ns then
  raise exception '账号标识已改变，请联系管理员' using errcode='42501';
 end if;
 return jsonb_build_object('username',a.username,'role',a.role,'must_change_password',a.must_change_password);
end $$;
create function public.study_require_admin() returns void language plpgsql stable security definer set search_path='' as $$
begin
 if not public.study_has_access() or not exists(select 1 from public.study_accounts where user_id=auth.uid() and role='admin') then
  raise exception '需要管理员权限' using errcode='42501';
 end if;
end $$;
create function public.study_admin_users(search text default '',page integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.study_require_admin();
 return (select coalesce(jsonb_agg(x),'[]') from (select a.*,u.last_sign_in_at as last_login,
  (select max(happened_at) from public.study_account_events e where e.user_id=a.user_id and event='logout') as last_logout
  from public.study_accounts a join auth.users u on u.id=a.user_id
  where a.username_key like '%'||lower(left(search,100))||'%' order by a.created_at desc,a.user_id limit 25 offset greatest(0,least(page,100000))*25) x);
end $$;
create function public.study_admin_events(target uuid default null,page integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.study_require_admin();
 return (select coalesce(jsonb_agg(x),'[]') from (select user_id,username,event,happened_at from public.study_account_events
  where (target is null or user_id=target) and happened_at>now()-interval '180 days'
  order by happened_at desc,id limit 50 offset greatest(0,least(page,100000))*50) x);
end $$;
create function public.study_admin_manage(target uuid, action text, confirmation text default '') returns void language plpgsql security definer set search_path='' as $$
declare a public.study_accounts;
begin
 -- Lock the actor too: another admin cannot change this actor during the operation.
 perform 1 from public.study_accounts where user_id=auth.uid() for update;
 perform public.study_require_admin();
 select * into a from public.study_accounts where user_id=target for update;
 if not found or a.role<>'user' or a.user_id=auth.uid() then raise exception '仅可管理本网站的普通账号'; end if;
 if exists(select 1 from public.pp_profiles where id=target) then raise exception '禁止操作数学题库账号'; end if;
 if not exists(select 1 from auth.users u cross join public.study_account_config c where u.id=target
  and lower(u.email)=encode(extensions.digest(convert_to(a.username_key,'UTF8'),'sha256'),'hex')||'@'||c.namespace) then raise exception '账号范围校验失败'; end if;
 if action='purge' then
  if a.status<>'deleted' or confirmation<>a.username then raise exception '请先移入回收站并输入完整用户名'; end if;
 elsif action not in ('disable','enable','delete','restore') then raise exception '未知操作';
 elsif a.status='deleted' and action<>'restore' then raise exception '请先恢复回收站账号';
 elsif action='restore' and a.status<>'deleted' then raise exception '账号不在回收站';
 end if;
 insert into public.study_admin_actions(actor,target,username,action) values(auth.uid(),target,a.username,action);
 if action='purge' then delete from auth.users where id=target;
 else update public.study_accounts set status=case when action='disable' then 'disabled' when action='delete' then 'deleted' else 'active' end where user_id=target; end if;
end $$;

-- Mirror AUTH SERVICE audit events only. Browsers cannot write these tables.
-- When hosted Auth disables PostgreSQL audit storage, last_login still comes
-- from auth.users; absence of a logout record is shown honestly in the UI.
create function public.study_capture_auth_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.payload->>'action' in ('login','logout','user_signedup') then
  insert into public.study_account_events(source_id,user_id,username,event,happened_at)
   select new.id,a.user_id,a.username,new.payload->>'action',coalesce(new.created_at,now())
   from public.study_accounts a where a.user_id::text=new.payload->>'actor_id'
   on conflict(source_id) do nothing;
  delete from public.study_account_events where happened_at<now()-interval '180 days';
 end if;
 return new;
end $$;
create trigger study_capture_auth_event after insert on auth.audit_log_entries for each row execute function public.study_capture_auth_event();

-- Hosted Auth can disable its PostgreSQL audit trail. last_sign_in_at is still
-- written by Auth after successful password login; never trust client clocks.
create function public.study_capture_login() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.last_sign_in_at is not null and new.last_sign_in_at is distinct from old.last_sign_in_at then
  insert into public.study_account_events(user_id,username,event,happened_at)
   select a.user_id,a.username,'login',new.last_sign_in_at from public.study_accounts a where a.user_id=new.id
   and not exists(select 1 from public.study_account_events e where e.user_id=new.id and e.event='login' and e.happened_at>now()-interval '5 seconds');
  delete from public.study_account_events where happened_at<now()-interval '180 days';
 end if;
 return new;
end $$;
create trigger study_capture_login after update of last_sign_in_at on auth.users for each row execute function public.study_capture_login();

-- Called using the just-ended session's still-signed JWT, AFTER Auth logout.
-- Prove that Auth removed that exact session before recording a logout.
create function public.study_record_logout() returns void language plpgsql security definer set search_path='' as $$
declare session uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
begin
 if session is null or auth.uid() is null then raise exception '缺少会话标识' using errcode='42501'; end if;
 if exists(select 1 from auth.sessions where id=session) then raise exception '会话尚未退出' using errcode='42501'; end if;
 insert into public.study_account_events(source_id,user_id,username,event)
  select session,a.user_id,a.username,'logout' from public.study_accounts a where a.user_id=auth.uid()
  and not exists(select 1 from public.study_account_events e where e.user_id=auth.uid() and e.event='logout' and e.happened_at>now()-interval '5 seconds')
 on conflict(source_id) do nothing;
end $$;

-- Supabase may have explicit default grants: revoke all, then allow only APIs.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('study_public_account_mode','study_owner_create_admin_invites','study_guard_signup','study_create_account','study_password_changed','study_account_identity','study_require_admin','study_admin_users','study_admin_events','study_admin_manage','study_capture_auth_event','study_capture_login','study_record_logout') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
end $$;
grant execute on function public.study_public_account_mode() to anon,authenticated;
grant execute on function public.study_account_identity(),public.study_admin_users(text,integer),public.study_admin_events(uuid,integer),public.study_admin_manage(uuid,text,text) to authenticated;
grant execute on function public.study_record_logout() to authenticated;
commit;
select true as username_accounts_installed, public.study_public_account_mode()->>'mode' as mode;
