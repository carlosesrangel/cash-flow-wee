# Modelo de Dados — Fase 0+1

Esta fase cria apenas as tabelas de fundação. As demais entidades descritas
no Prompt Mestre (pedidos, contas a pagar/receber, transações SumUp,
forecast, cenários, impostos, reconciliação) entram em fases posteriores.

## Tabelas desta fase

- `organizations(id, name, created_at)` — seed único: WEE
  (`00000000-0000-0000-0000-000000000001`).
- `profiles(id, full_name, created_at)` — espelha `auth.users`, criado
  automaticamente via trigger `handle_new_user`.
- `organization_members(id, org_id, profile_id, role, created_at)` — `role`
  é o enum `organization_role`: `OWNER_ADMIN`, `MANAGER`, `VIEWER`.
- `audit_logs(id, org_id, actor_profile_id, action, entity, entity_id,
  before, after, created_at)` — genérica, reutilizada por todas as fases
  futuras.
- `sync_runs(id, org_id, integration, status, started_at, finished_at,
  pages_processed, records_received, records_created, records_updated,
  error_count, error_message)` — placeholder para a Fase 2/3; nenhuma linha
  é inserida nesta fase.

## RLS

Toda tabela com `org_id` restringe leitura a membros da mesma organização
via a função `is_org_member(org_id)`. Escrita em `organization_members` é
restrita a `OWNER_ADMIN` via `current_org_role(org_id) = 'OWNER_ADMIN'`.
Ver `supabase/migrations/0001_foundation.sql` para as políticas completas.

## Entidades futuras (não criadas nesta fase)

`integration_connections`, `olist_orders`, `olist_order_items`,
`olist_contacts`, `olist_accounts_payable`, `olist_accounts_receivable`,
`olist_products`, `sumup_transactions`, `sumup_transaction_events`,
`sumup_payouts`, `financial_categories`, `category_rules`,
`cash_balance_snapshots`, `manual_cash_entries`, `forecast_versions`,
`forecast_entries`, `forecast_scenarios`, `payment_scenarios`,
`payment_scenario_items`, `tax_rule_versions`, `reconciliation_matches`.
