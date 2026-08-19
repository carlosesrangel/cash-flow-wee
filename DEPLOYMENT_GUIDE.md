# 📦 Guia Completo de Deployment — WEE Cash Flow

## Visão Geral
Este guia cobre o deployment completo do projeto para produção (Supabase + Vercel + GitHub).

---

## 🎯 Fase 1: Preparação (Local)

### 1.1 Verificar Status do Projeto
```bash
# Validar build
npm run build

# Rodar testes
npm run test

# Verificar lint
npm run lint
```

✅ **Seu status atual:**
- Build: SUCESSO (sem erros TypeScript)
- Testes: 364/364 PASSANDO
- Migrations: 15 migrations prontas
- Dados Olist: Integração pronta

### 1.2 Configurar Git Localmente
```bash
# Adicionar origin (substituir YOURUSERNAME)
git remote add origin https://github.com/YOURUSERNAME/cash-flow-wee.git

# Verificar branch principal
git branch -M main

# Fazer push inicial
git push -u origin main
```

---

## 🌐 Fase 2: Configurar Supabase

### 2.1 Criar Projeto Supabase
1. Ir para [supabase.com](https://supabase.com)
2. Clicar em "New Project"
3. Preencher:
   - **Name:** `wee-cash-flow`
   - **Database Password:** Guardar com segurança
   - **Region:** Escolher mais perto (ex: us-east-1)
4. Clicar "Create new project"
5. Aguardar criação (≈2 minutos)

### 2.2 Obter Credenciais Supabase
1. Ir para "Project Settings" → "API"
2. Copiar as chaves para seu `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL` (Project URL)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon/public key)
   - `SUPABASE_SERVICE_ROLE_KEY` (Service role key)

### 2.3 Executar Migrations
1. No Supabase Dashboard → "SQL Editor"
2. Para cada arquivo `supabase/migrations/000X_*.sql`:
   ```
   - Abrir arquivo
   - Copiar conteúdo SQL
   - Colar no editor
   - Executar (Run)
   ```
3. **Ordem importante:**
   - 0001_foundation.sql
   - 0002_sync_runs.sql
   - 0003_grants.sql
   - ... (seguir ordem numérica)
   - 0015_forecast_planning_seed.sql

### 2.4 Configurar Row Level Security (RLS)
1. No Supabase → "Authentication" → "Policies"
2. Para cada tabela com `org_id`:
   ```sql
   -- Enable RLS
   ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

   -- Create policy
   CREATE POLICY "org_isolation" 
   ON table_name FOR ALL
   USING (org_id = auth.uid()::uuid);
   ```

---

## 🚀 Fase 3: Configurar Vercel

