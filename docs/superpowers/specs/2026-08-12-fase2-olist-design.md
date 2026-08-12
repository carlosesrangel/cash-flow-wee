# WEE Cash Flow — Fase 2: Integração Olist (API V3)

Data: 2026-08-12
Status: Aprovado para implementação

## Contexto

Com a Fase 0+1 (Fundação) mesclada em `master`, esta spec cobre a **Fase 2** do
`Prompt Mestre_ WEE Cash Flow & Business Intelligence Platform.md`: integração
com a Olist ERP (Tiny), usando a API V3 com OAuth2, conforme exigido pela
seção 5.1 do documento mestre. A Olist é source of truth para pedidos,
clientes, produtos vendidos, faturamento operacional, contas a pagar, contas
a receber e fornecedores.

Esta fase entrega: conexão OAuth2, motor de sincronização (inicial +
incremental + manual), armazenamento normalizado dos dados no Postgres, e a
página "Saúde das Integrações" (criada na Fase 0+1 como placeholder) passando
a mostrar execuções reais via `sync_runs`.

Não inclui: motor de fluxo de caixa, reconciliação com SumUp, cálculos
financeiros de qualquer tipo — esses vêm em fases posteriores.

## Documentação oficial consultada

Antes de desenhar esta spec, a documentação oficial atual foi consultada
diretamente (não inventado):

- Especificação OpenAPI 3.0 completa da "Olist ERP API v3" (versão 3.1, 124
  endpoints), obtida em `https://erp.tiny.com.br/public-api/v3/swagger/swagger.json`.
- Portal de documentação oficial: `https://api-docs.erp.olist.com`
  (seção `/documentacao/comecando/autenticacao` para o fluxo OAuth2, e
  `/hubs-e-plataformas-via-api/aplicativos-api-v3-configuracoes-e-utilizacao`
  para criação do aplicativo).

Fatos confirmados diretamente nessas fontes (não suposições):

- **Base URL da API**: `https://api.tiny.com.br/public-api/v3`
- **Autenticação**: Bearer token, obtido via OAuth2 (Keycloak):
  - Authorization: `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth`
    (`client_id`, `redirect_uri`, `scope=openid`, `response_type=code`)
  - Token: `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token`
    (`grant_type=authorization_code` para troca inicial;
    `grant_type=refresh_token` para renovação)
  - **Access token expira em 4 horas. Refresh token expira em 1 dia.** Isso é
    uma restrição do fornecedor e molda diretamente o design da seção 3
    abaixo.
- **Paginação**: `limit`/`offset` em todos os endpoints de listagem.
- **Sync incremental**: `/pedidos` e `/contatos` aceitam filtro
  `dataAtualizacao`. `/contas-pagar` e `/contas-receber` **não têm** filtro
  de data de atualização — só `dataInicialEmissao`/`dataFinalEmissao` e
  `dataInicialVencimento`/`dataFinalVencimento`.
- **Detalhe do pedido** (`GET /pedidos/{idPedido}`) já traz embutidos:
  `itens` (array), `cliente`, `vendedor`, `pagamento`, `intermediador`,
  `transportador`, `deposito`, `enderecoEntrega`, `naturezaOperacao` — não
  existe endpoint separado de "itens do pedido".
- **Criação do aplicativo**: painel Olist/Tiny → Configurações → aba Geral →
  Aplicativos → "+ novo aplicativo". Gera `client_id`/`client_secret`.
  Máximo 5 aplicativos por conta. **Alterar permissões exige gerar um novo
  Client Secret**, quebrando a integração até atualizar as credenciais
  armazenadas.
- Nenhum limite de taxa (rate limit) documentado publicamente — o motor de
  sync trata isso de forma conservadora com retry/backoff, ajustando
  empiricamente se necessário.

O arquivo OpenAPI completo (`swagger.json`, 1.1MB, 124 endpoints) foi salvo
localmente para uso durante a fase de plano, garantindo que os campos exatos
de cada tabela sejam extraídos da fonte real, nunca inventados.

## Decisões confirmadas com o usuário

