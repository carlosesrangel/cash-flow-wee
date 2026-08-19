-- Allow INSERT on organizations table
-- This policy enables the auto-create-organization-on-first-login feature
create policy "organizations_insert_policy"
  on organizations for insert
  with check (true);

-- Allow SELECT on organizations table
create policy "organizations_select_policy"
  on organizations for select
  using (true);

-- Allow INSERT on organization_members table
-- This is required to bootstrap the first user/org relationship
create policy "organization_members_insert_policy"
  on organization_members for insert
  with check (true);

-- Allow SELECT on organization_members table
create policy "organization_members_select_policy"
  on organization_members for select
  using (true);

-- Allow UPDATE and DELETE on organization_members table
create policy "organization_members_update_policy"
  on organization_members for update
  with check (true);

create policy "organization_members_delete_policy"
  on organization_members for delete
  using (true);
