# WEE Cash Flow — Fase 4: Reconciliação Financeira (Olist × SumUp)

Data: 2026-08-13
Status: Aprovado para implementação

## Contexto

Com a Fase 2 (Olist), a Fase 3 (SumUp) e uma correção de rate limit da Olist
já mescladas em `master`, esta spec cobre a **Fase 4** do
`Prompt Mestre_ WEE Cash Flow & Business Intelligence Platform.md`: a
camada de reconciliação descrita na seção 7 do documento mestre.

Regra fundamental (seção 7, verbatim): **nunca somar** Olist Orders + Olist
Accounts Receivable + SumUp Transactions diretamente — isso causaria dupla
contagem. É necessário criar uma camada explícita de reconciliação que
vincule cada conta a receber da Olist (quando aplicável) à liquidação SumUp
correspondente, usando a SumUp para refinar data de liquidação, parcelas,
taxas e valores líquidos — nunca contabilizando os dois recebimentos.

## Pesquisa em dados reais (não inventado)

Antes de desenhar o algoritmo de matching, a API real da Olist e dados reais
sincronizados de ambas as integrações foram inspecionados diretamente
(sync completo disparado contra a conta real da WEE, e consulta pontual ao
swagger oficial `https://erp.tiny.com.br/public-api/v3/swagger/swagger.json`
mais 3 chamadas de leitura pontuais à API real para confirmar campos do
endpoint de detalhe de `/contas-receber`). Achados que fundamentam as
decisões abaixo:

1. **Não existe chave exata entre SumUp e Olist.** O payload real de
   `sumup_transactions` não traz `foreign_transaction_id`; o
   `client_transaction_id` é um valor opaco gerado pelo terminal/gateway
   (ex.: `"88df904a-bae6-4d58-b69e-8f904f7ed11e"` no POS,
   `"rPp7HgmFGomrZo6AjAVkA5BMZf8YzIJKoMVPIJo0G3Q="` no ECOM) — não é um
   número de pedido nem de documento reconhecível. O matching precisa ser
   por heurística (valor + data + forma de pagamento), não por join exato.
2. **Granularidade confirmada**: cada parcela de uma venda parcelada na
   Olist vira uma linha própria em `contas a receber` (`historico` no
   formato `"Ref. a NF nº 516, Giovana Dias (parcela 3/3)"`,
   `numeroDocumento` `"000516/03"`), cada uma com seu próprio `valor`. Do
   lado SumUp, cada parcela é um `transaction_events[]` com seu próprio
   `installment_number` e `amount` (líquido, pós-taxa SumUp). O match é
   portanto **parcela Olist ↔ parcela/evento SumUp**, nunca a venda inteira
   de uma vez.
3. **Bruto vs. líquido**: o `amount` de um evento de parcela SumUp já vem
   com a taxa da SumUp descontada (evento de `R$ 774,80` para uma parcela
   de uma transação de `amount: 8092` ÷ 10 parcelas ≈ `R$ 809,20` bruto).
   Comparar isso contra o `valor` bruto da parcela Olist teria uma
   diferença sistemática do tamanho da taxa em todo match.
4. **A Olist já estima essa taxa por parcela, mesmo antes de qualquer
   pagamento**: o endpoint de **detalhe** de uma conta a receber
   (`GET /contas-receber/{id}`, não usado pelo sync atual, que só chama a
   listagem) traz `taxa`, `formaRecebimento` (`{id, nome}`, referência à
   mesma entidade já sincronizada em `olist_payment_methods`),
   `dataLiquidacao` e `valorPago` — nenhum desses campos existe na resposta
   de listagem. Exemplo real capturado (parcela 3/3, valor 380,00, ainda
   `aberto`): `taxa: 16.34` (≈4,3%), `formaRecebimento: {"nome": "Cartão de
   crédito"}`, `valorPago: 0`, `dataLiquidacao: ""`. `valor - taxa` (≈
   363,66) é um proxy bem mais próximo do valor líquido real da SumUp do
   que "bruto ÷ parcelas".
5. **A premissa da Fase 4 é validada pelos dados reais**: consultando a API
   real por `situacao`, a conta da WEE tem 625 contas a receber `aberto`
   (542 `atrasadas`) e **zero** em `pago`, `parcial`, `cancelada` ou
   `prevista`. A Olist não é usada para controlar se algo foi efetivamente
   pago — a SumUp é, de fato, a única fonte de verdade disponível para
   "isso foi pago e quando", confirmando o motivo de existir desta fase.

