# Suposições e Decisões Pendentes de Validação

- Organização única "WEE" — não há requisito de multi-tenant real no MVP
  (confirmado com o usuário em 2026-08-12).
- 2 a 5 usuários iniciais, papéis OWNER_ADMIN/MANAGER/VIEWER (confirmado com
  o usuário em 2026-08-12).
- Nenhuma suposição financeira foi feita nesta fase — não há dado financeiro
  no sistema ainda.
- Toda suposição fiscal ou de regra de negócio introduzida em fases
  posteriores deve ser registrada aqui com status `NECESSITA VALIDAÇÃO
  CONTÁBIL` quando aplicável, conforme a seção 33 do Prompt Mestre.

- O `supabase/config.toml` local (signup desabilitado, senha mínima 8,
  confirmação de e-mail exigida) é apenas o template de desenvolvimento; o
  projeto Supabase hospedado (produção) precisa ter essas mesmas opções
  configuradas manualmente no dashboard de Auth (signup público desabilitado,
  invite-only) — o `config.toml` não é aplicado automaticamente a um projeto
  hospedado.

## Riscos conhecidos (Fase 0+1)

- **Usuário de teste E2E não é semeado de forma reprodutível**: o arquivo
  `tests/e2e/auth.spec.ts` depende de um usuário `test@wee.com.br` criado
  manualmente via Supabase Admin API (conforme relatório da Task 12), que não
  faz parte de `supabase/seed.sql`. Um `supabase db reset` em uma máquina nova
  ou um ambiente de CI não tem forma automática de recriar esse usuário.
  Adiado: construir um mecanismo determinístico de seed de fixtures de teste é
  uma mudança maior, apropriada para quando o CI for configurado (Fase 10,
  conforme o plano mestre), não para este pacote de hardening da fundação.
- **Sem contexto de organização ativa para usuários multi-org**: a função
  `getCurrentMember()` em `lib/auth/session.ts` seleciona uma linha de
  membership arbitrária via `.limit(1)`, sem ordenação ou seleção explícita de
  "org ativa". Isso é seguro hoje porque o app é single-organization (ADR-004:
  apenas a organização "WEE" é semeada, e não existe UI para criar outras
  organizações ou adicionar um usuário a mais de uma), portanto nenhum usuário
  pode atualmente ter múltiplas memberships. Adiado: se o suporte
  multi-organização for adicionado no futuro, um seletor explícito de
  organização ativa precisa ser construído antes que o comportamento dessa
  função seja correto para usuários com múltiplas memberships.


## Riscos conhecidos (Fase 2 — Integração Olist)

- **`state` do OAuth2 não tem nonce/expiração/vínculo à sessão**: `lib/olist/state.ts`
  assina `{ orgId }` via HMAC, provando apenas que o valor foi gerado pelo
  nosso fluxo — não que foi *esta* pessoa, *agora*, que iniciou a conexão.
  Uma URL de autorização válida exposta via histórico do navegador, logs ou
  ferramentas de suporte poderia, em teoria, ser reaproveitada por outro
  usuário autenticado no mesmo app para conectar sua própria conta Olist à
  organização alvo. Risco atenuado hoje porque: só `OWNER_ADMIN` pode iniciar
  a conexão (RBAC via `canManageIntegrations`), e a WEE é uma ferramenta
  interna de poucos usuários, não um SaaS público. Adiado: antes de expor
  este fluxo a mais usuários ou a um ambiente com maior superfície de ataque,
  adicionar um nonce aleatório de uso único com expiração curta, vinculado à
  sessão de quem iniciou o fluxo, validado atomicamente no callback.
- **Trava de refresh concorrente (`lib/olist/client.ts`) só protege dentro de
  um processo Node**: o cache em memória que evita chamadas de refresh
  duplicadas para o mesmo `orgId` não coordena entre múltiplas instâncias
  serverless rodando em paralelo (ex.: Vercel com várias funções ativas ao
  mesmo tempo). Hoje isso não é um problema real porque a aplicação roda
  localmente, sem deploy serverless. Adiado: antes do deploy real em um
  ambiente com múltiplas instâncias, trocar por uma coordenação a nível de
  banco (ex.: update condicional comparando o `refresh_token` já lido, ou um
  lease/lock por org+provider) para evitar que duas instâncias renovem o
  mesmo token simultaneamente e uma delas marque a conexão como
  `precisa_reautorizar` por engano ao receber `invalid_grant` para um token
  já rotacionado por outra instância.
- **Modo `incremental` usa uma janela fixa de 24h, não "desde a última
  sincronização bem-sucedida"**: `lib/olist/sync/index.ts` deriva
  `since = agora - 24h` para todo sync incremental. Se ninguém sincronizar
  por mais de 24h (o que é esperado nesta fase, já que não há agendamento
  automático), contatos/pedidos atualizados nesse intervalo maior podem ser
  silenciosamente ignorados até a próxima atualização deles. O caso de
  primeira sincronização (conta recém-conectada) já foi corrigido — o sync
  agora detecta a ausência de um `sync_runs` bem-sucedido anterior e roda em
  modo `initial` completo. Adiado: quando o agendamento automático for
  implementado (fora do escopo desta fase), derivar `since` a partir do
  timestamp da última sincronização bem-sucedida (mais uma margem de
  sobreposição), não de uma janela fixa.
