# WEE Cash Flow — Fase 0 + Fase 1: Arquitetura & Fundação

Data: 2026-08-12
Status: Aprovado para implementação

## Contexto

O projeto "WEE Cash Flow & Business Intelligence Platform" é especificado em
`Prompt Mestre_ WEE Cash Flow & Business Intelligence Platform.md`. É um sistema
grande, com múltiplos subsistemas independentes (integrações Olist/SumUp,
reconciliação financeira, motor de fluxo de caixa, motor de forecast, planejador
de pagamentos, BI de vendas/clientes, módulo tributário). O próprio documento já
propõe fases de desenvolvimento (Fase 0 a Fase 10).

Esta spec cobre exclusivamente **Fase 0 (Architecture & Requirements)** e
**Fase 1 (Foundation)**: documentação arquitetural + scaffold funcional da
aplicação (projeto Next.js, banco, autenticação, RBAC, layout/navegação,
página de Saúde das Integrações como placeholder). Não inclui sincronização
real de dados, motor de fluxo de caixa, forecast, cenários, taxas, BI de
vendas, reconciliação, nem nenhum cálculo financeiro — essas são fases
subsequentes, cada uma com sua própria spec.

## Decisões confirmadas com o usuário

1. **Credenciais**: já existem credenciais reais da Olist (OAuth2) e da SumUp
   (API key). A integração real acontece na Fase 2/3; nesta fase apenas o
   `.env.example` e os placeholders de configuração são criados — nenhuma
   chamada de API real ainda.
2. **Supabase**: novo projeto será criado na conta `carlosesrangel@gmail.com`.
   O usuário fornecerá URL/chaves quando o projeto existir; até lá, o
   desenvolvimento local pode usar Supabase local (CLI) ou aguardar as
   credenciais.
3. **Multi-tenant**: a WEE é uma única empresa. O modelo de dados mantém
   `org_id` em todas as tabelas relevantes e RLS por organização (para não
   exigir retrofit se um dia houver mais de uma organização), mas a aplicação
   roda com uma única organização fixa "WEE", sem UI de gestão de múltiplas
   empresas.
4. **Usuários**: 2 a 5 pessoas inicialmente (owner/admin, sócia, possivelmente
   mais 1-2 pessoas da operação financeira). RBAC com os três papéis do
   documento: OWNER/ADMIN, MANAGER, VIEWER.
5. **Banco/ORM**: Supabase CLI para migrations SQL puro (sem ORM), acesso via
   `supabase-js`/Postgres com queries tipadas manualmente e validação Zod em
   toda borda (formulários, API routes). Nenhuma abstração tipo Drizzle/Prisma
   — prioriza transparência para lógica financeira que virá nas próximas
   fases.
6. **Git**: repositório git local inicializado nesta fase; conexão com um
   remoto no GitHub fica para quando o usuário quiser fazer deploy.
7. **Revisão de código**: o plugin Codex (`codex:rescue`) é usado como segunda
   opinião / revisão de código ao final da implementação desta fase, antes de
   considerar pronto.

## Arquitetura

```text
Browser (Next.js App Router, TS estrito, Tailwind, shadcn/ui)
  -> Next.js Server (API routes / server actions)
    -> Supabase (Postgres + Auth + RLS)
```

Nenhuma API externa (Olist, SumUp) é chamada nesta fase. A camada de
integração server-side será construída na Fase 2/3, mas a estrutura de pastas
já reserva o espaço para ela.

### Estrutura de pastas

```text
app/                      # rotas Next.js App Router
  (auth)/login/
  (app)/
    visao-geral/
    fluxo-de-caixa/{diario,mensal,anual}/
    contas-a-receber/
    contas-a-pagar/
    planejar-pagamentos/
    planejamento/
    cenarios/
    vendas/
    clientes/
    produtos/
    impostos/
    reconciliacao/
    integracoes/          # inclui "Saúde das Integrações"
    configuracoes/
lib/
  db/                      # queries tipadas manualmente (supabase-js)
  validation/              # schemas Zod
  auth/                    # helpers de sessão/RBAC
  format/                  # moeda BRL, datas dd/MM/yyyy, timezone America/Sao_Paulo
supabase/
  migrations/
docs/
  architecture.md
  data-model.md
  financial-rules.md
  assumptions.md
  decisions.md
  integrations/olist.md
  integrations/sumup.md
```

