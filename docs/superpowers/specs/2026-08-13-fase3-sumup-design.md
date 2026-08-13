# WEE Cash Flow — Fase 3: Integração SumUp

Data: 2026-08-13
Status: Aprovado para implementação

## Contexto

Com a Fase 2 (Olist) mesclada em `master`, esta spec cobre a **Fase 3** do
`Prompt Mestre_ WEE Cash Flow & Business Intelligence Platform.md`: integração
com a SumUp, conforme a seção 6 do documento mestre. A SumUp é source of
truth para liquidações (settlements) das vendas processadas por ela —
usada na Fase 4 para refinar data de liquidação, parcelas, taxas e valores
líquidos das contas a receber já sincronizadas da Olist, nunca somada a
elas (regra de não dupla contagem, seção 7 do documento mestre — mas essa
lógica de reconciliação em si é escopo da Fase 4, não desta).

Esta fase entrega apenas sincronização de dados (transactions, transaction
events, payouts) — o mesmo padrão estabelecido na Fase 2, sem motor de
taxas, sem perfil de recebimento, sem reconciliação.

## Documentação oficial consultada

Antes de desenhar esta spec, a documentação oficial atual foi consultada
diretamente em `https://developer.sumup.com` (não inventado):

- **Autenticação**: API key estática, transmitida como
  `Authorization: Bearer {SUMUP_API_KEY}`. Diferente da Olist, não há OAuth2
  — a chave já concede acesso completo à conta do merchant que a criou, sem
  fluxo de autorização interativo. Fonte:
  `developer.sumup.com/tools/authorization/api-keys`.
- **Base URL**: `https://api.sumup.com`.
- **Endpoints confirmados**:
  - `GET /v2.1/merchants/{merchant_code}/transactions/history` — lista
    paginada (`limit`, `order`), com filtros (`transaction_code`, `users[]`,
    `statuses[]`, `payment_types[]`, `entry_modes[]`, `types[]`) e filtro
    incremental `changes_since` (também `newest_time`/`oldest_time`,
    `newest_ref`/`oldest_ref`). Cada item da lista **não** inclui eventos —
    só campos principais (id, transaction_code, amount, currency, timestamp,
    status, payment_type, installments_count, card_type, payouts_total,
    payouts_received, payout_plan, refunded_amount, etc.).
  - `GET /v2.1/merchants/{merchant_code}/transactions` — detalhe de uma
    transação (por `id`, `transaction_code`, `foreign_transaction_id` ou
    `client_transaction_id`). **Só o detalhe traz `transaction_events[]`**
    (e uma versão compacta `events[]`) — mesmo padrão N+1 já visto na Olist
    (pedidos): listar histórico, depois buscar detalhe por transação para
    obter os eventos. Campos de evento: `id`, `event_type`
    (`PAYOUT`/`CHARGE_BACK`/`REFUND`/`PAYOUT_DEDUCTION`), `status`
    (`FAILED`/`PAID_OUT`/`PENDING`/`RECONCILED`/`REFUNDED`/`SCHEDULED`/`SUCCESSFUL`),
    `amount`, `date`, `due_date`, `timestamp`, `installment_number`.
  - `GET /v1.0/merchants/{merchant_code}/payouts` — lista de payouts.
    **Exige** `start_date`/`end_date` (formato `YYYY-MM-DD`) — não tem filtro
    incremental por data de atualização, só o intervalo do próprio payout.
    Campos: `id`, `type` (`PAYOUT`/`CHARGE_BACK_DEDUCTION`/
    `REFUND_DEDUCTION`/`DD_RETURN_DEDUCTION`/`BALANCE_DEDUCTION`), `amount`,
    `date`, `currency`, `fee`, `status` (`SUCCESSFUL`/`FAILED`), `reference`,
    `transaction_code`.
- Nenhum limite de taxa documentado publicamente para esses endpoints
  específicos — o cliente HTTP genérico já reaproveitado da Fase 2 (retry
  com backoff, respeitando `Retry-After` quando presente) cobre isso.

## Decisões confirmadas com o usuário

1. **Sem fluxo de "conectar"**: como a autenticação é uma chave estática já
   presente em `.env.local`, não existe UI de conexão. O card "SumUp" na
   tela de Integrações mostra status **"Configurado"** ou **"Erro de
   configuração"**, determinado por uma chamada de teste sob demanda —
   nenhuma linha em `integration_connections` é criada (não há token para
   guardar).