- **Contas a pagar/receber que "envelhecem" para fora da janela de 90 dias não
  recebem mais refresh de status/saldo**: `syncAccountsPayable`/
  `syncAccountsReceivable` usam uma janela deslizante de `dataVencimento`
  (90 dias por padrão, ampliada para ~10 anos apenas no primeiro sync via
  `mode === 'initial'` — ver `lib/olist/sync/index.ts`). Uma conta em aberto
  cujo vencimento fica mais antigo que 90 dias nunca mais é reprocessada por
  syncs incrementais subsequentes, então se ela for paga ou seu `saldo`
  mudar na Olist depois desse ponto, a WEE nunca vê a atualização. Risco
  atenuado hoje pelo fluxo real esperado (contas costumam ser regularizadas
  antes dos 90 dias). Adiado: implementar uma passada adicional, sempre
  completa, sobre contas com `situacao` em aberto independentemente da idade
  do vencimento — mudança arquitetural maior, fora do escopo deste pacote de
  correções.
- **Janela de detecção de sincronização ativa (10 min) pode ser menor que uma
  sincronização `initial` real**: `app/api/integracoes/olist/sync/route.ts`
  bloqueia uma segunda sincronização se já existe uma rodando há menos de 10
  minutos (proteção contra duplicação de `olist_order_items` por corridas
  concorrentes). Como a sincronização `initial` agora busca ~10 anos de
  histórico de contas a pagar/receber, mais uma chamada por pedido (com
  possível backoff por rate limit), uma primeira sincronização real pode
  demorar mais que 10 minutos — nesse caso, uma segunda requisição não seria
  mais bloqueada, reabrindo a janela de corrida que a proteção existe para
  fechar. Adiado: aumentar o corte de obsolescência (ou derivá-lo de um
  heartbeat em vez de um valor fixo) quando o volume real de dados justificar
  o ajuste — não implementado agora para não adicionar complexidade sem medir
  o tempo real de uma sincronização inicial completa primeiro.


## Riscos conhecidos (Fase 3 — Integração SumUp)

- **Sincronização de payouts falha em vez de truncar silenciosamente, e não há
  caminho de recuperação automática**: `lib/sumup/sync/payouts.ts` pede o
  máximo documentado de `limit=9999` ao endpoint `/v1.0/merchants/{code}/payouts`,
  que devolve um array JSON puro, sem nenhum metadado de paginação (sem `Link`,
  sem contagem total). Se a resposta vier com exatamente 9999 itens, é
  impossível distinguir "esse é o total real" de "houve truncamento
  silencioso", então o sync lança um erro e a execução inteira é marcada como
  `failed`. Tradeoff intencional (falhar alto em vez de registrar dado
  incompleto como sucesso), mas significa que um comerciante com ≥9999 payouts
  na janela sincronizada fica sem sincronização de payouts até que alguém
  reduza a janela manualmente. Adiado: implementar paginação real por fatias
  de data (partir a janela ao meio recursivamente quando o limite for atingido)
  quando o volume da WEE se aproximar dessa ordem de grandeza — hoje está
  ordens de magnitude abaixo.
- **A janela incremental de 24h só é aplicada em gatilho manual**: assim como
  na Olist, `lib/sumup/sync/index.ts` deriva `since = agora - 24h` para todo
  sync incremental, e esse valor vira `changes_since` na API de transações
  (payouts não tem filtro por data de atualização: usa uma janela deslizante
  de 90 dias por `payout_date`). Não existe agendamento automático nesta fase
  — a sincronização só roda quando um `OWNER_ADMIN` clica em "Sincronizar
  agora". Se o intervalo entre dois cliques for maior que 24h, transações
  alteradas nesse intervalo maior podem ser ignoradas: `changes_since` é um
  filtro literal por data de alteração, não uma marca d'água mantida pelo
  servidor, então nada compensa o buraco. Mitigação parcial já existente: se
  não houver nenhum `sync_runs` bem-sucedido anterior, a rota roda em modo
  `initial` (histórico completo) — inclusive depois de uma execução `failed`.
  Adiado: quando houver agendamento automático, derivar `since` do timestamp
  da última sincronização bem-sucedida (mais margem de sobreposição).
