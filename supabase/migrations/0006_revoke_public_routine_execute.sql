-- 0004_tighten_grants.sql revoked EXECUTE on all routines from anon and
-- authenticated, then re-granted it explicitly for the two RLS-support
-- functions. That revoke was a no-op in practice: Postgres grants EXECUTE
-- on every newly created function to the implicit PUBLIC pseudo-role by
-- default, and anon/authenticated inherit PUBLIC's privileges. Revoking
-- from the named roles never touched the PUBLIC grant, so every routine in
-- schema public (including handle_new_user()) remained callable by anyone
-- who can reach PostgREST or connect directly, via the PUBLIC fallback.
--
-- Fix: revoke EXECUTE from PUBLIC itself (not just from anon/authenticated),
-- and default-revoke it for routines created in the future. The explicit
-- `grant execute ... to authenticated` statements from 0004 are untouched by
-- this and remain in effect, so is_org_member() and current_org_role() stay
-- callable by authenticated — just no longer via the PUBLIC leak.

revoke all on all routines in schema public from public;

alter default privileges for role postgres in schema public
  revoke all on routines from public;
