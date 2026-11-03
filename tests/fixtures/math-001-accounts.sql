-- Run in the SQL Editor of a dedicated Supabase project. No browser secret is required.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.pp_profiles(
 id uuid primary key references auth.users(id) on delete cascade,
 nickname text not null,
 nickname_key text not null unique,
 created_at timestamptz not null default now(),
 last_seen_at timestamptz,
 visits bigint not null default 0,
 last_device text check(last_device in ('mobile','tablet','desktop'))
);
create table if not exists public.pp_admins(user_id uuid primary key references public.pp_profiles(id) on delete cascade);
create table if not exists public.pp_question_catalog(id text primary key,kind text not null check(kind in ('original','past')),stage text not null check(stage in ('P1','P2','P3')));
create table if not exists public.pp_records(
 user_id uuid not null references public.pp_profiles(id) on delete cascade,
 question_id text not null references public.pp_question_catalog(id),
 saved boolean not null default false,
 done boolean not null default false,
 version bigint not null default 0,
 updated_at timestamptz not null default now(),
 primary key(user_id,question_id)
);
create table if not exists public.pp_practice_papers(user_id uuid primary key references public.pp_profiles(id) on delete cascade,paper jsonb,version bigint not null default 0,updated_at timestamptz not null default now());
create table if not exists public.pp_activity(
 id bigint generated always as identity primary key,
 user_id uuid not null references public.pp_profiles(id) on delete cascade,
 occurred_at timestamptz not null default now(),
 kind text not null check(kind in ('visit','solution','book')),
 page text not null check(page in ('original','past','saved','papers','books','account','admin')),
 question_id text references public.pp_question_catalog(id),
 device text not null check(device in ('mobile','tablet','desktop'))
);
create index if not exists pp_activity_user_time on public.pp_activity(user_id,occurred_at desc);
create index if not exists pp_profiles_seen on public.pp_profiles(last_seen_at desc);
alter table public.pp_profiles enable row level security;
alter table public.pp_admins enable row level security;
alter table public.pp_question_catalog enable row level security;
alter table public.pp_records enable row level security;
alter table public.pp_practice_papers enable row level security;
alter table public.pp_activity enable row level security;
revoke all on public.pp_profiles,public.pp_admins,public.pp_question_catalog,public.pp_records,public.pp_practice_papers,public.pp_activity from anon,authenticated;
-- Only self reads are available directly; every write and every admin read uses checked RPCs.
grant select on public.pp_profiles,public.pp_records,public.pp_practice_papers to authenticated;
drop policy if exists pp_self_profile on public.pp_profiles;
create policy pp_self_profile on public.pp_profiles for select to authenticated using(id=auth.uid());
drop policy if exists pp_self_records on public.pp_records;
create policy pp_self_records on public.pp_records for select to authenticated using(user_id=auth.uid());
drop policy if exists pp_self_paper on public.pp_practice_papers;
create policy pp_self_paper on public.pp_practice_papers for select to authenticated using(user_id=auth.uid());

create or replace function public.pp_is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$select exists(select 1 from public.pp_admins where user_id=auth.uid())$$;
revoke all on function public.pp_is_admin() from public,anon,authenticated;

create or replace function public.pp_new_user() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare nick text; key text; expected_email text;
begin
 nick:=normalize(btrim(coalesce(new.raw_user_meta_data->>'nickname','')),NFKC);
 if nick !~ '^[A-Za-z0-9_一-鿿]{2,20}$' then raise exception '昵称须为2至20个中文、英文字母、数字或下划线'; end if;
 key:=lower(nick);
 expected_email:=encode(extensions.digest(convert_to(key,'UTF8'),'sha256'),'hex')||'@accounts.example.com';
 if lower(new.email) is distinct from expected_email then raise exception '账户标识不匹配'; end if;
 insert into public.pp_profiles(id,nickname,nickname_key) values(new.id,nick,key);
 return new;
end $$;
revoke all on function public.pp_new_user() from public,anon,authenticated;
drop trigger if exists pp_auth_user_created on auth.users;
create trigger pp_auth_user_created after insert on auth.users for each row execute function public.pp_new_user();

