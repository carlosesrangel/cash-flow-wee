# Arquitetura

## Visão geral

    Browser (Next.js App Router)
      -> Next.js Server (API routes / server actions)
        -> Supabase (Postgres + Auth + RLS)

Nenhuma API externa (Olist, SumUp) é chamada diretamente pelo navegador.
Nesta fase (Fase 0+1) nenhuma API externa é chamada — a estrutura de pastas
reserva o espaço (`lib/integrations/`, a ser criado na Fase 2/3), mas a
implementação real começa na Fase 2 (Olist) e Fase 3 (SumUp).

## Stack

Next.js 14 (App Router), TypeScript estrito, Tailwind CSS, shadcn/ui,
Supabase (Postgres + Auth + RLS), Zod, Vitest, Playwright, Supabase CLI para
migrations SQL puro (sem ORM).

## Organização e RBAC

Organização única "WEE", com `org_id` em todas as tabelas relevantes e RLS
aplicado desde a primeira migration. Papéis: OWNER_ADMIN, MANAGER, VIEWER
(ver `docs/decisions.md` ADR-004 e `lib/auth/rbac.ts`).

## Autenticação

Supabase Auth (e-mail + senha), sem cadastro público. Sessão gerenciada via
cookies através de `@supabase/ssr`, renovada a cada request pelo middleware
(`middleware.ts` + `lib/supabase/middleware.ts`).