1. **Aplicativo OAuth2**: já criado no painel da Olist pelo usuário, com
   `redirect_uri = http://localhost:3000/integracoes/olist/callback` e
   permissões de leitura para Contatos, Sales Orders, Accounts Payable,
   Accounts Receivable, Payment Methods, Products. `OLIST_CLIENT_ID` e
   `OLIST_CLIENT_SECRET` já estão em `.env.local` (nunca commitados).
2. **Sync de contas a pagar/receber**: como a API não oferece filtro de data
   de atualização para essas entidades, a estratégia é **janela deslizante**
   — toda sincronização incremental reprocessa os últimos ~60-90 dias de
   vencimento (além de qualquer conta nova fora dessa janela via emissão),
   capturando baixas/pagamentos recentes sem precisar resync completo do
   histórico.
3. **Sincronização automática**: nesta fase, construímos o motor completo
   (inicial, incremental, manual, retry, logging) e um botão "Sincronizar
   agora" na tela de Integrações. Agendamento real (Vercel Cron / Supabase
   pg_cron) fica documentado como próximo passo para quando houver deploy de
   produção — não implementado agora. Consequência aceita: como o refresh
   token expira em 1 dia, se ninguém sincronizar por mais de ~1 dia, a
   conexão cai para o estado `precisa_reautorizar` e exige reconectar
   manualmente via OAuth2 — isso é esperado nesta fase, não é bug.
4. **Armazenamento de tokens**: tabela `integration_connections` sem nenhuma
   RLS policy de SELECT/INSERT/UPDATE para `anon`/`authenticated` — só
   `service_role` (nunca exposto ao navegador) acessa `client_secret`,
   `access_token`, `refresh_token`. A UI só enxerga o campo `status` via uma
   view/endpoint restrito.

## Arquitetura

### Conexão OAuth2

```text
Usuário clica "Conectar" na tela Integrações → Olist
  -> GET /api/integracoes/olist/connect
     (redireciona para o Authorization URL da Olist com state assinado)
  -> Usuário faz login/autoriza no painel da Olist
  -> Olist redireciona para /integracoes/olist/callback?code=...&state=...
  -> Server valida state, troca code por access_token/refresh_token
     no Token URL
  -> Grava em integration_connections (org_id, provider='olist',
     access_token, refresh_token, expires_at, status='conectado')
```

`client_secret`, `access_token` e `refresh_token` nunca são lidos por
código client-side — só em route handlers/server actions rodando no
servidor Next.js com acesso `service_role` ao Postgres.

### Renovação de token

Antes de qualquer chamada à API da Olist, o motor de sync:
1. Lê `integration_connections` (via `service_role`).
2. Se `expires_at` está a menos de 5 minutos de expirar, renova via
   `grant_type=refresh_token` antes de prosseguir.
3. Se a renovação falhar (refresh token também expirado), marca `status =
   'precisa_reautorizar'` e interrompe o sync com um erro claro registrado
   em `sync_runs`.

### Modelo de dados

Novas tabelas (todas com `org_id` + RLS, seguindo o padrão da Fase 0+1):

- `integration_connections` — `id`, `org_id`, `provider` (`'olist'`,
  preparado para `'sumup'` na Fase 3), `client_id`, `client_secret`,
  `access_token`, `refresh_token`, `expires_at`, `status`
  (`conectado`/`precisa_reautorizar`/`desconectado`), `connected_at`,
  `updated_at`. RLS: nenhuma policy para `anon`/`authenticated` — acesso
  exclusivo via `service_role`.
- `olist_orders` — pedidos (id externo, número, situação, datas, valores,
  cliente, vendedor referenciados).
- `olist_order_items` — itens de pedido, FK para `olist_orders`.
- `olist_contacts` — clientes/fornecedores.
- `olist_accounts_payable` — contas a pagar.
- `olist_accounts_receivable` — contas a receber.
- `olist_products` — produtos (necessário para exibir itens de pedido com
  nome/detalhe legível).
- `olist_sellers` — vendedores (tabela de referência pequena).
- `olist_payment_methods` — formas de pagamento (tabela de referência
  pequena).

