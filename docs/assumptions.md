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
