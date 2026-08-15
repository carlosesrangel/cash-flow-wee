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

## Desfazer uma reconciliação e o status `rejeitado_manualmente`

Quando um `OWNER_ADMIN` ou `MANAGER` desfaz (`POST /api/reconciliacao/desfazer`)
uma reconciliação:
- Se a parcela estava `reconciliado_automaticamente`, ela passa para
  `rejeitado_manualmente` — um terminal que o motor nunca re-tenta, capturando
  a intenção humana de "esse match estava errado, não tente novamente".
- Se a parcela estava `reconciliado_manualmente` (resultado de um "Confirmar"
  manual na tela de conflito), ela volta para `nao_reconciliado`, permitindo
  re-matching futuro — esse é o comportamento original e inalterado.

O status `rejeitado_manualmente` aparece explicitamente em `reconciliation_matches`
e é consultado pelo motor antes de tentar um novo match — se uma parcela já
chegou a `rejeitado_manualmente` uma vez, fica ali.

## Guarda de deduplicação: uma SumUp não pode ter dois matches

Após executar o motor automático (ou após o usuário confirmar um match manual),
uma passada de deduplicação (`lib/reconciliation/dedup.ts`) garante que nunhuma
SumUp está apontada por duas parcelas Olist simultaneamente:

- Se dois matches tentam apontar para a mesma SumUp, o perdedor é rebaixado de
  `reconciliado_automaticamente`/`reconciliado_manualmente` para `conflito`.
- Em caso de empate automático (ambos `reconciliado_automaticamente`), a
  deduplicação preserva o match de **criação mais antiga**, descartando o mais
  recente — a ideia é que o primeiro match que "pegou" a SumUp tinha mais
  chance de ser correto.
- A regra de desempate **nunca** sobrescreve uma resolução manual: se uma
  parcela está `reconciliado_manualmente`, ela vence sobre qualquer match
  `reconciliado_automaticamente` também apontando para a mesma SumUp, sem
  importar timestamps. Assim, uma confirmação manual é definitiva até que o
  usuário a desfaça explicitamente.

## Candidatos com detalhe de valor e data

Quando o usuário vê a lista de candidatos em `/reconciliacao` para resolver um
conflito, cada candidato agora carrega `amount` e `date` na estrutura
`match_reason.candidatos` — permitindo mostrar na UI não apenas um ID de
fragmento (`sumup_transaction_id`), mas também o valor e data da transação
SumUp correspondente. Se o detalhe não estiver disponível (falha de sync ou
dados ausentes), a exibição degrada graciosamente mostrando apenas o ID.

## Teste de integração

Para validar o motor contra um banco Postgres real (não apenas fixtures):

```bash
# Inicia um Supabase local (se ainda não estiver rodando)
npx supabase start

# Executa a suite de integração
npm run test:integration
```

O test suite (`tests/integration/reconciliation.ts`) exercita o engine completo,
executando syncs de Olist/SumUp contra fixtures carregadas no banco, validando
que matches foram criados corretamente, e confirmando comportamentos de
desfazer e deduplicação contra dados persistidos reais.

## Fora de escopo desta fase

Ver a seção "Fora de escopo" da spec: motor de taxas históricas (Fase 6),
uso da reconciliação no cálculo de fluxo de caixa (Fase 5), reembolsos, e
reconciliação de contas a pagar.
