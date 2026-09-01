alter table organization_members
  add column if not exists active boolean not null default true;

create table if not exists organization_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  role organization_role not null default 'VIEWER',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled')),
  auth_user_id uuid references auth.users(id) on delete set null,
  invited_by uuid references profiles(id) on delete set null,
  invited_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists organization_invitations_org_status_idx
  on organization_invitations(org_id, status);
create unique index if not exists organization_invitations_pending_email_idx
  on organization_invitations(org_id, lower(email)) where status = 'pending';

alter table organization_invitations enable row level security;
create policy "members can read organization invitations in their org"
  on organization_invitations for select using (is_org_member(org_id));
create policy "owner admins can insert organization invitations"
  on organization_invitations for insert with check (current_org_role(org_id) = 'OWNER_ADMIN');
create policy "owner admins can update organization invitations"
  on organization_invitations for update using (current_org_role(org_id) = 'OWNER_ADMIN');
create policy "owner admins can delete organization invitations"
  on organization_invitations for delete using (current_org_role(org_id) = 'OWNER_ADMIN');
