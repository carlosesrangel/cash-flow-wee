-- Tighten the over-broad grants issued by 0003_grants.sql.
--
-- 0003 granted ALL (including TRUNCATE, which is NOT subject to RLS) on all
-- tables/sequences/routines to anon/authenticated/service_role, and mirrored
-- that with ALTER DEFAULT PRIVILEGES so every future table/sequence/routine
-- would inherit the same over-broad grants automatically. This migration
-- narrows anon/authenticated down to the minimum required:
--   - tables: SELECT, INSERT, UPDATE, DELETE only (no TRUNCATE/REFERENCES/TRIGGER)
--   - sequences: none (schema uses gen_random_uuid() defaults, no serial/identity columns)
--   - routines: none by default; EXECUTE is re-granted explicitly, only for the
--     two RLS-support functions actually referenced from policy expressions.
--
-- service_role and postgres are left untouched — they are legitimately
-- privileged server-side roles. RLS policies themselves are not touched here.

-- Tables: drop ALL, re-grant DML only.
revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to anon, authenticated;

-- Sequences: not needed (no serial/identity columns; PKs are UUIDs).
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

-- Routines: revoke blanket EXECUTE, then explicitly re-grant only the
-- RLS-support functions that policies call directly. Do NOT grant EXECUTE on
-- handle_new_user() — it is only invoked via trigger and needs no direct
-- caller privilege.
revoke all on all routines in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on routines from anon, authenticated;

grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.current_org_role(uuid) to authenticated;
