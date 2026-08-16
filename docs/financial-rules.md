# Regras Financeiras

Nenhuma regra financeira é implementada na Fase 0+1 — não há cálculo de
fluxo de caixa, taxas, forecast, sazonalidade, mix de pagamento, impostos ou
reconciliação nesta fase. Este documento será preenchido incrementalmente a
partir da Fase 4 (Reconciliation Layer) em diante, uma seção por motor:

- Fase 4: regra de reconciliação (evitar dupla contagem Olist × SumUp).
- Fase 5: motor de fluxo de caixa (realizado/contratado/projetado/simulado).
- Fase 6: forecast, sazonalidade intramês, mix de pagamento, perfil de
  recebimento, versionamento de forecast, cenários.
- Fase 9: RBT12 e regras tributárias versionadas.

## Fase 5: motor de fluxo de caixa

Implementação: `lib/cash-flow/classify.ts`, `lib/cash-flow/engine.ts`,
`lib/cash-flow/aggregate.ts`, `lib/cash-flow/aging.ts`, `lib/cash-flow/dates.ts`.

### Classificação realizado vs. contratado

Decide pelo campo numérico `saldo`, não pelo texto de `situacao` (ver
ADR-006): `saldo == 0` é `realizado`, `saldo > 0` é `contratado`, tanto para
contas a receber (`classifyAccountsReceivable`) quanto para contas a pagar
(`classifyAccountsPayable`). `situacao` só decide inclusão/exclusão: linhas
com `situacao = 'cancelado'` são excluídas (`reason: 'cancelado'`); qualquer
`situacao` fora do conjunto conhecido (`aberto`, `pago`, `cancelado`) é
excluída como `situacao_desconhecida` em vez de cair silenciosamente em
`aberto`; e `valor`/`saldo`/data ausentes excluem a linha como
`dados_incompletos`. Nenhuma dessas exclusões é fabricada — a UI mostra o
motivo (ver Contas a Receber/Pagar, Tasks 8–9), nunca apenas omite a linha.

### Data de caixa

- **Contas a receber**: prioridade `reconciledCashDate` (o `due_date` do
  evento SumUp vinculado, quando a parcela tem um match de reconciliação
  resolvido — `lib/cash-flow/engine.ts`'s `loadReconciledCashDates`, per
  ADR-002) → `data_liquidacao` → `data_vencimento`. Sem nenhuma das três, a
  linha é excluída (`dados_incompletos`), nunca uma data é inventada.
- **Contas a pagar**: apenas `data_vencimento`, inclusive para linhas já
  `realizado` (`saldo == 0`) — limitação documentada, não um fato inventado:
  a listagem `/contas-pagar` da Olist não expõe uma data efetiva de
  pagamento (ver `docs/integrations/olist.md` e o risco correspondente em
  `docs/assumptions.md`).

### Aging (contas em aberto)

`computeAgingBucket` (`lib/cash-flow/aging.ts`) mede a diferença em dias
entre `hoje` e a data de caixa da linha, em faixas fixas do Prompt Mestre
seção 10: `vencido` (diferença negativa), `0-7`, `8-15`, `16-30`, `31-60`,
`61-90`, `90+`.

### Rollforward diário de saldo

`aggregateByDay` (`lib/cash-flow/aggregate.ts`) agrupa as entradas
classificadas por dia dentro de um intervalo e aplica, para cada dia:

```
saldoFinal = saldoInicial + (entradas.realizado + entradas.contratado)
                           - (saidas.realizado + saidas.contratado)
```

`saldoFinal` de um dia vira `saldoInicial` do dia seguinte. O `saldoInicial`
do primeiro dia vem de `resolveOpeningBalance` (`lib/cash-flow/engine.ts`):
o `cash_balance_snapshots` confirmado mais recente antes da data (em empate
de `reference_date`, o de `created_at` mais recente), mais qualquer
`manual_cash_entries` do tipo `ajuste_saldo` datado estritamente entre esse
snapshot e a data, mais todo lançamento do bucket `realizado` (AR/AP já
liquidado e `entrada`/`saida` manual) datado nesse mesmo intervalo — dinheiro
que de fato se movimentou depois do snapshot e precisa ser carregado adiante.
Lançamentos `contratado` no intervalo são deliberadamente ignorados: eles não
são caixa confirmado e misturá-los transformaria o saldo confirmado em
projeção. Quando não existe nenhum snapshot ainda,
`resolveOpeningBalance` retorna `null` e todo `saldoInicial`/`saldoFinal` da
faixa fica `null` — mostrar fluxos sem saldo corrente é aceitável,
fabricar um saldo inicial não é (Prompt Mestre seção 51).