## Modelo de dados desta fase

Apenas as tabelas de fundação (as demais entidades do documento — pedidos,
contas a pagar/receber, transações SumUp, forecast, etc. — entram em fases
posteriores):

- `organizations` (seed único: WEE)
- `profiles` (vinculado a `auth.users`)
- `organization_members` (`org_id`, `profile_id`, `role`: `OWNER_ADMIN` |
  `MANAGER` | `VIEWER`)
- `audit_logs` (estrutura genérica, já usada para mudanças de membership)

RLS: toda tabela com `org_id` restringe leitura/escrita a membros da mesma
organização; políticas adicionais por papel quando a ação exigir (ex.:
administrar usuários é exclusivo de OWNER_ADMIN).

## Autenticação e RBAC

- Supabase Auth (e-mail + senha). Sem cadastro público — usuários são
  convidados por um OWNER_ADMIN.
- Recuperação de senha via fluxo padrão do Supabase Auth.
- Middleware Next.js protege todas as rotas de `(app)`, redirecionando para
  `/login` quando não autenticado.
- Helper central de RBAC em `lib/auth` que resolve o papel do usuário na
  organização e expõe checagens reutilizáveis (`canManageUsers`,
  `canEditForecast`, etc.) — mesmo que a maioria ainda não tenha efeito
  prático nesta fase, a interface já fica definida para as próximas.

## Layout e navegação

Navegação lateral completa conforme o documento (Visão Geral, Fluxo de Caixa
com submenu Diário/Mensal/Anual, Contas a Receber, Contas a Pagar, Planejar
Pagamentos, Planejamento, Cenários, Vendas, Clientes, Produtos, Impostos,
Reconciliação, Integrações, Configurações). Cada rota existe e renderiza um
empty state claro ("em construção — chega na Fase X") em vez de 404 ou tela
quebrada. A página de Integrações inclui o placeholder de "Saúde das
Integrações" (tabela vazia de `sync_runs`, populada de verdade na Fase 2/3).

Padrões globais: idioma pt-BR, moeda BRL (`R$ 1.234,56`), datas
`dd/MM/yyyy`, timezone `America/Sao_Paulo`.

## Fora de escopo (explicitamente adiado)

- Qualquer chamada real a Olist ou SumUp.
- Motor de fluxo de caixa, forecast, cenários, reconciliação, impostos.
- Qualquer tabela de dados financeiros além das listadas acima.
- Exportação, alertas, modo demonstração com dados fictícios de vendas.

## Testes e definição de pronto

- Unitários (Vitest): helpers de formatação (moeda/data/timezone), validação
  Zod dos schemas de auth/organização.
- E2E (Playwright): login, logout, redirecionamento quando não autenticado,
  navegação entre todas as páginas vazias sem erro.
- RLS: teste comprovando que um usuário sem vínculo com a organização não
  enxerga nenhuma linha das tabelas de fundação.
- Critério de pronto: login funcional; RBAC bloqueia/permite corretamente por
  papel nas checagens já existentes; todas as rotas da navegação carregam sem
  erro; `.env.example` completo e documentado; `docs/architecture.md`,
  `docs/data-model.md`, `docs/financial-rules.md`, `docs/assumptions.md`,
  `docs/decisions.md` (com os ADRs do prompt mestre) e os esqueletos de
  `docs/integrations/{olist,sumup}.md` existem e estão preenchidos com o que
  já se sabe nesta fase.

## Próximos passos (fora desta spec)

- Fase 2: Integração Olist (usando as credenciais reais já disponíveis).
- Fase 3: Integração SumUp.
- Fase 4 em diante: reconciliação, motor de fluxo de caixa, forecast,
  cenários, BI de vendas/clientes, impostos, testes/segurança/deploy —
  cada uma como spec própria, seguindo este mesmo processo.
