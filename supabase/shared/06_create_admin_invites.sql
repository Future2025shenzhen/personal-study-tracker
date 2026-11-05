-- PRIVATE RESULTS: do not share screenshots of invitation codes.
-- Only run as the project owner in SQL Editor after 05_username_accounts.sql.
-- Codes expire after 24 hours; running again replaces unused codes.
select * from public.study_owner_create_admin_invites();
