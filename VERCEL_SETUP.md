# 🚀 Configurar Vercel para Deploy

## Passo 1: Conectar GitHub ao Vercel

1. Acesse https://vercel.com
2. Faça login ou crie uma conta
3. Clique em **"Add New..."** → **"Project"**
4. Clique em **"Import Git Repository"**
5. Conecte sua conta GitHub se necessário
6. Procure por **"cash-flow-wee"**
7. Selecione e clique **"Import"**

## Passo 2: Configurar Build Settings (Auto-detectado, mas verificar)

Vercel deve detectar automaticamente Next.js. Confirme:
- **Framework Preset:** Next.js
- **Build Command:** `npm run build`
- **Output Directory:** `.next`
- **Node.js Version:** 18.x

✅ Clique em **"Deploy"**

## Passo 3: Adicionar Variáveis de Ambiente

Enquanto Vercel faz o primeiro build, adicione as variáveis:

1. **Projeto no Vercel** → **"Settings"** → **"Environment Variables"**
2. Adicione cada variável do `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://rutrebcjcxhbindplqwe.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[seu-valor]
SUPABASE_SERVICE_ROLE_KEY=[seu-valor]
SUMUP_API_KEY=[seu-valor]
SUMUP_MERCHANT_CODE=[seu-valor]
OLIST_CLIENT_ID=[seu-valor]
OLIST_CLIENT_SECRET=[seu-valor]
OLIST_STATE_SECRET=[seu-valor]
OLIST_REDIRECT_URI=https://wee-cash-flow.vercel.app/api/auth/olist/callback
```

3. Clique em **"Save"**

## Passo 4: Aguardar Deploy

O primeiro deploy pode levar **3-5 minutos**. Você verá:
- ✅ Build completo
- ✅ Deployment completo
- Acesso em: **https://wee-cash-flow.vercel.app**

## Passo 5: Testar Aplicação

1. Acesse https://wee-cash-flow.vercel.app
2. Veja a página inicial carregando
3. Tente criar uma organização ou fazer login

---

## ⚠️ Se der erro no Build

**Erro comum: "Build failed - TypeScript errors"**
- Isso não deve acontecer (testamos localmente)
- Se ocorrer, você pode:
  1. Ver logs no Vercel Dashboard
  2. Me avisar com o erro específico

**Erro de variáveis de ambiente**
- Se ver erro sobre "NEXT_PUBLIC_SUPABASE_URL não definida"
- Volte para Settings → Environment Variables e confirme que estão salvas
- Clique em "Redeploy" para refazer o build

---

## ✅ Deploy Completo!

Quando terminar, você terá:
- ✨ App rodando em produção
- 🔐 Supabase integrado
- 🔗 GitHub conectado para deploys automáticos
- 📊 Dashboard funcional

**Próximas fases (opcionais):**
- [ ] Configurar domínio customizado
- [ ] Adicionar analytics (Google Analytics)
- [ ] Testar Olist integration
- [ ] Testar SumUp integration

---

**Me avisa quando der sucesso no deploy!** 🎉
