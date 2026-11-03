-- READ ONLY: safe to run in maths Library SQL Editor. No user emails or data are returned.
select
 exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.pp_new_user()') and p.prosecdef and p.prolang=(select oid from pg_language where lanname='plpgsql') and p.proconfig=array['search_path=pg_catalog']::text[] and md5(p.prosrc) in ('a5f606ebffd818001d6ae7b2457f0e3a','c023595549fa4e936e448a02edf3ea30','10b3e94a26bd7e25defe5891e86198b7')) as math_validator_matches,
 exists(select 1 from pg_trigger t where t.tgrelid='auth.users'::regclass and t.tgname='pp_auth_user_created' and t.tgfoid=to_regprocedure('public.pp_new_user()') and t.tgtype=5 and t.tgenabled='O' and t.tgnargs=0 and t.tgqual is null) as math_trigger_matches,
 to_regclass('public.study_workspaces') is not null as study_already_installed,
 (select count(*) from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal and (tgtype&4)=4 and tgname<>'pp_auth_user_created') as other_insert_triggers;
