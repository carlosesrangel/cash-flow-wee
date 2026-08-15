-- Fase 4 follow-up: a durable "rejected" terminal state for undoing an
-- automatic match, so it doesn't get silently re-created by the next sync
-- (see docs/reconciliation.md and the Fase 4 final-review ledger).
alter table reconciliation_matches drop constraint reconciliation_matches_status_check;

alter table reconciliation_matches add constraint reconciliation_matches_status_check
  check (status in (
    'reconciliado_automaticamente',
    'reconciliado_manualmente',
    'nao_reconciliado',
    'conflito',
    'rejeitado_manualmente'
  ));
