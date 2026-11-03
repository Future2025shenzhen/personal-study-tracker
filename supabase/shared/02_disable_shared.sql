-- Disable learning app and restore the exact old math trigger. Does NOT delete data.
-- Only use if rolling back this reviewed shared installation; it stops new email signups.
begin;
set local lock_timeout='5s';
do $study_rollback$
declare backup_trigger text; current_trigger text; expected_trigger text;
begin
 select previous_trigger_sql,installed_trigger_sql into strict backup_trigger,expected_trigger from public.study_shared_installation where id;
 select pg_get_triggerdef(oid) into current_trigger from pg_trigger where tgrelid='auth.users'::regclass and tgname='pp_auth_user_created';
 if current_trigger is distinct from expected_trigger then raise exception 'Trigger has changed since installation; refusing to overwrite it'; end if;
 execute 'drop trigger pp_auth_user_created on auth.users';
 execute backup_trigger;
end $study_rollback$;
revoke all on public.study_workspaces,public.study_operations,public.study_verified_emails from anon,authenticated;
revoke all on function public.commit_study_workspace(bigint,uuid,jsonb),public.study_authorize_email(),public.study_has_access() from public,anon,authenticated;
commit;
