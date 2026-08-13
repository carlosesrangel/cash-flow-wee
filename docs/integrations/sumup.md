# Integração SumUp

Status: implementada na Fase 3. Autenticação por API key estática (sem OAuth2).

## Autenticação

- Base URL: `https://api.sumup.com`
- `Authorization: Bearer {SUMUP_API_KEY}` — chave estática obtida em
  me.sumup.com → Configurações → For Developers → Toolkit → API Keys.
  Concede acesso total à conta do merchant que a criou; a SumUp não guarda
  cópia, então a chave precisa ser preservada com segurança (já está em
  `.env.local`, nunca commitada).
- `SUMUP_MERCHANT_CODE` identifica a conta nos paths dos endpoints.
- Sem fluxo de conexão interativo, sem refresh de token — diferente da
  Olist. O status "Configurado"/"Erro de configuração" na tela de
  Integrações vem de uma chamada de teste sob demanda, não de estado
  persistido.

## Endpoints utilizados

| Recurso | Endpoint | Paginação |
|---|---|---|
| Histórico de transações | `GET /v2.1/merchants/{merchant_code}/transactions/history` | Hypermedia (`{items, links}`, segue `links[rel=next].href`) |
| Detalhe de transação (+ eventos) | `GET /v2.1/merchants/{merchant_code}/transactions?transaction_code=...` | N/A (registro único) |
| Payouts | `GET /v1.0/merchants/{merchant_code}/payouts` | Array simples, exige `start_date`/`end_date` |

## Estratégia incremental

- Transações: `changes_since` na própria API.
- Payouts: sem filtro de data de atualização — janela deslizante de 90 dias
  (`start_date = hoje - 90 dias`, `end_date = hoje`) em toda sincronização,
  igual à estratégia da Olist para contas a pagar/receber. Sincronização
  `initial` usa uma janela de ~10 anos para capturar todo o histórico na
  primeira conexão (mesma correção aplicada à Olist na revisão final da
  Fase 2).

## Edge cases e limitações conhecidas

- `transaction_events[]` só existe no endpoint de detalhe — o histórico não
  traz eventos. Isso significa uma chamada de detalhe por transação durante
  o sync (mesmo padrão N+1 da sincronização de pedidos da Olist), com o
  mesmo risco de rate limiting em volumes grandes.
- Nenhum limite de taxa documentado publicamente — o cliente
  (`lib/sumup/client.ts`) reaproveita a lógica de retry/backoff com
  `Retry-After` já validada na Olist.
- Nenhuma escrita na SumUp nesta fase nem planejada até segunda ordem —
  integração estritamente read-only.
- Sem motor de taxas históricas, perfil de recebimento ou reconciliação com
  a Olist nesta fase — ver Fases 4 e 6 do documento mestre.
