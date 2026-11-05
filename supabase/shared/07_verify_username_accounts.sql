-- Read-only, no private codes, passwords or user records in results.
select
 public.study_public_account_mode()->>'mode'='username' as username_mode_enabled,
 exists(select 1 from pg_trigger t join public.study_shared_installation i on i.id
  where t.tgrelid='auth.users'::regclass and t.tgname='pp_auth_user_created'
  and pg_get_triggerdef(t.oid)=i.installed_trigger_sql) as maths_trigger_preserved,
 (select count(*)=5 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
  and c.relname in ('study_account_config','study_accounts','study_admin_invites','study_account_events','study_admin_actions') and c.relrowsecurity) as private_tables_rls_enabled,
 not has_table_privilege('authenticated','public.study_accounts','UPDATE')
  and not has_table_privilege('anon','public.study_admin_invites','SELECT') as client_roles_cannot_grant_admin,
 not has_function_privilege('authenticated','public.study_owner_create_admin_invites()','EXECUTE')
  and not has_function_privilege('anon','public.study_admin_users(text,integer)','EXECUTE') as privileged_apis_protected,
 (select count(*)=5 from pg_trigger where not tgisinternal and tgname in ('study_guard_signup','study_create_account','study_password_changed','study_capture_login','study_capture_auth_event')) as account_triggers_installed;
