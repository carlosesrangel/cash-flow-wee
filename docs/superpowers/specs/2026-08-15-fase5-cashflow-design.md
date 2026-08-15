# Fase 5 — Motor de Fluxo de Caixa: Design

## Contexto

Fase 4 (Reconciliação Olist × SumUp) está completa e mergeada, com 187 testes
passando. Conforme o roadmap do Prompt Mestre (seção 54), a próxima etapa é a
Fase 5: **CashFlowEngine** — a camada central que consolida, por data, as
entradas e saídas realizadas e contratadas, e projeta o saldo diário
(`saldo_final = saldo_inicial + entradas - saídas`, seção 21).

As telas `Visão Geral`, `Fluxo de Caixa` (Diário/Mensal/Anual), `Contas a
Pagar` e `Contas a Receber` já existem como `EmptyState` apontando para esta
fase (as duas últimas ainda citam "Fase 2" no texto — resíduo desatualizado,
corrigido nesta fase).

Esta fase **não** inclui: forecast de vendas futuras (Fase 6 — "entradas
projetadas" fica de fora), categorização de despesas por regras
(`financial_categories`/`category_rules` — seção 9, fica "não categorizado"),
Planejador de Pagamentos/cenários what-if (Fase 7), e regras tributárias
(Fase 9).

## Evidência real usada nesta design

O banco Supabase local já contém um sync real da conta WEE (não é dado de
teste). Consultado diretamente via REST para embasar as regras de
classificação abaixo, em vez de inferir:

- `olist_accounts_receivable`: 625 linhas, `situacao` só assume o valor
  `aberto` no dataset atual; nenhuma linha tem `saldo = 0` ou
  `valor_pago`/`data_liquidacao` preenchidos.
- `olist_accounts_payable`: 419 linhas, `situacao` assume `pago` (181) ou
  `aberto` (238); nenhuma linha com pagamento parcial (`0 < saldo < valor`)
  observada.

Ou seja: os únicos valores de `situacao` confirmados em produção são
`aberto` e `pago`. O valor `cancelado` (citado no Prompt Mestre, seção 8)
nunca foi observado — tratado como caso hipotético, não removido da
modelagem, mas sinalizado como não confirmado.

## Modelo de dados novo

### `cash_balance_snapshots`

Saldo de Caixa Confirmado (Prompt Mestre, seção 21). Nunca é editado ou
apagado — cada correção é um novo snapshot; o motor sempre usa o mais
recente com `reference_date <= data` de interesse.

```sql
create table cash_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  reference_date date not null,
  bank_balance numeric not null,
  cash_on_hand numeric,
  liquid_investments numeric,
  notes text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create index cash_balance_snapshots_org_id_reference_date_idx
  on cash_balance_snapshots(org_id, reference_date desc);
```

RLS: leitura para membros da org (`is_org_member(org_id)`). Sem política de
insert/update/delete para `anon`/`authenticated` — escrita só via
`service_role`, através de uma rota server-side que valida
`canManageCashBalance` e grava em `audit_logs`.

### `manual_cash_entries`

Ajustes manuais (Prompt Mestre, seção 22): entrada, saída ou ajuste de saldo
avulsos. Soft delete — nunca apagado silenciosamente.

```sql
create table manual_cash_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  type text not null check (type in ('entrada', 'saida', 'ajuste_saldo')),
  description text not null,
  amount numeric not null,
  entry_date date not null,
  responsible_profile_id uuid not null references profiles(id),
  justification text not null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index manual_cash_entries_org_id_entry_date_idx
  on manual_cash_entries(org_id, entry_date);
```

RLS: mesmo padrão — leitura para membros, escrita só via `service_role`.
`amount` é sempre um valor positivo; o `type` (`entrada`/`saida`) determina o
sinal aplicado pelo motor. `ajuste_saldo` não entra no fluxo diário como
entrada/saída — existe para registrar uma correção manual de saldo (e é
auditado), mas o motor a trata como um saldo confirmado adicional, não como
um lançamento de caixa.

### RBAC

```ts
// lib/auth/rbac.ts
export function canManageCashBalance(role: OrganizationRole): boolean {
  return role === 'OWNER_ADMIN'
}
```

Seção 38 do Prompt Mestre lista "alterar saldo confirmado" e "lançar
ajustes" apenas entre as permissões do `OWNER_ADMIN`; `MANAGER` não tem essa
permissão listada (diferente de `canManageReconciliation`, que inclui
`MANAGER`).

## Regras de classificação

O texto de `situacao` da Olist **não** é a fonte de verdade para
realizado/contratado — `saldo` é, porque é o campo numérico que a própria
Olist mantém consistente (`valor_pago = valor - saldo`, seção 8 do Prompt
Mestre). Isso também descola a classificação de qualquer variação futura no
texto de `situacao` que a Olist venha a introduzir.

### Contas a Receber (`olist_accounts_receivable`)

| Condição | Bucket | Data de caixa |
|---|---|---|
| `saldo == 0` | `realizado` | Ver prioridade de data abaixo |
| `saldo > 0` | `contratado` | Ver prioridade de data abaixo |
| `situacao == 'cancelado'` | excluída do fluxo | — |
| `valor` ou data de referência ausente | excluída, listada em Qualidade dos Dados | — |
| `situacao` fora de `{aberto, pago, cancelado}` | excluída, listada em Qualidade dos Dados como "situação desconhecida" | — |

Prioridade de data de caixa (primeira que existir):
1. Se há uma linha em `reconciliation_matches` com
   `status in ('reconciliado_automaticamente', 'reconciliado_manualmente')`
   e `sumup_transaction_event_id` preenchido: usar a `due_date` do evento
   SumUp correspondente (ADR-002 — SumUp é mais precisa para liquidação de
   cartão).
2. Senão, se `data_liquidacao` (Olist) está preenchida: usá-la.
3. Senão, `data_vencimento`.

Nenhuma data é fabricada: se nenhuma das três existir, a linha vai para
Qualidade dos Dados em vez de ser omitida silenciosamente ou datada com
"hoje".

### Contas a Pagar (`olist_accounts_payable`)

| Condição | Bucket | Data de caixa |
|---|---|---|
| `saldo == 0` | `realizado` | `data_vencimento` (Olist não expõe data efetiva de baixa na listagem atual — ver "Riscos e suposições") |
| `saldo > 0` | `contratado` | `data_vencimento` |
| `situacao == 'cancelado'` | excluída do fluxo | — |
| `situacao` fora de `{aberto, pago, cancelado}` | excluída, Qualidade dos Dados | — |

### Ajustes manuais (`manual_cash_entries`)

| `type` | Bucket | Data de caixa |
|---|---|---|
| `entrada` | `realizado` | `entry_date` |
| `saida` | `realizado` | `entry_date` |
| `ajuste_saldo` | não entra no fluxo diário — ajusta apenas o saldo confirmado a partir de `entry_date` | — |

Todo lançamento manual é sempre `realizado` — por definição, é um evento que
o usuário já registrou como acontecido (não existe "ajuste manual
contratado" nesta fase).

### Aging (Contas a Receber e Contas a Pagar)

Faixas fixas (seção 10 do Prompt Mestre), calculadas sobre a data de caixa
de cada linha `contratado` em relação a hoje: `vencido`, `0-7`, `8-15`,
`16-30`, `31-60`, `61-90`, `>90 dias`.

## Motor — `lib/cash-flow/engine.ts`

Segue o padrão já estabelecido em `lib/reconciliation/run.ts`
(`fetchAllPages`, sem ORM, service-role client) — sem tabelas de resultado
materializadas nesta fase (volume atual: ~1000 linhas AR+AP, computação em
memória é instantânea). Se o volume crescer ordens de magnitude, revisitar
com uma tabela `cash_flow_daily` recalculada por job, mas não implementar
isso preventivamente.

```ts
type CashFlowEntry = {
  id: string
  origin: 'ar' | 'ap' | 'manual'
  sourceId: string
  date: string // YYYY-MM-DD
  amount: number
  direction: 'entrada' | 'saida'
  bucket: 'realizado' | 'contratado'
  description: string | null
}

type CashFlowDay = {
  date: string
  saldoInicial: number | null // null se não há snapshot aplicável ainda
  entradas: { realizado: number; contratado: number }
  saidas: { realizado: number; contratado: number }
  saldoFinal: number | null
}
```

- `loadCashFlowEntries(orgId, {from, to}): Promise<CashFlowEntry[]>` — lê
  AR/AP/manual entries paginados, aplica as regras de classificação acima,
  devolve uma lista plana. Esta é a base da explainability (seção 44): a UI
  agrupa por dia para exibir totais, e ao clicar num total, filtra esta
  mesma lista pela data para mostrar as linhas que o compõem — nunca um
  número "caixa-preta".
- `aggregateByDay(entries, {from, to}, openingBalance): CashFlowDay[]` —
  função pura, sem I/O, testável com fixtures determinísticas. Soma por dia
  e por bucket, projeta `saldoFinal` dia a dia a partir de
  `openingBalance` (o snapshot mais recente aplicável). Dias anteriores ao
  primeiro snapshot mostram `saldoInicial`/`saldoFinal = null` — mostrar
  fluxos sem saldo corrente é aceitável; inventar um saldo bancário não é
  (seção 51).
- `resolveOpeningBalance(orgId, date): Promise<{ balance: number; asOf: string } | null>` —
  busca o snapshot de `cash_balance_snapshots` mais recente com
  `reference_date < date`, soma qualquer `ajuste_saldo` manual entre esse
  snapshot e `date`, e retorna o saldo a aplicar como `saldoInicial` do
  primeiro dia da janela. Retorna `null` se não há snapshot algum.
- `getMinimumProjectedBalance(days: CashFlowDay[]): { date: string; balance: number } | null` —
  usado pela Visão Geral (seção 26); ignora dias com `saldoFinal === null`.

## Telas

### Contas a Receber / Contas a Pagar

Substituem o `EmptyState` atual. Tabela paginada com: histórico/documento,
cliente ou fornecedor, vencimento, valor, saldo, situação (badge), bucket
(realizado/contratado), data de caixa efetiva. Filtro por período e por
aging. Reaproveita o padrão de tabela já usado em
`components/reconciliation/reconciliation-table.tsx`.

### Visão Geral

Cards: Saldo de Caixa Atual (do snapshot mais recente, com badge "há N
dias" se estiver desatualizado), Entradas/Saídas próximos 30 dias, Saldo
projetado em 30 dias, Menor saldo projetado + data. Curva de caixa (gráfico
diário) diferenciando visualmente realizado × contratado. Alertas: apenas o
caso "saldo projetado abaixo de zero" nesta fase (os demais alertas da
seção 24 — concentração, recebíveis atrasados, forecast, integração —
dependem de fases futuras ou já têm superfície própria, ex.: "Saúde das
Integrações").

### Fluxo de Caixa — Diário / Mensal / Anual

- **Diário**: tabela por dia (saldo inicial, entradas, saídas, resultado,
  saldo final), expansível para ver os lançamentos que compõem cada dia
  (seção 27).
- **Mensal**: mesma tabela com foco em um mês escolhido via seletor.
- **Anual**: matriz Mês × (Entradas / Saídas / Resultado / Saldo final),
  sem quebra por categoria nesta fase (seção 28 — decisão explícita:
  categorização fica para depois).

### Horizonte de tempo

Sem limite artificial no futuro (mostra até onde há contas lançadas na
Olist); janela padrão visível de ±90 dias em Visão Geral/Diário, ajustável
por filtro de período.

## Testes

- Unitários para `aggregateByDay`: fixtures determinísticas provando
  `saldoFinal = saldoInicial + entradas - saídas` todo dia, incluindo os
  casos sem `saldoInicial` (antes do primeiro snapshot).
- Unitários para a classificação AR/AP (`saldo` → bucket, prioridade de
  data de caixa, incluindo o caso reconciliado via SumUp e o caso
  "situação desconhecida").
- Unitários para `resolveOpeningBalance` (snapshot mais recente aplicável +
  ajustes de saldo intermediários).
- Teste de integração (mesmo padrão de
  `tests/integration/reconciliation.test.ts`) rodando o motor contra o
  banco local real, incluindo os dados reais já sincronizados.

## Riscos e suposições

- **Olist não expõe data efetiva de baixa de contas a pagar na listagem
  atual usada pelo sync** (`GET /contas-pagar` — só `data_vencimento`).
  Contas pagas (`saldo == 0`) são datadas pela `data_vencimento`, não pela
  data real do pagamento, que pode ter sido antes ou depois. Isso é uma
  aproximação conhecida, documentada aqui em vez de fabricar uma data
  efetiva inexistente (seção 8: "Caso a API não informe a data efetiva de
  baixa, registrar explicitamente que ela é desconhecida" — a aproximação
  usada é a melhor disponível sem essa informação, mas não é o dado real).
  Se a API expuser esse campo no futuro (como já faz para contas a receber
  via `data_liquidacao` no endpoint de detalhe), revisitar.
- **`situacao = 'cancelado'` nunca foi observado nos dados reais da WEE**
  atualmente sincronizados — a regra existe porque o Prompt Mestre a exige
  (seção 8), mas não há evidência de produção validando o valor exato da
  string que a Olist usaria. Se aparecer um valor diferente (ex.
  `'cancelada'`, feminino, ou um código numérico), ele cairá em "situação
  desconhecida" na tela de Qualidade dos Dados em vez de ser
  silenciosamente tratado como `aberto` — a lacuna fica visível, não
  escondida.
- **Nenhum caso de pagamento parcial (`0 < saldo < valor`) foi observado
  nos dados reais** — a regra `saldo > 0 → contratado` cobre esse caso
  corretamente por construção (não depende de detectar "parcial"
  explicitamente), mas o teste de integração não tem um fixture real desse
  cenário; será coberto por fixture sintético nos testes unitários.
