# Reconciliação Financeira (Olist × SumUp)

Status: implementada na Fase 4. Ver
`docs/superpowers/specs/2026-08-13-fase4-reconciliacao-design.md` para a
pesquisa em dados reais e as decisões que fundamentam este documento.

## Por que existe

A WEE não pode somar Olist Orders + Olist Accounts Receivable + SumUp
Transactions diretamente para saber o que efetivamente entrou em caixa —
isso contaria a mesma venda duas vezes (uma pela Olist, outra pela SumUp).
Esta camada vincula cada parcela de conta a receber da Olist paga em cartão
à sua liquidação correspondente na SumUp, para que fases futuras (Fase 5,
motor de fluxo de caixa) tenham uma fonte única e não-duplicada de "isso foi
pago, quando, e por qual valor líquido".

## Como o matching funciona

- Só entram no universo de candidatos as parcelas da Olist cuja
  `forma_recebimento_nome` seja `"Cartão de crédito"` ou `"Cartão de
  débito"` — outras formas de recebimento nunca passam pela SumUp.
- O matching é por **parcela**, não pela venda inteira: o número da parcela
  é extraído do sufixo `/NN` de `numeroDocumento` (`lib/reconciliation/match.ts`,
  `parseInstallmentNumber`) e comparado ao `installment_number` de cada
  `sumup_transaction_events` do tipo `PAYOUT`.
- Comparação é sempre **bruto contra bruto**: o `valor` da parcela Olist
  (já bruto) contra `sumup_transactions.amount / installments_count`
  (estimativa do bruto por parcela da SumUp, arredondada ao centavo) — nunca
  contra o valor líquido do evento SumUp, que já vem descontado da taxa.
- Tolerância: até R$ 0,05 de diferença de valor, ±5 dias entre
  `data_vencimento` (Olist) e `due_date` (SumUp).
- 0 candidatos → `nao_reconciliado`. 1 candidato → `reconciliado_automaticamente`.
  Mais de 1 → `conflito`, resolvido manualmente na tela `/reconciliacao` por
  um `OWNER_ADMIN`/`MANAGER`.

## Quando roda

Automaticamente ao final de todo `runOlistSync`/`runSumupSync` bem-sucedido
(`lib/reconciliation/index.ts`, chamado a partir de
`lib/olist/sync/index.ts` e `lib/sumup/sync/index.ts`) — não há botão manual
separado. Uma falha no motor de reconciliação marca a `sync_runs` inteira
como `failed`, mesmo que a sincronização em si tenha funcionado.

## Idempotência

`reconciliation_matches` tem `unique (org_id, olist_accounts_receivable_id)`
e o motor faz upsert. Uma parcela já resolvida (`reconciliado_automaticamente`
ou `reconciliado_manualmente`) nunca é reprocessada em execuções seguintes —
só parcelas ainda `nao_reconciliado`/`conflito` (ou sem registro algum) são
reavaliadas.

## Fora de escopo desta fase

Ver a seção "Fora de escopo" da spec: motor de taxas históricas (Fase 6),
uso da reconciliação no cálculo de fluxo de caixa (Fase 5), reembolsos, e
reconciliação de contas a pagar.