- **Isolamento entre as pernas do sync e preservação de filtros na paginação
  foram corrigidos em revisão, não em produção**: o orquestrador
  (`lib/sumup/sync/index.ts`) originalmente abortava payouts quando transações
  falhava e registrava `records_received = 0` mesmo tendo persistido milhares
  de linhas; e a paginação (`lib/sumup/paginate.ts`) descartava o `baseQuery`
  (incluindo `changes_since`) a partir da página 2, porque o `href` do link
  `next` da SumUp é composto pelo servidor e não reflete os filtros do
  chamador. Ambos foram corrigidos, mas foram encontrados por revisão de
  código e não por um incidente real — não há evidência de produção
  confirmando o comportamento corrigido ponta a ponta. Ao depurar
  inconsistências de sincronização da SumUp, leia o histórico git de
  `lib/sumup/sync/index.ts` e `lib/sumup/paginate.ts` antes de supor que o
  problema é novo.

## Riscos conhecidos (Fase 4 — Reconciliação)

- **O número da parcela é inferido por regex sobre `numeroDocumento`, não
  por um campo estruturado**: `lib/reconciliation/match.ts`,
  `parseInstallmentNumber`, extrai o sufixo `/NN` de valores como
  `"000516/03"`. Se a Olist mudar esse formato, ou se alguma conta a
  receber legítima tiver um `numeroDocumento` sem esse sufixo por outro
  motivo (não observado nos dados reais inspecionados), a parcela cai em
  `nao_reconciliado` em vez de errar silenciosamente — mas nunca é
  reconciliada até alguém investigar.
- **O motor reprocessa toda conta a receber em cartão ainda não resolvida a
  cada sync bem-sucedido**, não só as alteradas desde a última execução —
  não há uma marca d'água de "já tentei essa parcela e não achei
  candidato". Em volumes pequenos (centenas de parcelas) isso é barato; se
  o volume crescer significativamente, vale revisitar.
- **Nenhuma evidência de produção end-to-end ainda**: assim como as Fases
  2/3 na sua entrega inicial, o motor foi validado com fixtures
  determinísticas, não contra um sync completo real com dados que
  efetivamente casam. **Parcialmente atenuado por:** a suite de integração
  (`tests/integration/reconciliation.test.ts`, executada via `npm run
  test:integration`) exercita o motor contra um banco Postgres real —
  inserindo linhas de fixture diretamente (não via sync de Olist/SumUp),
  validando o match automático, a idempotência de duas execuções seguidas de
  `runReconciliation` e a rota de confirmação manual. **Ainda não coberto por
  ela:** desfazer, a passada de deduplicação, e qualquer sync real ponta a
  ponta — esses continuam validados apenas por testes unitários com fixtures.
  Ao depurar um caso real de `conflito` ou `nao_reconciliado`
  inesperado, comece pelos dados reais em
  `olist_accounts_receivable`/`sumup_transaction_events` no Supabase
  Studio antes de assumir um bug no algoritmo.

## Riscos conhecidos (Fase 5 — Motor de Fluxo de Caixa)

- **Data de caixa de contas a pagar é sempre uma aproximação
  (`data_vencimento`), inclusive para linhas já `realizado`**:
  `classifyAccountsPayable` (`lib/cash-flow/classify.ts`) usa
  `data_vencimento` mesmo quando `saldo == 0` (pagamento já efetuado),
  porque a listagem `/contas-pagar` da Olist não expõe uma data efetiva de
  pagamento — só vencimento e saldo. Isso significa que uma conta paga
  antes ou depois do vencimento aparece no dia do vencimento no fluxo de
  caixa diário, não no dia real do desembolso. Diferente de contas a
  receber (que têm `data_liquidacao` e, quando reconciliadas com a SumUp,
  a data ainda mais precisa do evento de payout), não existe hoje nenhum
  campo mais preciso disponível na API da Olist para contas a pagar.
  Adiado: se a Olist expuser essa data no futuro (ou se outra fonte de
  settlement para pagamentos for integrada), usá-la em vez de
  `data_vencimento` para o bucket `realizado`.
- **`situacao = 'cancelado'` nunca foi observado nos dados reais da WEE, e a
  string exata não está confirmada**: `KNOWN_SITUACOES` em
  `lib/cash-flow/classify.ts` inclui `'cancelado'` por precaução (Prompt
  Mestre seção 8), mas os únicos valores vistos em produção até agora são
  `aberto` e `pago`. Se a Olist usar uma grafia diferente (ex.: `cancelada`,
  `estornado`), essa conta não cai silenciosamente em `aberto` — ela é
  excluída como `situacao_desconhecida`, com o motivo visível na UI, até
  alguém confirmar e ajustar `KNOWN_SITUACOES`.
- **Pagamento parcial (`0 < saldo < valor`) ainda não tem fixture real,
  só cobertura sintética em teste unitário**: o motor classifica qualquer
  `saldo > 0` como `contratado`, o que cobre pagamento parcial
  corretamente em teoria (testado em `tests/unit/cash-flow/classify.test.ts`
  com valores sintéticos), mas nenhuma conta com pagamento parcial real foi
  observada nos ~625 registros de contas a receber ou ~419 de contas a
  pagar sincronizados da WEE até esta fase. Ao depurar um caso real de
  pagamento parcial, confirmar que o comportamento observado bate com o
  esperado antes de assumir que o código está correto só porque os testes
  unitários passam.