create or replace function public.pp_snapshot() returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid(); result jsonb;
begin
 if uid is null then raise sqlstate 'PT401' using message='请先登录'; end if;
 select jsonb_build_object('profile',jsonb_build_object('id',p.id,'nickname',p.nickname,'created_at',p.created_at,'is_admin',exists(select 1 from public.pp_admins a where a.user_id=uid)),
 'records',coalesce((select jsonb_agg(jsonb_build_object('question_id',r.question_id,'saved',r.saved,'done',r.done,'version',r.version)) from public.pp_records r where r.user_id=uid),'[]'::jsonb),
 'paper',coalesce((select jsonb_build_object('value',s.paper,'version',s.version) from public.pp_practice_papers s where s.user_id=uid),'{"value":null,"version":0}'::jsonb)) into result from public.pp_profiles p where p.id=uid;
 if result is null then raise sqlstate 'PT403' using message='账户资料尚未建立，请联系管理员'; end if;
 return result;
end $$;

create or replace function public.pp_apply_records(p_changes jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid(); c jsonb; r public.pp_records; result jsonb:='[]'; expected bigint; qid text;
begin
 if uid is null then raise sqlstate 'PT401' using message='请先登录'; end if;
 if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes)>1200 then raise sqlstate 'PT400' using message='记录请求格式不正确'; end if;
 if exists(select 1 from jsonb_array_elements(p_changes) v group by v->>'question_id' having count(*)>1) then raise sqlstate 'PT400' using message='同一请求不能重复修改同一道题'; end if;
 for c in select value from jsonb_array_elements(p_changes) order by value->>'question_id' loop
  qid:=c->>'question_id'; expected:=(c->>'base_version')::bigint;
  if expected is null or expected<0 or not exists(select 1 from public.pp_question_catalog where id=qid) then raise sqlstate 'PT400' using message='无效题号或版本'; end if;
  if not(c?'saved' or c?'done') or (c?'saved' and jsonb_typeof(c->'saved')<>'boolean') or (c?'done' and jsonb_typeof(c->'done')<>'boolean') then raise sqlstate 'PT400' using message='记录字段须为布尔值'; end if;
  insert into public.pp_records(user_id,question_id) values(uid,qid) on conflict do nothing;
  select * into r from public.pp_records where user_id=uid and question_id=qid for update;
  if r.version<>expected then raise sqlstate 'PT409' using message='另一设备已修改这道题，已为你重新读取云端记录，请重试'; end if;
  update public.pp_records set saved=case when c?'saved' then (c->>'saved')::boolean else saved end,done=case when c?'done' then (c->>'done')::boolean else done end,version=version+1,updated_at=now() where user_id=uid and question_id=qid returning * into r;
  result:=result||jsonb_build_array(jsonb_build_object('question_id',qid,'saved',r.saved,'done',r.done,'version',r.version));
 end loop;
 return result;
end $$;

