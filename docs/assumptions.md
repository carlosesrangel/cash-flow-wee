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
