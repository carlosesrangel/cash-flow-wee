# Fase 6 (parte B) — Planejamento de Receita: Design

## Contexto

Fase 5 (Motor de Fluxo de Caixa) está completa e mergeada em `master`, com
264 testes passando. Conforme o roadmap do Prompt Mestre (seção 54), a
próxima etapa é a Fase 6 (Forecast Engine).

A Fase 6 completa do Prompt Mestre cobre oito seções (12–19) que formam,
na prática, três subsistemas com dependências diferentes:

- **A. Analytics históricos** (§12 motor de taxas SumUp, §13 perfil
  histórico de recebimento, §18 sazonalidade intramês, §19 mix de forma de
  pagamento) — cálculos de leitura sobre dados já sincronizados.
- **B. Planejamento de Receita** (§14 projeção manual, §15 versionamento,
  §16 cenários, §17 seed inicial) — CRUD autocontido, sem dependências
  novas.
- **C. Motor de projeção** — combina A + B para converter faturamento
  planejado em entrada de caixa projetada, alimentando os dashboards da
  Fase 5.

B foi escolhido para vir primeiro: não depende de nada novo e desbloqueia
a comparação "quanto vendemos frente ao planejado" (Prompt Mestre §55,
MVP item 9). Este documento cobre **apenas B**, incluindo o relatório
Forecast vs Realizado (§32), que usa as mesmas tabelas e fecha um fluxo
ponta a ponta testável.

Esta fase **não** inclui: motor de taxas SumUp, perfil de recebimento,
sazonalidade intramês ou mix de pagamento (subsistema A — fase futura);
conversão do forecast em entrada de caixa projetada no motor de fluxo de
caixa (subsistema C — fase futura); Planejador de Pagamentos/cenários
what-if de pagamento (Fase 7, não confundir com os cenários de receita
desta fase); Vendas/Clientes/Produtos BI (Fase 8).

As telas `Planejamento` e `Cenários` já existem como `EmptyState`
apontando para "Fase 6 (Forecast Engine)".

## Modelo de dados novo

### `forecast_versions`

