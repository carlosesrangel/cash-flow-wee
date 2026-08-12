create extension if not exists "pgcrypto";

create type organization_role as enum ('OWNER_ADMIN', 'MANAGER', 'VIEWER');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now()
);

create table organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role organization_role not null default 'VIEWER',
  created_at timestamptz not null default now(),
  unique (org_id, profile_id)
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  actor_profile_id uuid references profiles(id),
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index organization_members_org_id_idx on organization_members(org_id);
create index organization_members_profile_id_idx on organization_members(profile_id);
create index audit_logs_org_id_idx on audit_logs(org_id);

-- Auto-create a profile row whenever a new auth user is created.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- RLS
alter table organizations enable row level security;
alter table profiles enable row level security;
alter table organization_members enable row level security;
alter table audit_logs enable row level security;

create or replace function is_org_member(target_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from organization_members
    where org_id = target_org_id and profile_id = auth.uid()
  );
$$;

create or replace function current_org_role(target_org_id uuid)
returns organization_role
language sql
security definer
set search_path = public
as $$
  select role from organization_members
  where org_id = target_org_id and profile_id = auth.uid()
  limit 1;
$$;

create policy "org members can read their organization"
  on organizations for select
  using (is_org_member(id));

create policy "profile owner can read own profile"
  on profiles for select
  using (id = auth.uid());

create policy "profile owner can update own profile"
  on profiles for update
  using (id = auth.uid());

create policy "members can read membership in their org"
  on organization_members for select
  using (is_org_member(org_id));

create policy "owner admins can insert membership in their org"
  on organization_members for insert
  with check (current_org_role(org_id) = 'OWNER_ADMIN');

create policy "owner admins can update membership in their org"
  on organization_members for update
  using (current_org_role(org_id) = 'OWNER_ADMIN');

create policy "owner admins can delete membership in their org"
  on organization_members for delete
  using (current_org_role(org_id) = 'OWNER_ADMIN');

create policy "members can read audit logs in their org"
  on audit_logs for select
  using (is_org_member(org_id));

create policy "members can insert audit logs in their org"
  on audit_logs for insert
  with check (is_org_member(org_id));
