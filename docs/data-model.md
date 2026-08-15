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

## Tabelas da Fase 5 (motor de fluxo de caixa)

`supabase/migrations/0013_cash_flow.sql`.

- `cash_balance_snapshots(id, org_id, reference_date, bank_balance,
  cash_on_hand, liquid_investments, notes, created_by, created_at)` — o
  saldo bancário confirmado em uma data de referência, usado como ponto de
  partida (`saldoInicial`) para o rollforward diário
  (`lib/cash-flow/engine.ts`'s `resolveOpeningBalance`). **Write-once**: não
  existe política de `update`/`delete` para `anon`/`authenticated` — uma
  correção é sempre uma nova linha com `reference_date` mais recente, nunca
  uma edição da anterior. Escrita só via `service_role`, a partir de
  `app/api/caixa/saldo/route.ts`, que exige `canManageCashBalance`
  (`OWNER_ADMIN`) antes de inserir e registra a ação em `audit_logs`.
- `manual_cash_entries(id, org_id, type, description, amount, entry_date,
  responsible_profile_id, justification, created_by, created_at,
  updated_at, deleted_at)` — lançamentos manuais de caixa fora do Olist/
  SumUp. `type` é `entrada`, `saida` ou `ajuste_saldo`; `entrada`/`saida`
  entram no fluxo diário como `realizado` (ver `docs/financial-rules.md`),
  `ajuste_saldo` é um delta assinado aplicado apenas ao saldo confirmado
  entre snapshots, nunca ao total de entradas/saídas do dia. `amount` é
  obrigatoriamente positivo para `entrada`/`saida` (constraint `check`); só
  `ajuste_saldo` pode ser negativo. **Soft-delete-only por desenho**: a
  coluna `deleted_at` existe desde a migration e todo carregamento do motor
  (`lib/cash-flow/engine.ts`) já filtra `is('deleted_at', null)`, mas esta
  fase não implementa nenhuma rota de remoção — hoje `app/api/caixa/ajustes/
  route.ts` só expõe `POST` (criação). Quando uma rota de remoção for
  adicionada, ela deve preencher `deleted_at` em vez de fazer `delete`, nunca
  apagar a linha (Prompt Mestre seção 22, "nunca apagar silenciosamente").
  Escrita (criação) só via `service_role`, a partir dessa rota, restrita a
  `OWNER_ADMIN` e auditada em `audit_logs`.

### RLS (Fase 5)

Ambas as tabelas seguem o padrão já estabelecido: `enable row level security`
mais uma única política de leitura (`for select using (is_org_member(org_id))`)
para membros da organização. Não há política de escrita para `anon`/
`authenticated` em nenhuma das duas — todo `insert`/`update` passa pelas
rotas de API acima, que usam a `service_role` (que ignora RLS) só depois de
checar `canManageCashBalance` no código da aplicação. Isso é intencional:
mantém a regra de autorização (só `OWNER_ADMIN`) em um único lugar (as
rotas), em vez de duplicá-la em política de RLS e em código.