### 3.1 Conectar GitHub ao Vercel
1. Ir para [vercel.com](https://vercel.com)
2. Clicar "Import Project"
3. Selecionar "GitHub"
4. Autorizar Vercel no GitHub
5. Selecionar repositório `cash-flow-wee`

### 3.2 Configurar Variáveis de Ambiente
No Vercel → "Project Settings" → "Environment Variables", adicionar:

#### **Supabase (obrigatório)**
```
NEXT_PUBLIC_SUPABASE_URL = [seu valor]
NEXT_PUBLIC_SUPABASE_ANON_KEY = [seu valor]
SUPABASE_SERVICE_ROLE_KEY = [seu valor secreto]
```

#### **Olist (obrigatório para sincronização)**
```
OLIST_CLIENT_ID = [seu client ID da Olist]
OLIST_CLIENT_SECRET = [seu secret da Olist]
OLIST_REDIRECT_URI = https://wee-cash-flow.vercel.app/api/auth/olist/callback
OLIST_STATE_SECRET = [gerar random: openssl rand -hex 32]
OLIST_RATE_LIMIT_PER_MINUTE = 25
```

#### **SumUp (obrigatório para sincronização)**
```
SUMUP_API_KEY = [seu API key da SumUp]
SUMUP_MERCHANT_CODE = [seu merchant code]
```

### 3.3 Configurar Build Settings
1. Framework Preset: **Next.js**
2. Build Command: `npm run build`
3. Output Directory: `.next`
4. Install Command: `npm ci`
5. Node.js Version: **18.x**

### 3.4 Deploy Inicial
1. Clicar "Deploy"
2. Aguardar build (≈3-5 minutos)
3. Testar em `https://wee-cash-flow.vercel.app`

---

## 🔐 Fase 4: Configurar Autenticação (Opcional mas Recomendado)

### 4.1 Supabase Auth via Email
1. Supabase Dashboard → "Authentication" → "Providers"
2. Email ativado por padrão
3. Configurar "Email Templates" se necessário

### 4.2 Integração OAuth (Olist)
1. Olist Developer Portal:
   - Registrar aplicação
   - Obter Client ID/Secret
   - Set Redirect URI: `https://wee-cash-flow.vercel.app/api/auth/olist/callback`

### 4.3 SumUp API
1. SumUp Developer:
   - Criar account
   - Gerar API Key
   - Obter Merchant Code

---

## 📊 Fase 5: Verificar Dados

### 5.1 Testar Sync Olist
1. Dashboard → Menu → Integrations
2. Clicar "Connect Olist"
3. Autorizar acesso
4. Aguardar sync inicial (dados aparecem em "Clientes", "Produtos", "Vendas")

### 5.2 Testar Sync SumUp
1. Dashboard → Menu → Integrations
2. Configurar SumUp API Key
3. Aguardar sync de transações

### 5.3 Verificar Banco de Dados
No Supabase SQL Editor:
```sql
-- Verificar dados de clientes
SELECT COUNT(*) FROM customers;

-- Verificar dados de produtos
SELECT COUNT(*) FROM products;

-- Verificar dados de orders
SELECT COUNT(*) FROM orders;
```

---

## 🎨 Fase 6: Customizações Finais (Opcional)

### 6.1 Alterar Domain (se necessário)
1. Vercel → "Domains"
2. Adicionar seu domínio próprio
3. Configurar DNS no seu registrador
4. Aguardar propagação (≈24h)

### 6.2 Configurar Analytics (Google Analytics)
1. Adicionar `NEXT_PUBLIC_GA_ID` em Vercel
2. Código já está integrado em `app/layout.tsx`

### 6.3 Configurar Email (Resend)
1. Resend.com → Criar account
2. Adicionar `RESEND_API_KEY` em Vercel
3. Usar para notificações

---

## ✅ Checklist Final de Produção

- [ ] Build sucesso sem erros
- [ ] Testes 364/364 passando
- [ ] GitHub repositório criado e sincronizado
- [ ] Supabase project criado
- [ ] Todas 15 migrations executadas
- [ ] RLS policies configuradas
- [ ] Variáveis de ambiente no Vercel
- [ ] Deploy inicial no Vercel sucesso
- [ ] Acesso à dashboard em produção
- [ ] Olist integração funcionando
- [ ] SumUp integração funcionando
- [ ] Dados sincronizando corretamente
- [ ] Email/Auth testado
- [ ] Domain customizado (se aplicável)

---

## 🚨 Troubleshooting

### "RLS policy violation"
- Verificar se usuario está autenticado
- Confirmar `org_id` correto no database

### "Olist sync não funciona"
- Verificar `OLIST_REDIRECT_URI` correto
- Confirmar `OLIST_CLIENT_ID` e `OLIST_CLIENT_SECRET`

### "SumUp sync não funciona"
- Verificar `SUMUP_API_KEY` válida
- Confirmar `SUMUP_MERCHANT_CODE`

### Build falha no Vercel
- Verificar Node.js version
- Limpar cache Vercel
- Redeployar

---

## 📞 Suporte

- **Supabase Docs:** https://supabase.com/docs
- **Vercel Docs:** https://vercel.com/docs
- **GitHub Issues:** Documentar problemas

---

**Status:** ✅ Pronto para produção
**Último Update:** 2026-08-19
**Versão:** 1.0.0