create or replace function public.pp_save_paper(p_paper jsonb,p_base_version bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid(); r public.pp_practice_papers;
begin
 if uid is null then raise sqlstate 'PT401' using message='请先登录'; end if;
 if p_paper is not null then
  if jsonb_typeof(p_paper) is distinct from 'object' or jsonb_typeof(p_paper->'ids') is distinct from 'array' then raise sqlstate 'PT400' using message='试卷格式不正确'; end if;
  if jsonb_array_length(p_paper->'ids')<1 or jsonb_array_length(p_paper->'ids')>100 or length(p_paper::text)>20000 then raise sqlstate 'PT400' using message='试卷大小不正确'; end if;
  if exists(select 1 from jsonb_array_elements_text(p_paper->'ids') v where not exists(select 1 from public.pp_question_catalog q where q.id=v and q.kind='original' and q.stage=p_paper->>'stage')) then raise sqlstate 'PT400' using message='试卷题号不正确'; end if;
 end if;
 insert into public.pp_practice_papers(user_id) values(uid) on conflict do nothing;
 select * into r from public.pp_practice_papers where user_id=uid for update;
 if p_base_version is null or r.version<>p_base_version then raise sqlstate 'PT409' using message='另一设备已更新练习卷，请重新加载后重试'; end if;
 update public.pp_practice_papers set paper=p_paper,version=version+1,updated_at=now() where user_id=uid returning * into r;
 return jsonb_build_object('value',r.paper,'version',r.version);
end $$;

create or replace function public.pp_activity_ping(p_kind text,p_page text,p_question_id text default null,p_device text default 'desktop') returns void language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid(); last_event timestamptz;
begin
 if uid is null then raise sqlstate 'PT401' using message='请先登录'; end if;
 if p_kind is null or p_page is null or p_device is null or p_kind not in ('heartbeat','visit','solution','book') or p_page not in ('original','past','saved','papers','books','account','admin') or p_device not in ('mobile','tablet','desktop') then raise sqlstate 'PT400' using message='活动类型不正确'; end if;
 if p_question_id is not null and not exists(select 1 from public.pp_question_catalog where id=p_question_id) then raise sqlstate 'PT400' using message='题号不正确'; end if;
 -- Serialize analytics for this user, limiting duplicates from repeated renders/tabs.
 perform 1 from public.pp_profiles where id=uid for update;
 update public.pp_profiles set last_seen_at=now(),last_device=p_device where id=uid;
 if p_kind='heartbeat' then return; end if;
 select max(occurred_at) into last_event from public.pp_activity where user_id=uid and kind=p_kind and page=p_page and question_id is not distinct from p_question_id;
 if last_event>now()-interval '15 seconds' then return; end if;
 insert into public.pp_activity(user_id,kind,page,question_id,device) values(uid,p_kind,p_page,p_question_id,p_device);
 if p_kind='visit' then update public.pp_profiles set visits=visits+1 where id=uid; end if;
 -- Keep only the latest 200 detail events per account; cumulative visits remain.
 delete from public.pp_activity where user_id=uid and id in(select id from public.pp_activity where user_id=uid order by occurred_at desc,id desc offset 200);
end $$;

create or replace function public.pp_admin_users(p_search text default '',p_offset integer default 0,p_limit integer default 30) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 if not public.pp_is_admin() then raise sqlstate 'PT403' using message='仅管理员可访问'; end if;
 if p_search is null or p_offset is null or p_limit is null or length(p_search)>40 or p_offset<0 or p_limit<1 or p_limit>100 then raise sqlstate 'PT400' using message='查询范围不正确'; end if;
 select jsonb_build_object('total',(select count(*) from public.pp_profiles p where position(lower(p_search) in lower(p.nickname))>0),
 'users',coalesce((select jsonb_agg(to_jsonb(t)) from (select p.id,p.nickname,p.created_at,p.last_seen_at,p.visits,p.last_device,exists(select 1 from public.pp_admins a where a.user_id=p.id) as is_admin,
 (select count(*) from public.pp_records r where r.user_id=p.id and r.done) as done_count,
 (select count(*) from public.pp_records r where r.user_id=p.id and r.saved) as saved_count
 from public.pp_profiles p where position(lower(p_search) in lower(p.nickname))>0 order by p.last_seen_at desc nulls last,p.created_at desc limit p_limit offset p_offset) t),'[]'::jsonb)) into result;
 return result;
end $$;
create or replace function public.pp_admin_activity(p_user_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not public.pp_is_admin() then raise sqlstate 'PT403' using message='仅管理员可访问'; end if;
 return coalesce((select jsonb_agg(to_jsonb(t)) from (select occurred_at,kind,page,question_id,device from public.pp_activity where user_id=p_user_id order by occurred_at desc,id desc limit 200)t),'[]'::jsonb);
end $$;
revoke all on function public.pp_snapshot(),public.pp_apply_records(jsonb),public.pp_save_paper(jsonb,bigint),public.pp_activity_ping(text,text,text,text),public.pp_admin_users(text,integer,integer),public.pp_admin_activity(uuid) from public,anon,authenticated;
grant execute on function public.pp_snapshot(),public.pp_apply_records(jsonb),public.pp_save_paper(jsonb,bigint),public.pp_activity_ping(text,text,text,text),public.pp_admin_users(text,integer,integer),public.pp_admin_activity(uuid) to authenticated;
