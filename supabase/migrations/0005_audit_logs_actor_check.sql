-- audit_logs INSERT policy only checked is_org_member(org_id), which let any
-- org member forge actor_profile_id as any UUID (including a member from a
-- different org), undermining the audit trail's integrity. Require
-- actor_profile_id to be either NULL or the inserting user's own id.

drop policy "members can insert audit logs in their org" on audit_logs;

create policy "members can insert audit logs in their org"
  on audit_logs for insert
  with check (
    is_org_member(org_id)
    and (actor_profile_id is null or actor_profile_id = auth.uid())
  );