Uma versão nomeada de planejamento (Prompt Mestre §15: "Planejamento
Original", "Forecast Agosto 2026", "Budget 2027"...). Nunca é
sobrescrita — revisar o forecast cria uma versão nova. A versão com
`created_at` mais recente é a única editável; as demais são somente
leitura, preservadas para comparação (Original vs Atual vs Realizado).

```sql
create table forecast_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create index forecast_versions_org_id_created_at_idx
  on forecast_versions(org_id, created_at desc);
```

RLS: leitura para membros da org. Sem política de insert/update/delete
para `anon`/`authenticated` — escrita só via `service_role`, através de
uma rota que valida `canEditForecast` e grava em `audit_logs`.
`forecast_versions` nunca é atualizada ou apagada depois de criada — é
sempre insert-only, mesmo padrão de `cash_balance_snapshots` na Fase 5.

### `forecast_entries`

O valor bruto planejado por mês dentro de uma versão (§14 — a grade
Ano × Jan..Dez). Sem cenário embutido: representa 100%, o cenário é
aplicado por cima na leitura (ver "Cenários" abaixo).

```sql
create table forecast_entries (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references forecast_versions(id) on delete cascade,
  ano integer not null,
  mes integer not null check (mes between 1 and 12),
  receita numeric not null default 0,
  updated_by uuid not null references profiles(id),
  updated_at timestamptz not null default now(),
  unique (version_id, ano, mes)
);

create index forecast_entries_version_id_idx on forecast_entries(version_id);
```

RLS: leitura para membros da org via join implícito em `forecast_versions`
(política usa `exists (select 1 from forecast_versions v where v.id =
forecast_entries.version_id and is_org_member(v.org_id))`, já que a
tabela não tem `org_id` próprio). Escrita só via `service_role`, gated por
`canEditForecast`, e restrita à versão mais recente da org (a rota
verifica isso antes de escrever — editar uma versão antiga é rejeitado
com 400, não silenciosamente aceito). Cada escrita bem-sucedida grava em
`audit_logs` com `action='forecast_entry_updated'`, `entity='forecast_entries'`,
`entity_id=<entry id>`, `before={ receita }`, `after={ receita, cenario,
comentario }` — reaproveita a tabela genérica existente; sem coluna de
comentário dedicada nesta tabela.

### `forecast_scenarios`

Um cenário nomeado (§16: "Base", "Conservador", "Otimista", ou
customizado pelo usuário). Global por org, não por versão — o mesmo
conjunto de cenários se aplica a qualquer `forecast_version`.

```sql
create table forecast_scenarios (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create index forecast_scenarios_org_id_idx on forecast_scenarios(org_id);
```

### `forecast_scenario_multipliers`

O percentual editável por mês de cada cenário (§16: "Base = 100%,
Conservador = 85%, Otimista = 115%", editável).

```sql
create table forecast_scenario_multipliers (
  scenario_id uuid not null references forecast_scenarios(id) on delete cascade,
  ano integer not null,
  mes integer not null check (mes between 1 and 12),
  percentual numeric not null,
  primary key (scenario_id, ano, mes)
);
```

RLS para `forecast_scenarios`/`forecast_scenario_multipliers`: leitura
para membros da org (join implícito para a segunda). Escrita só via
`service_role`, gated por `canCreateScenario`, auditada em `audit_logs`
(`action` em `forecast_scenario_created` / `forecast_scenario_duplicated`
/ `forecast_scenario_multiplier_updated`).

**Projetado** (o que a grade mostra por cenário, calculado on-demand,
nunca persistido) = `forecast_entries.receita × forecast_scenario_multipliers.percentual / 100`
para o par `(ano, mes)`; se não houver multiplicador cadastrado para
aquele mês naquele cenário, usa 100% (equivalente ao cenário Base) — nunca
omite o mês silenciosamente.

### RBAC

Já existentes em `lib/auth/rbac.ts`, sem alteração — reaproveitados
diretamente:

```ts
export function canEditForecast(role: OrganizationRole): boolean {
  return role === 'OWNER_ADMIN' || role === 'MANAGER'
}
export function canCreateScenario(role: OrganizationRole): boolean {
  return role === 'OWNER_ADMIN' || role === 'MANAGER'
}
```

Confirmado pela seção 38 do Prompt Mestre: MANAGER pode "alterar
projeções se autorizado" e "criar cenários"; VIEWER só lê.

## Comportamento — criação de versão e edição

- **Criar nova versão**: pede um nome, copia todos os `forecast_entries`
  da versão atual para a nova (mesmos valores, editáveis a partir daí).
  Sem isso, cada revisão exigiria redigitar 12+ meses do zero. A versão
  anterior vira somente leitura automaticamente, por deixar de ser a mais
  recente — nenhuma flag extra necessária.
- **Editar célula**: grade Ano × [Jan..Dez], célula editável inline
  (padrão `<input>` on-blur já usado nos forms da Fase 5), só na versão
  atual. Cada edição bem-sucedida é uma chamada a
  `POST /api/forecast/entradas` com `{ versionId, ano, mes, receita,
  cenario, comentario? }` — grava o novo valor e o registro de auditoria
  descrito acima. `cenario` aqui é o cenário selecionado na UI no momento
  da edição (contexto para o log), não uma dimensão de armazenamento —
  `forecast_entries` continua representando sempre os 100% base.
- **Versões antigas**: selecionáveis num dropdown, mostradas na mesma
  grade em modo leitura (sem inputs).

## Seed inicial (§17)

Uma migração insere, para a org seed (`00000000-0000-0000-0000-000000000001`):

- Uma `forecast_versions` chamada "Planejamento Original".
- 54 `forecast_entries` (2026-06 a 2030-12) com os valores do CSV do
  Prompt Mestre.
- Três `forecast_scenarios` (Base, Conservador, Otimista) com
  `forecast_scenario_multipliers` em todos os 54 meses (100/85/115).

Meses anteriores à data atual são histórico de planejamento — usados pelo
relatório Forecast vs Realizado, não têm efeito em caixa futuro (essa
distinção é responsabilidade do subsistema C, fora do escopo desta fase;
aqui apenas não fabricamos nenhum comportamento especial para eles).

## Relatório Forecast vs Realizado (§32)

Nova rota `app/(app)/planejamento/forecast-vs-realizado/page.tsx` (dentro
de Planejamento, não uma entrada de menu própria — mantém a navegação do
Prompt Mestre seção 36 sem adicionar item novo).

Tabela: Mês | Planejado | Realizado | Diferença R$ | Diferença % + linha
YTD. Seletor para escolher qual comparar: "Original" (primeira versão da
org, por `created_at`) vs "Atual" (última versão). Cenário aplicado ao
Planejado é sempre Base (100%) nesta fase — comparar contra um cenário
não-Base é decisão de UI para fase futura, não implementado agora para
não inflar o escopo.

- **Planejado** = `forecast_entries.receita` do (ano, mês), da versão
  selecionada.
- **Realizado** = soma de `olist_orders.valor_total_pedido` agrupado por
  mês de `data`, para a org. Escolhido em vez de "caixa recebido" (AR
  realizado da Fase 5) porque a pergunta do MVP é "quanto vendemos", não
  "quanto entrou em caixa" — uma venda faturada e ainda não paga já é
  venda, mas ainda não é caixa.
- Mês sem nenhum pedido sincronizado mostra Realizado = "—", nunca `0`
  quando o mês ainda não chegou (dado inexistente ≠ dado zero). Meses
  passados sem pedido mostram `0` de fato (dado existe, é zero).
- Diferença R$ = Realizado − Planejado quando ambos existem; caso
  contrário "—". Diferença % = Diferença R$ / Planejado quando Planejado
  ≠ 0; caso contrário "—" (nunca divisão por zero disfarçada de 0%).

## Telas

### Planejamento (`app/(app)/planejamento/page.tsx`)

Substitui o `EmptyState` atual. Seletor de versão (atual por padrão) +
grade editável (se `canEditForecast` e é a versão atual) ou somente
leitura. Botão "Criar nova versão" (se `canEditForecast`). Link para o
relatório Forecast vs Realizado.

### Cenários (`app/(app)/cenarios/page.tsx`)

Substitui o `EmptyState` atual. Lista os `forecast_scenarios` da org,
cada um com sua grade de multiplicadores por mês (editável se
`canCreateScenario`). Botão "Novo cenário" e "Duplicar" (copia os
multiplicadores do cenário selecionado para um novo, nome pedido ao
usuário).

## Motor — `lib/forecast/`

Segue o padrão já estabelecido em `lib/cash-flow/engine.ts` (sem ORM,
`fetchAllPages`, service-role client, funções puras separadas de I/O).

```ts
// lib/forecast/scenarios.ts — puro
type MonthlyValue = { ano: number; mes: number; value: number }
function applyScenario(entries: MonthlyValue[], multipliers: MonthlyValue[]): MonthlyValue[]
// multiplicador ausente para um (ano, mes) => trata como 100

// lib/forecast/compare.ts — puro
type ForecastVsRealizadoRow = {
  ano: number
  mes: number
  planejado: number | null
  realizado: number | null
  diferencaAbsoluta: number | null
  diferencaPercentual: number | null
}
function compareForecastToActual(
  planejado: MonthlyValue[],
  realizado: MonthlyValue[], // meses sem pedido sincronizado e já passados = 0; meses futuros ausentes = null
): ForecastVsRealizadoRow[]

// lib/forecast/engine.ts — I/O
function loadCurrentVersion(orgId): Promise<{ version: ForecastVersion; entries: ForecastEntry[] }>
function loadOriginalVersion(orgId): Promise<{ version: ForecastVersion; entries: ForecastEntry[] }>
function loadScenarios(orgId): Promise<Array<{ scenario: ForecastScenario; multipliers: MonthlyValue[] }>>
function loadRealizadoByMonth(orgId): Promise<MonthlyValue[]> // olist_orders agrupado por mês
function createForecastVersion(orgId, name, actorProfileId): Promise<ForecastVersion> // copia entries da atual
function updateForecastEntry(versionId, ano, mes, receita, actorProfileId, cenario, comentario?): Promise<void>
function createForecastScenario(orgId, name, actorProfileId, multipliers?): Promise<ForecastScenario>
function duplicateForecastScenario(scenarioId, newName, actorProfileId): Promise<ForecastScenario>
function updateScenarioMultiplier(scenarioId, ano, mes, percentual, actorProfileId): Promise<void>
```

## Validação (`lib/validation/forecast.ts`)

Zod na fronteira de cada rota, mesmo padrão da Fase 5
(`lib/validation/cash-flow.ts`):

- `updateForecastEntrySchema`: `versionId` (uuid), `ano` (int, 2000–2100),
  `mes` (int, 1–12), `receita` (number, >= 0), `cenario` (string,
  opcional), `comentario` (string, opcional, max 500).
- `createForecastVersionSchema`: `name` (string, 1–200 chars).
- `createForecastScenarioSchema`: `name` (string, 1–200 chars).
- `updateScenarioMultiplierSchema`: `scenarioId` (uuid), `ano`, `mes`,
  `percentual` (number, permite negativo? não — >= 0, um cenário com
  percentual negativo não tem significado de negócio; rejeitado com 400).

## Rotas de API

- `POST /api/forecast/versoes` — cria versão (copia entries da atual).
  Gate: `canEditForecast`.
- `POST /api/forecast/entradas` — atualiza uma célula da versão atual.
  Gate: `canEditForecast`. Rejeita com 400 se `versionId` não for a
  versão mais recente da org.
- `POST /api/forecast/cenarios` — cria cenário (com multiplicadores
  default 100% em todos os meses existentes, ou copiados de um
  `duplicateFromScenarioId` opcional). Gate: `canCreateScenario`.
- `POST /api/forecast/cenarios/multiplicadores` — atualiza um
  multiplicador. Gate: `canCreateScenario`.

Todas seguem o padrão já usado em `app/api/caixa/saldo/route.ts` /
`app/api/caixa/ajustes/route.ts`: autenticação via `getCurrentMember`,
validação Zod, checagem de RBAC, escrita via `service_role`, gravação em
`audit_logs` sem falhar a requisição se o log falhar (mesma correção
aplicada na Fase 5).

## Testes

- Unitários para `applyScenario` (multiplicador presente, ausente,
  editado por mês individual).
- Unitários para `compareForecastToActual` (mês com ambos os valores, mês
  futuro sem realizado ainda, mês passado com realizado zero real,
  divisão por planejado zero).
- Unitários para as rotas de API (mock do client admin, mesmo padrão de
  `tests/unit/cash-flow/saldo-route.test.ts`), incluindo o caso de
  rejeição ao editar uma versão que não é mais a atual.
- Teste de integração (mesmo padrão de
  `tests/integration/cash-flow.test.ts`): cria uma versão, edita uma
  entrada, cria/duplica um cenário, confere o relatório contra
  `olist_orders` reais já sincronizados.

## Riscos e suposições

- **`olist_orders.valor_total_pedido` como "faturamento realizado"
  provavelmente inclui pedidos cancelados.** Confirmado no banco local
  real: `situacao` (inteiro) tem 7 valores distintos observados
  (`0`: 61, `1`: 324, `3`: 1, `4`: 9, `5`: 4, `6`: 9, `7`: 1) e
  `lib/olist/sync/orders.ts` não filtra por `situacao` — sincroniza todos
  os pedidos como vêm. Não há mapeamento código→significado no código
  nem na documentação (`docs/integrations/olist.md`) hoje. Um dos códigos
  quase certamente é "cancelado" (a API pública da Olist Store costuma
  usar `situacao = 7` para isso, mas isso **não está confirmado** contra
  esta integração). Tratado como tarefa explícita do plano de
  implementação: confirmar o significado dos códigos (consultando a
  documentação da API Olist usada pela integração, ou o campo
  equivalente já decodificado em algum outro lugar do `raw` sincronizado)
  antes de escrever `loadRealizadoByMonth`. Se não for possível confirmar
  com certeza, a implementação deve somar todos os pedidos sem filtrar
  por `situacao` e documentar isso explicitamente na UI/no
  `docs/assumptions.md` como uma aproximação conhecida — nunca adivinhar
  silenciosamente qual código significa "cancelado".
- **Cenário aplicado ao "Planejado" do relatório Forecast vs Realizado é
  sempre Base (100%)** — uma limitação intencional desta fase, não um
  esquecimento; comparar contra outros cenários é adiado.
- **`forecast_scenario_multipliers` sem valor para um (ano, mes) vira
  100%** — arriscado se um cenário for criado antes de uma versão cobrir
  aquele mês (ex.: cenário criado para 2026, versão estendida para 2031
  sem que ninguém atualize o cenário); aceito como comportamento
  conhecido e documentado, não uma migração automática de multiplicadores
  para meses novos.
