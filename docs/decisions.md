# Decisões de Arquitetura (ADRs)

## ADR-001: Olist Orders como source of truth para vendas
Contexto: evitar ambiguidade sobre qual sistema define faturamento
operacional. Decisão: Olist é a fonte oficial de pedidos, clientes,
produtos vendidos e faturamento operacional (Fase 2).

## ADR-002: SumUp como source of truth para settlement de pagamentos SumUp
Contexto: evitar dupla contagem entre contas a receber da Olist e
liquidações da SumUp. Decisão: quando uma conta a receber Olist estiver
vinculada a uma venda SumUp, usar a SumUp apenas para refinar data de
liquidação, parcelas, taxas e eventos de payout — nunca somar os dois como
recebimentos distintos (Fase 4).

## ADR-003: Simulações de contas a pagar não escrevem no ERP no MVP
Contexto: primeiro release é read-only para Olist e SumUp. Decisão: o
Planejador de Pagamentos (Fase 7) opera inteiramente em uma camada de
cenário local; nenhuma ação altera vencimentos ou status no ERP.

## ADR-004: Organização única com modelo de dados multi-tenant
Contexto: a WEE é uma única empresa, mas retrofitar `org_id` e RLS depois
seria custoso e arriscado para dados financeiros. Decisão: modelar
`org_id` e RLS por organização desde a primeira migration (Fase 1), com uma
única organização "WEE" seedada; sem UI de gestão de múltiplas empresas
neste MVP.

## ADR-005: Sem ORM — SQL puro via Supabase CLI
Contexto: transparência total é prioritária para lógica financeira que
virá nas próximas fases. Decisão: migrations SQL versionadas via Supabase
CLI, queries manuscritas com `supabase-js`, validação Zod em toda borda —
sem Prisma/Drizzle (Fase 1).
