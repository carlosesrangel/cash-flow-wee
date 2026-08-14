# Integração Olist ERP / Tiny

Status: implementada na Fase 2. API V3, OAuth2.

## Autenticação

- Base URL: `https://api.tiny.com.br/public-api/v3`
- Authorization: `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth`
  (`client_id`, `redirect_uri`, `scope=openid`, `response_type=code`)
- Token: `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token`
  (`grant_type=authorization_code` na troca inicial, `grant_type=refresh_token`
  na renovação)
- Access token expira em 4 horas. Refresh token expira em 1 dia — se nenhum
  sync rodar dentro dessa janela, a conexão cai para `precisa_reautorizar` e
  exige reconexão manual via `/api/integracoes/olist/connect`.
- Credenciais: `OLIST_CLIENT_ID`, `OLIST_CLIENT_SECRET`, `OLIST_REDIRECT_URI`,
  `OLIST_STATE_SECRET` em `.env.local`.
- Aplicativo criado no painel Olist/Tiny: Configurações → aba Geral →
  Aplicativos. Máximo 5 aplicativos por conta. Alterar permissões exige gerar
  um novo Client Secret.

## Endpoints utilizados

| Entidade | Endpoint | Paginação | Incremental |
|---|---|---|---|
| Contatos | `GET /contatos` | limit/offset | `dataAtualizacao` |
| Vendedores | `GET /vendedores` | limit/offset | não (tabela pequena, full sync sempre) |
| Formas de pagamento | `GET /formas-pagamento` | limit/offset | não (tabela pequena, full sync sempre) |
| Produtos | `GET /produtos` | limit/offset | não (full sync sempre nesta fase) |
| Pedidos | `GET /pedidos` (lista) + `GET /pedidos/{id}` (detalhe, traz itens/cliente/vendedor/pagamento) | limit/offset | `dataAtualizacao` |
| Contas a pagar | `GET /contas-pagar` | limit/offset | janela deslizante (sem filtro de data de atualização na API) |
| Contas a receber | `GET /contas-receber` (lista) + `GET /contas-receber/{id}` (detalhe, traz taxa/forma de recebimento/data de liquidação — Fase 4) | limit/offset | janela deslizante (sem filtro de data de atualização na API) |

Todos os endpoints acima retornam o mesmo formato de envelope de paginação,
`{ itens, paginacao }`. Isso inclui `/contas-pagar`: a especificação OpenAPI
publicada pela Olist descreve um schema de resposta diferente para esse
endpoint especificamente, o que levantou dúvida durante a implementação sobre
se o wrapper real seria diferente dos demais. Verificado ao vivo com
`GET /contas-pagar?limit=1` contra uma conta conectada real: a resposta usa
exatamente o mesmo wrapper `{itens, paginacao}` de todos os endpoints irmãos.
Confirmado que é um bug de documentação da Olist (schema OpenAPI desatualizado
ou incorreto só para esse endpoint), não uma inconsistência real de
comportamento da API — não requer nenhum tratamento especial no código.

## Estratégia incremental

- `pedidos` e `contatos`: usam o parâmetro `dataAtualizacao` da própria API.
- `contas-pagar`/`contas-receber`: a API não oferece filtro de data de
  atualização, só `dataInicialEmissao`/`dataFinalEmissao` e
  `dataInicialVencimento`/`dataFinalVencimento`. Estratégia adotada: toda
  sincronização (inicial ou incremental) busca a partir de
  `dataInicialVencimento = hoje - 90 dias`, sem data final — isso cobre
  contas futuras e recapture baixas/pagamentos recentes em contas já
  existentes sem precisar resync completo do histórico. O período de 90 dias
  é configurável via o parâmetro `windowDays` de `syncAccountsPayable`/
  `syncAccountsReceivable`.
- `produtos`, `vendedores`, `formas-pagamento`: full sync a cada execução
  (volumes pequenos, sem custo relevante).

## Edge cases e limitações conhecidas

- **`dataAtualizacao` em `/contatos` exige formato de data e hora, não uma
  data simples.** Verificado ao vivo: `dataAtualizacao=2026-01-01` retorna
  400 (`"Este valor não é uma data e hora válida"`), enquanto
  `dataAtualizacao=2026-01-01 00:00:00` (separado por espaço, **não** por
  `T` como no ISO 8601) retorna 200 OK. Isso é inconsistente com o mesmo
  parâmetro em `/pedidos`, que aceita uma data simples sem problema (também
  verificado ao vivo) — a exigência de datetime é uma peculiaridade
  específica de `/contatos`, não um padrão geral da API. O código
  (`lib/olist/sync/contacts.ts`) já trata isso concatenando `" 00:00:00"`
  ao valor de data antes de enviar o parâmetro.
- **A API Olist retorna string vazia (`""`) — não `null` nem a chave
  omitida — para campos de data não preenchidos.** O Postgres rejeita `""`
  como literal `timestamptz`/`date` inválido. Tratado com o helper
  compartilhado `emptyToNull()` (`lib/integrations/date.ts`), aplicado a todo campo
  de data nos upserts de pedidos e contatos.
- **Rate limit (`429`) em buscas sequenciais rápidas de detalhe de pedido**
  (`GET /pedidos/{id}`) durante sync de grande volume — observado ao vivo no
  meio de uma execução real de sync. Não há rate limit documentado
  publicamente pela Olist, mas ele existe na prática. O retry com backoff
  exponencial já existente no client (`lib/olist/client.ts`, 3 tentativas)
  não absorveu completamente o caso observado. Limitação conhecida desta
  fase, não corrigida — fica como follow-up para quando o volume de pedidos
  da WEE crescer o suficiente para importar (hoje o volume é pequeno).
- Refresh token válido por apenas 1 dia — sem agendamento automático (fora do
  escopo desta fase), a integração cai para `precisa_reautorizar` sempre que
  ninguém sincronizar manualmente por mais de ~1 dia. Isso é esperado, não é
  bug.
- `GET /pedidos/{id}` é chamado uma vez por pedido durante o sync (a listagem
  não traz itens) — para contas com muitos pedidos, isso significa N+1
  chamadas por sync. Aceitável para o volume da WEE; se o volume crescer,
  vale revisitar (relacionado ao rate limit acima).
- Nenhuma escrita na Olist é feita nesta fase nem está planejada até segunda
  ordem — integração estritamente read-only.
- **`syncAccountsReceivable` busca o detalhe de toda conta a receber
  listada, não só as pagas em cartão** (Fase 4): a listagem não informa
  `formaRecebimento` antecipadamente, então não há como filtrar antes de
  buscar o detalhe. No volume observado (~625 contas na conta real da WEE)
  isso fica dentro do rate limit já aplicado por `lib/olist/client.ts`; se
  o volume crescer ordens de magnitude, essa chamada N+1 por linha se torna
  o gargalo dominante da sincronização de contas a receber.
