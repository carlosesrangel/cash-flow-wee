# Confiabilidade das sincronizações Olist/SumUp

Este documento é a referência operacional atual para as sincronizações. Os
trechos históricos em `docs/assumptions.md` e versões antigas de
`docs/SYNC_SETUP.md` descrevem a implementação anterior e não substituem esta
configuração.

## Workflows

| Integração | Workflow | Frequência UTC | Janela incremental |
|---|---|---:|---|
| Olist | `.github/workflows/olist-daily-sync.yml` | `17 */4 * * *` | desde a última execução bem-sucedida, com sobreposição de 24 h |
| SumUp | `.github/workflows/sumup-daily-sync.yml` | `47 1-23/4 * * *` | desde a última execução bem-sucedida, com sobreposição de 24 h |

Ambos os workflows também aceitam `workflow_dispatch` com os modos
`incremental` e `initial`. Eles compartilham a concorrência
`production-financial-writes`, têm timeout de 150 minutos e falham com código
de saída diferente de zero quando a sincronização ou a atualização derivada
falha.

## Tokens e concorrência

- Olist usa OAuth2. O access token tem validade curta; quando expira, o cliente
  renova sob o lock de banco `olist-oauth`, persiste o novo access token e o
  novo refresh token e repete uma requisição que recebeu 401.
- O refresh token retornado pelo Olist é sempre gravado na mesma conexão antes
  de o job continuar. Um `invalid_grant` marca a conexão como exigindo
  reautorização; outras falhas são propagadas para o workflow.
- SumUp usa `SUMUP_API_KEY` estática neste projeto. Não há refresh token para
  renovar. O cliente usa retries para falhas transitórias e paginação segura.
- O lock `financial-sync` é adquirido por organização antes de gravar dados e
  impede que workflows concorrentes misturem checkpoints ou tokens.

## Checkpoints e observabilidade

`sync_runs.synced_through` registra até que data o job processou dados. O
incremental parte do último `success`, com sobreposição para absorver atrasos e
updates retroativos. Os gatilhos da migration `0034_sync_reliability.sql`
contam linhas inseridas e atualizadas nas tabelas de origem. Cada finalização
registra integração, status, duração, contagens, checkpoint e erro sanitizado.

## Secrets

Os workflows precisam dos seguintes secrets: `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `OLIST_CLIENT_ID`, `OLIST_CLIENT_SECRET`,
`SUMUP_API_KEY`, `SUMUP_MERCHANT_CODE` e `SUMUP_ORG_ID`. O `SUMUP_ORG_ID` limita
o job à organização que possui a credencial SumUp. Nenhum token é impresso nos
logs.
