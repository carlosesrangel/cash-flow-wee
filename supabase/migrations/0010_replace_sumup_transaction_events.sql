-- Atomic replacement of a SumUp transaction's events.
--
-- The transactions sync refreshes the full event list of a transaction on every
-- pass. Doing that as two PostgREST round-trips (DELETE, then INSERT) is not
-- atomic: if the process dies or the insert fails in between, that
-- transaction's events are gone until some later sync happens to consider the
-- transaction "changed" again — which, under a 24h incremental window, may not
-- happen for a long time. This function does both inside a single statement
-- block, so the delete and the insert commit or roll back together.
--
-- Not `security definer`: only `service_role` writes to these tables (see the
-- RLS policies in 0009, which grant SELECT to org members only), and
-- service_role already bypasses RLS. Running with invoker rights keeps the
-- function from becoming a privilege-escalation path if it is ever exposed.
create or replace function replace_sumup_transaction_events(
  p_transaction_id uuid,
  p_events jsonb
)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from sumup_transaction_events where transaction_id = p_transaction_id;

  insert into sumup_transaction_events (
    org_id,
    transaction_id,
    sumup_event_id,
    event_type,
    status,
    amount,
    event_date,
    due_date,
    event_timestamp,
    installment_number,
    raw,
    synced_at
  )
  select
    event.org_id,
    -- The parent is always the function argument, never a value from the
    -- payload, so a malformed payload cannot attach events to another
    -- transaction.
    p_transaction_id,
    event.sumup_event_id,
    event.event_type,
    event.status,
    event.amount,
    event.event_date,
    event.due_date,
    event.event_timestamp,
    event.installment_number,
    event.raw,
    coalesce(event.synced_at, now())
  from jsonb_to_recordset(coalesce(p_events, '[]'::jsonb)) as event(
    org_id uuid,
    sumup_event_id text,
    event_type text,
    status text,
    amount numeric,
    event_date date,
    due_date date,
    event_timestamp timestamptz,
    installment_number integer,
    raw jsonb,
    synced_at timestamptz
  );
end;
$$;

-- 0006 default-revoked EXECUTE from PUBLIC for routines created from then on;
-- these statements are explicit belt-and-braces plus the one grant this
-- function actually needs. Only the server-side service_role calls it.
revoke all on function public.replace_sumup_transaction_events(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_sumup_transaction_events(uuid, jsonb) to service_role;
