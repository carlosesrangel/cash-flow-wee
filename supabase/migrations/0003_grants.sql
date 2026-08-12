-- Task 12 fix: migration 0001/0002 enabled RLS on public tables but never
-- granted base table privileges to the anon/authenticated/service_role
-- roles. Postgres requires both a table-level GRANT and a passing RLS
-- policy for a query to succeed — without the GRANT, every request from
-- the app (via PostgREST, using the authenticated/service_role JWT roles)
-- fails with "permission denied for table ..." regardless of RLS policies,
-- which broke the post-login session check in lib/auth/session.ts.

grant usage on schema public to postgres, anon, authenticated, service_role;

grant all on all tables in schema public to postgres, anon, authenticated, service_role;
grant all on all sequences in schema public to postgres, anon, authenticated, service_role;
grant all on all routines in schema public to postgres, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on routines to postgres, anon, authenticated, service_role;
