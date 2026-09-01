-- Align the initial AP ledger rows with the explicit canonical nature names.
update financial_ledger
set nature = 'OLIST_AP_SCHEDULED'
where source = 'olist'
  and nature = 'OLIST_PAYABLE_SCHEDULED'
  and status = 'scheduled';

-- A prior refresh materialized every AR row as scheduled before reconciliation
-- became part of the ledger source. Resolved AR rows are actual only; remove
-- those stale future rows without touching unresolved obligations.
delete from financial_ledger ledger
using reconciliation_matches match
where ledger.source = 'olist'
  and ledger.nature = 'OLIST_AR_SCHEDULED'
  and ledger.source_id = match.olist_accounts_receivable_id::text
  and match.status in ('reconciliado_automaticamente', 'reconciliado_manualmente');
