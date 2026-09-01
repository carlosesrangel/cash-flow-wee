-- Reclassify historical scheduled SumUp events that were written under the
-- actual nature before the canonical refresh split actual/scheduled payouts.
-- This is a reversible classification correction; no ledger rows are deleted.
update financial_ledger
set nature = 'SUMUP_PAYOUT_SCHEDULED'
where source = 'sumup'
  and status = 'scheduled'
  and nature = 'SUMUP_PAYOUT_ACTUAL';
