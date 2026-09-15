create or replace function public.accept_organization_invitations(p_profile_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation_row organization_invitations%rowtype;
  accepted_count integer := 0;
begin
  for invitation_row in
    select *
    from public.organization_invitations
    where auth_user_id = p_profile_id
      and status = 'pending'
      and expires_at > now()
    for update
  loop
    insert into public.organization_members (org_id, profile_id, role, active)
    values (invitation_row.org_id, p_profile_id, invitation_row.role, true)
    on conflict (org_id, profile_id)
    do update set role = excluded.role, active = true;

    update public.organization_invitations
    set status = 'accepted', updated_at = now()
    where id = invitation_row.id;

    accepted_count := accepted_count + 1;
  end loop;

  return accepted_count;
end;
$$;

revoke all on function public.accept_organization_invitations(uuid) from public;
grant execute on function public.accept_organization_invitations(uuid) to service_role;