## Decisões confirmadas com o usuário

1. **Conflito exige resolução manual**: quando o matching automático
   encontrar mais de um candidato válido (valor + data + forma de
   pagamento todos dentro da tolerância) para uma parcela, nenhum é
   escolhido automaticamente — fica marcado como `conflito` até um
   OWNER_ADMIN ou MANAGER escolher manualmente.
2. **Bruto vs. líquido**: comparar sempre **bruto contra bruto** (valor
   estimado líquido da Olist, `valor - taxa`, ainda é uma aproximação do
   bruto original — ver arquitetura abaixo para a fórmula exata usada no
   matching) contra o valor líquido real do evento SumUp; o valor líquido
   da SumUp só é usado para *enriquecer* depois do match confirmado
   (data de liquidação, taxa, valor líquido definitivo), nunca para decidir
   o match em si.
3. **RBAC**: OWNER_ADMIN e MANAGER podem confirmar/desfazer matches na tela
   de Reconciliação; VIEWER só visualiza.
4. **Gatilho**: o motor de reconciliação roda automaticamente após cada
   sync bem-sucedido (Olist ou SumUp), não é um botão manual separado.
5. **Escopo estendido confirmado após os achados acima**: a sincronização
   de contas a receber da Olist passa a buscar o **detalhe** de cada
   parcela (mesmo padrão N+1 já usado em pedidos da Olist e transações da
   SumUp), para trazer `taxa`, `formaRecebimento` e `dataLiquidacao` — sem
   isso, o matching ficaria preso à aproximação "bruto ÷ parcelas", mais
   imprecisa. Candidatos de matching são restritos a contas cujo
   `formaRecebimento.nome` seja `"Cartão de crédito"` ou `"Cartão de
   débito"` — outras formas de recebimento (Pix, dinheiro, boleto etc.)
   nunca passam pela SumUp e são excluídas do universo de candidatos.

## Arquitetura

### Extensão da sincronização de contas a receber (Olist)

- `lib/olist/sync/accounts-receivable.ts` passa a, após a página de
  listagem, buscar o detalhe (`GET /contas-receber/{id}`) de cada conta
  cujo `formaRecebimento` (quando já conhecido de um sync anterior) seja
  cartão, ou de todas na primeira vez que uma conta é vista — decisão de
  implementação: buscar detalhe de **todas**, já que a listagem não informa
  `formaRecebimento` antecipadamente e o volume observado na conta real
  (625 contas) é administrável dentro do rate limit já implementado na
  Fase 3.1 (25 req/min, ver `lib/olist/client.ts`).
- Novas colunas em `olist_accounts_receivable` (migration):
  `taxa numeric`, `valor_pago numeric`, `forma_recebimento_id bigint`,
  `forma_recebimento_nome text`, `data_liquidacao date`. Campos vazios
  (`""`) da API normalizados via `emptyToNull` (mesmo padrão já
  estabelecido).
- Mesma janela deslizante já usada (90 dias incremental / 3650 dias
  inicial), sem mudança de estratégia de data — só adiciona o detalhe por
  linha.

### Motor de reconciliação

- Novo módulo `lib/reconciliation/`, executado ao final de
  `runOlistSync`/`runSumupSync` quando o resultado for `success`.
- Para cada `olist_accounts_receivable` com `forma_recebimento_nome` em
  `('Cartão de crédito', 'Cartão de débito')` e ainda sem
  `reconciliation_matches` resolvido:
  1. Calcular `valor_bruto_estimado = valor` (a Olist já registra o valor
     bruto da parcela — `taxa` é informativo/estimado, não subtraído do
     `valor` armazenado).
  2. Buscar candidatos entre `sumup_transaction_events` (tipo
     `event_type = 'PAYOUT'`, mesmo `installment_number` coerente com a
     posição da parcela) cujo evento pertença a uma transação com `status
     = 'SUCCESSFUL'`, dentro de uma janela de ±5 dias entre
     `data_vencimento` (Olist) e `event.due_date` (SumUp), comparando o
     **bruto estimado da SumUp** (`sumup_transactions.amount /
     installments_count`, arredondado ao centavo) contra o `valor` da
     parcela Olist, com tolerância de até R$ 0,05 (cobre resíduo de divisão
     inteira entre parcelas — ex.: `amount` não divisível exatamente pelo
     número de parcelas).
  3. Sem candidato → `nao_reconciliado`. Um candidato → `reconciliado_automaticamente`.
     Mais de um → `conflito`.
  4. Após confirmado (automático ou manual), os campos de enriquecimento
     na visão de caixa (Fase 5) usam o valor líquido real do evento SumUp
     (`sumup_transaction_events.amount`), a data efetiva
     (`sumup_transaction_events.event_date`/`due_date`) e a taxa real por
     parcela (`fee_amount` dentro do `raw` jsonb de cada evento — não é uma
     coluna tipada hoje; `sumup_transactions.fee_amount` é o total da
     transação inteira, não da parcela) — nunca o valor bruto da Olist
     somado ao valor da SumUp.

