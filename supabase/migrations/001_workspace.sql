-- Run in a NEW dedicated Supabase project. No service_role key is used by the browser.
begin;
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
create policy own_workspace on public.study_workspaces for select to authenticated using (auth.uid()=user_id);
create policy own_operations on public.study_operations for select to authenticated using (auth.uid()=user_id);
revoke all on public.study_workspaces,public.study_operations from anon,authenticated;
grant select on public.study_workspaces,public.study_operations to authenticated;
-- One account has one workspace row, hence one active timer. FOR UPDATE serializes
-- all device writes; version compare prevents stale offline snapshots overwriting data.
create function public.commit_study_workspace(expected_version bigint,operation_id uuid,next_document jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); row_data public.study_workspaces; receipt jsonb; response jsonb;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
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
