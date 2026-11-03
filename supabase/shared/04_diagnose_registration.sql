-- READ ONLY. Catalogs only; works before, after, or during a partial installation.
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
 exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.pp_new_user()') and p.prosecdef and p.prolang=(select oid from pg_language where lanname='plpgsql') and p.proconfig=array['search_path=pg_catalog']::text[] and md5(p.prosrc) in ('a5f606ebffd818001d6ae7b2457f0e3a','c023595549fa4e936e448a02edf3ea30','10b3e94a26bd7e25defe5891e86198b7')) as math_validator_matches,
 (select count(*) from pg_trigger where tgrelid=to_regclass('auth.users') and not tgisinternal and (tgtype&4)=4 and tgname<>'pp_auth_user_created') as other_insert_triggers
from counts;