Cada tabela sincronizada tem `unique(org_id, olist_id)` para evitar
duplicidade em re-sync. Os campos exatos de cada tabela serão extraídos do
`swagger.json` oficial durante a escrita do plano de implementação — não
inventados nesta spec.

Situações/status vindos da API (ex.: `situacao` do pedido, `situacao` de
contas a pagar/receber) são armazenados como o valor bruto da Olist mais um
campo normalizado, seguindo o padrão de normalização já definido nas seções
8 e 10 do documento mestre (paga/parcialmente paga/aberta/vencida/cancelada).

### Motor de sincronização

- Uma função por entidade (`syncOrders`, `syncContacts`,
  `syncAccountsPayable`, `syncAccountsReceivable`, `syncProducts`,
  `syncSellers`, `syncPaymentMethods`) que pagina via `limit`/`offset`,
  faz upsert dos registros e retorna se há mais páginas.
- Chamadas em loop dentro de uma única execução de servidor por enquanto —
  volume da WEE é pequeno o suficiente para não estourar timeout do
  `npm run dev` local. Documentado como ponto de atenção para quando houver
  deploy real na Vercel (pode exigir paginação assíncrona/fila se o volume
  crescer).
- Cada execução completa registra em `sync_runs` (tabela já criada na Fase
  0+1): início, fim, status, páginas processadas, registros
  recebidos/criados/atualizados, contagem de erros, mensagem de erro.
- Retry com backoff exponencial em erro de rede, 401 (token expirado — já
  tratado pela renovação proativa) e possíveis erros de rate limit.
- Modos: **inicial completa** (primeira conexão, busca tudo), **incremental**
  (usa `dataAtualizacao` para pedidos/contatos, janela deslizante para
  contas a pagar/receber), **manual** (botão "Sincronizar agora").

### UI

- Tela **Integrações → Olist**: estado da conexão (`conectado` /
  `precisa_reautorizar` / `desconectado`), botão Conectar/Reconectar, botão
  "Sincronizar agora", histórico das últimas execuções (lendo `sync_runs`).
  Substitui o placeholder criado na Fase 0+1 nesse card específico — o card
  da SumUp continua como placeholder até a Fase 3.

## Fora de escopo desta fase

- Agendamento automático real (Vercel Cron / pg_cron).
- Sincronização de notas fiscais, expedição, ordens de produção/serviço,
  orçamentos — não necessários para fluxo de caixa.
- Qualquer escrita na Olist (pedidos, contas, etc.) — a Olist é
  estritamente read-only no primeiro release, conforme seção 62 do
  documento mestre.
- Reconciliação com SumUp (Fase 4) e qualquer cálculo de fluxo de caixa
  (Fase 5+).

## Segurança

- `OLIST_CLIENT_ID`/`OLIST_CLIENT_SECRET` só em `.env.local` (nunca
  commitado) para o registro inicial; após a primeira conexão, os tokens
  de sessão (access/refresh) vivem exclusivamente em
  `integration_connections`, acessível só por `service_role`.
- Parâmetro `state` assinado (HMAC com segredo do servidor) no fluxo OAuth2
  para prevenir CSRF no callback.
- Nenhum dado de cliente (CPF/CNPJ) exibido sem mascaramento na UI, seguindo
  o padrão já estabelecido para LGPD na Fase 0+1 (a implementar quando a
  UI de detalhamento de clientes for construída — não há tela de clientes
  ainda nesta fase, só sincronização).

## Testes

- Fixtures determinísticas baseadas nos schemas reais do `swagger.json`
  (não a API de produção) para: paginação, renovação de token, token/refresh
  expirados (fluxo `precisa_reautorizar`), erro 401, resposta vazia, campos
  opcionais ausentes, alteração incremental via `dataAtualizacao`, janela
  deslizante de contas a pagar/receber, prevenção de duplicidade em re-sync.
- Nenhum teste toca a API real da Olist.
- Teste manual end-to-end (feito pelo usuário, já validado): conectar via
  OAuth2 real, disparar sync manual, conferir dados reais no Supabase
  Studio local.

## Próximos passos (fora desta spec)

- Fase 3: Integração SumUp.
- Fase 4: Reconciliação (evitar dupla contagem Olist × SumUp).
