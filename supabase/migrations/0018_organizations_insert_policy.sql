-- Allow authenticated users to create organizations
-- This policy enables the auto-create-organization-on-first-login feature
create policy "authenticated users can insert organizations"
  on organizations for insert
  with check (auth.role() = 'authenticated');

-- Allow authenticated users to add themselves as members to any organization
-- This is required to bootstrap the first user/org relationship
create policy "authenticated users can insert their own membership"
  on organization_members for insert
  with check (profile_id = auth.uid());
