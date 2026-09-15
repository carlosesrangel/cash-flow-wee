begin;

create table if not exists public.integration_locks (
  org_id uuid not null references public.organizations(id),
  resource text not null,
  owner uuid not null,
  expires_at timestamptz not null,
  primary key (org_id, resource)
);
alter table public.integration_locks enable row level security;
revoke all on public.integration_locks from public, anon, authenticated;
grant all on public.integration_locks to service_role;

create or replace function public.acquire_integration_lock(p_org_id uuid, p_resource text, p_owner uuid, p_seconds integer)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  if p_seconds < 1 or p_seconds > 10800 then raise exception 'Invalid lease duration'; end if;
  insert into integration_locks values (p_org_id, p_resource, p_owner, clock_timestamp() + make_interval(secs => p_seconds))
  on conflict (org_id, resource) do update set owner = excluded.owner, expires_at = excluded.expires_at
  where integration_locks.expires_at < clock_timestamp();
  return found;
end $$;
revoke all on function public.acquire_integration_lock(uuid,text,uuid,integer) from public, anon, authenticated;
grant execute on function public.acquire_integration_lock(uuid,text,uuid,integer) to service_role;

alter table public.sync_runs add column if not exists synced_through timestamptz;
create index if not exists sync_runs_checkpoint_idx on public.sync_runs(org_id, integration, started_at desc) where status = 'success';
create index if not exists cash_balance_snapshot_history_idx on public.cash_balance_snapshots(org_id, reference_date desc, created_at desc);

-- Count persisted parent records (events/items are children, not additional business records).
-- UPDATE means an existing row was upserted, even if its business values were unchanged.
create or replace function public.count_integration_write() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  update sync_runs set records_created = coalesce(records_created,0) + case when TG_OP = 'INSERT' then 1 else 0 end,
    records_updated = coalesce(records_updated,0) + case when TG_OP = 'UPDATE' then 1 else 0 end
  where id = (select id from sync_runs where org_id = NEW.org_id and integration = TG_ARGV[0] and status = 'running'
    and started_at > clock_timestamp() - interval '3 hours' order by started_at desc limit 1);
  return NEW;
end $$;
revoke all on function public.count_integration_write() from public, anon, authenticated;
do $$ declare t text; begin
  foreach t in array array['olist_sellers','olist_payment_methods','olist_contacts','olist_products','olist_orders','olist_accounts_payable','olist_accounts_receivable','sumup_transactions','sumup_payouts'] loop
    if not exists (
      select 1 from pg_trigger
      where tgname = 'sync_write_count'
        and tgrelid = ('public.' || quote_ident(t))::regclass
        and not tgisinternal
    ) then
      execute format('create trigger sync_write_count after insert or update on public.%I for each row execute function public.count_integration_write(%L)', t, case when t like 'olist_%' then 'olist' else 'sumup' end);
    end if;
  end loop;
end $$;
commit;