2. **Payouts com janela deslizante de 90 dias**: mesma estratégia já usada
   para contas a pagar/receber da Olist (`start_date = hoje - 90 dias`,
   `end_date` = hoje), já que a API exige intervalo obrigatório e não
   oferece filtro por data de atualização.
3. **Escopo**: só sincronização de dados. Motor de taxas históricas (seção
   12), perfil histórico de recebimento (seção 13) e reconciliação com a
   Olist (seção 7) ficam para fases futuras (Fase 4 e Fase 6).

## Arquitetura

### Sincronização

- `sumup_transactions`: lista via `/transactions/history` (paginado,
  `changes_since` para incremental), upsert dos campos principais.
- `sumup_transaction_events`: para cada transação sincronizada, busca o
  detalhe (`/transactions?id=...`) e faz upsert de `transaction_events[]`
  como linhas filhas (FK interna, delete-then-insert por transação — mesmo
  padrão de `olist_order_items`, incluindo a mesma checagem de erro no
  delete antes do insert, corrigida na revisão final da Fase 2).
- `sumup_payouts`: lista via `/payouts` com janela deslizante de 90 dias.
- Reaproveita da Fase 2 (generalizando onde fizer sentido, sem duplicar):
  helper de paginação (adaptado para o formato de paginação da SumUp, que
  pode diferir do `{itens, paginacao}` da Olist — a confirmar durante a
  implementação, não assumido aqui), `sync_runs` logging, cliente HTTP com
  retry/backoff respeitando `Retry-After`, orquestrador com detecção de modo
  inicial/incremental (mesma lógica: primeira sincronização = sem
  `changes_since`/janela ampliada; incremental = filtro normal), rota
  RBAC-gated de disparo manual, guarda contra sincronizações concorrentes
  (`sync_runs` com status `running` recente).

### Modelo de dados

Novas tabelas (`org_id` + RLS, mesmo padrão da Olist — RLS de leitura via
`is_org_member`, sem policy de escrita para `anon`/`authenticated`, só
`service_role` escreve):

- `sumup_transactions`
- `sumup_transaction_events`
- `sumup_payouts`

Campos exatos extraídos da documentação oficial acima — não inventados.
Cada tabela sincronizada mantém `raw jsonb not null` para preservar campos
não modelados explicitamente, seguindo o padrão já estabelecido.

### UI

Card "SumUp" na tela de Integrações substitui o placeholder criado na Fase
0+1: mostra status de configuração (não "conectado"/"desconectado" como a
Olist) + botão "Sincronizar agora" (sem "Conectar"/"Reconectar" — não existe
esse conceito aqui).

## Fora de escopo desta fase

- Motor de taxas históricas (seção 12 do documento mestre).
- Perfil histórico de recebimento (seção 13).
- Reconciliação com a Olist / prevenção de dupla contagem (seção 7, Fase 4).
- Refunds/estornos (endpoint existe na API, não sincronizado nesta fase —
  refunds aparecem como eventos `REFUND` dentro de `transaction_events`
  quando relevantes para uma transação já sincronizada).
- Qualquer escrita na SumUp — integração estritamente read-only, mesma
  regra da Olist.

## Segurança

- `SUMUP_API_KEY` só em `.env.local` (nunca commitado), lida apenas
  server-side — mesmo padrão de proteção (`server-only`) já aplicado aos
  módulos equivalentes da Olist na revisão final da Fase 2.
- Chamada de teste de conectividade não expõe a chave a nenhuma resposta
  client-side — só o resultado booleano/status.

## Testes

- Fixtures determinísticas baseadas nos schemas reais documentados acima
  (não a API de produção) para: paginação, mapeamento de campos, eventos de
  transação, janela deslizante de payouts, modo inicial vs. incremental,
  prevenção de sincronizações concorrentes.
- Nenhum teste automatizado toca a API real da SumUp.
- Teste manual end-to-end (feito pelo usuário, já com a chave configurada):
  disparar sync manual, conferir dados reais no Supabase Studio local —
  mesmo processo que revelou 3 bugs reais na Fase 2 e deve ser repetido
  aqui, já que a API da SumUp pode ter as mesmas classes de inconsistência
  entre documentação e comportamento real (formatos de data, campos vazios
  vs. nulos, paginação).

## Próximos passos (fora desta spec)

- Fase 4: Reconciliação (evitar dupla contagem Olist × SumUp).
- Fase 6: motor de taxas históricas e perfil de recebimento, usando os
  dados sincronizados aqui.
