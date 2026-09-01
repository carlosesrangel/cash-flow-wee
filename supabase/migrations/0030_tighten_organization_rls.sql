-- Migration 0018 added temporary bootstrap policies with USING (true). They
-- remained active alongside the restrictive policies from 0001, so any
-- authenticated user could read every organization and membership row.
drop policy if exists "organizations_select_policy" on organizations;
drop policy if exists "organization_members_select_policy" on organization_members;
drop policy if exists "organization_members_insert_policy" on organization_members;
drop policy if exists "organization_members_update_policy" on organization_members;
drop policy if exists "organization_members_delete_policy" on organization_members;

create policy "members can read their organization only"
  on organizations for select
  using (is_org_member(id));

-- The first membership is created by the authenticated user for their own
-- profile. Further memberships can only be created by an active owner admin.
create policy "users can bootstrap their own owner membership"
  on organization_members for insert
  with check (
    (profile_id = auth.uid() and role = 'OWNER_ADMIN')
    or current_org_role(org_id) = 'OWNER_ADMIN'
  );

create policy "members can read membership in their organization only"
  on organization_members for select
  using (is_org_member(org_id));

create policy "owner admins can update membership in their organization only"
  on organization_members for update
  using (current_org_role(org_id) = 'OWNER_ADMIN')
  with check (current_org_role(org_id) = 'OWNER_ADMIN');

create policy "owner admins can delete membership in their organization only"
  on organization_members for delete
  using (current_org_role(org_id) = 'OWNER_ADMIN');