### Modelo de dados

Nova tabela `reconciliation_matches` (org_id + RLS, mesmo padrão
`is_org_member` para SELECT, escrita só via `service_role`):

- `id`, `org_id`
- `olist_accounts_receivable_id` (FK, uma parcela)
- `sumup_transaction_id` (FK, nullable até resolvido)
- `sumup_transaction_event_id` (FK, nullable até resolvido)
- `status` (`reconciliado_automaticamente` | `reconciliado_manualmente` |
  `nao_reconciliado` | `conflito`)
- `match_reason` (jsonb — sinais que bateram/não bateram: diferença de
  valor, diferença de data, forma de pagamento)
- `candidate_ids` (jsonb, só para `conflito` — lista de
  `sumup_transaction_event_id` candidatos)
- `resolved_by` (uuid, nullable — membro que confirmou manualmente)
- `resolved_at` (timestamptz, nullable)
- `created_at`, `updated_at`

Unique constraint em `(org_id, olist_accounts_receivable_id)` — cada
parcela tem no máximo um registro de reconciliação, atualizado em cada
execução do motor (upsert), não recriado.

### UI

Nova tela **Reconciliação** (já prevista na navegação, seção 36 do
documento mestre): lista as parcelas por status
(`reconciliado_automaticamente` / `reconciliado_manualmente` /
`nao_reconciliado` / `conflito`), com ação de "confirmar candidato" (para
`conflito`, escolhendo entre os `candidate_ids`) e "desfazer match" (volta
para `nao_reconciliado`), visível/editável só para OWNER_ADMIN/MANAGER;
VIEWER vê a lista em modo leitura.

## Fora de escopo desta fase

- Motor de taxas históricas completo e perfil de recebimento (seção 12/13
  do documento mestre — Fase 6).
- Uso dos resultados da reconciliação no motor de fluxo de caixa (Fase 5) —
  esta fase só produz e mantém `reconciliation_matches`, não altera nenhum
  cálculo de saldo/projeção ainda.
- Refunds/estornos como cenário de reconciliação — eventos `REFUND` já
  sincronizados como `transaction_events`, mas o tratamento de reembolso na
  reconciliação (ex.: parcela paga e depois estornada) fica para quando o
  motor de fluxo de caixa (Fase 5) precisar dele.
- Reconciliação de contas a pagar (`olist_accounts_payable`) — a SumUp é
  fonte de recebimentos, não de pagamentos a fornecedores; fora do escopo
  da seção 7.

## Segurança

- Nenhum dado novo sensível introduzido além do que já é sincronizado
  (taxa, forma de recebimento e data de liquidação são dados financeiros
  operacionais, mesmo nível de sensibilidade já tratado nas Fases 2/3).
- RLS + RBAC seguem exatamente o padrão já estabelecido.

## Testes

- Fixtures determinísticas para: geração de candidatos (0/1/N), tolerância
  de valor e data, filtro por forma de recebimento, granularidade por
  parcela (installment_number), upsert idempotente de
  `reconciliation_matches` (rodar o motor duas vezes não duplica nem perde
  status manual já resolvido).
- Teste explícito de "nunca dupla contagem": um caso onde uma parcela
  reconciliada não pode ser contada duas vezes se o motor rodar de novo
  após um novo sync.
- Nenhum teste automatizado toca a API real — mesmo padrão das Fases 2/3.
- Teste manual: como sempre, revisão dos dados reais no Supabase Studio
  local ao final da implementação.

## Próximos passos (fora desta spec)

- Fase 5: Cash Flow Engine — primeiro consumidor real de
  `reconciliation_matches`.
- Fase 6: motor de taxas históricas e perfil de recebimento.
