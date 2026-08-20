# 🔧 Resolução: "Invalid parameter: redirect_uri" na Integração OLIST

## ❌ O Problema

Ao clicar em **Integrações > OLIST ERP > Conectar**, você vê:
```
Invalid parameter: redirect_uri
```

Isso significa que a URL de redirecionamento que seu app está enviando **não corresponde** ao que foi cadastrado no painel da OLIST.

---

## ✅ Solução em 3 Passos

### Passo 1: Identifique qual URL seu app está usando

A URL vem da variável de ambiente `OLIST_REDIRECT_URI`. Verifique:

**Ambiente Local (`npm run dev`):**
```bash
cat .env.local | grep OLIST_REDIRECT_URI
```

**Ambiente Produção (Vercel):**
- Acesse: https://vercel.com/seu-usuario/cash-flow-wee/settings/environment-variables
- Procure por `OLIST_REDIRECT_URI`
- Anote o valor **exato**

Exemplo esperado:
```
https://cash-flow-wee.vercel.app/api/integracoes/olist/callback
```

### Passo 2: Verifique a configuração no painel OLIST

1. Abra https://accounts.tiny.com.br (login com sua conta)
2. Vá para **Configurações** → **Aplicativos**
3. Clique no seu aplicativo (deve estar nomeado algo como "Cash Flow WEE")
4. Procure por **Redirect URIs** ou **Authorized Redirect URIs**
5. **Anote o valor cadastrado** (copie exatamente como aparece)

Exemplo (pode ser diferente):
```
https://cash-flow-wee.vercel.app/api/integracoes/olist/callback
```

### Passo 3: Compare e corrija

**Se forem diferentes:**

#### Opção A: Atualizar a URL na OLIST (recomendado se seu app já está em produção)
1. No painel OLIST, edite o **Redirect URI**
2. Substitua pelo valor que seu app está usando:
   ```
   https://cash-flow-wee.vercel.app/api/integracoes/olist/callback
   ```
3. Salve a alteração
4. Teste: clique em **Conectar** novamente

#### Opção B: Atualizar a variável de ambiente (se mudou o domínio/URL)
1. Se sua URL em produção mudou, atualize no Vercel:
   ```bash
   vercel env pull
   ```
2. Edite `.env.local`:
   ```
   OLIST_REDIRECT_URI=https://seu-novo-dominio.vercel.app/api/integracoes/olist/callback
   ```
3. Commit e push:
   ```bash
   git add .env.local
   git commit -m "fix: update OLIST_REDIRECT_URI"
   git push
   ```
4. Vercel fará deploy automático
5. Atualize também no painel OLIST com a mesma URL

---

## 🔍 Checklist de Verificação

Estes detalhes **devem ser 100% idênticos** entre seu app e o painel OLIST:

- [ ] **Protocolo:** `https://` (não `http://`)
- [ ] **Domínio:** `cash-flow-wee.vercel.app` (ou seu domínio customizado)
- [ ] **Caminho:** `/api/integracoes/olist/callback`
- [ ] **Trailing slash:** Não deve ter `/` no final
- [ ] **Query params:** Não deve ter `?` ou parâmetros

**Exemplos de erros comuns:**
```
❌ http://cash-flow-wee.vercel.app/api/integracoes/olist/callback    (http em vez de https)
❌ https://cash-flow-wee.vercel.app/api/integracoes/olist/callback/  (trailing slash)
❌ https://cash-flow-wee.vercel.app/integracoes/olist/callback       (falta /api)
❌ https://localhost:3000/api/integracoes/olist/callback             (localhost em produção)
✅ https://cash-flow-wee.vercel.app/api/integracoes/olist/callback   (correto)
```

---

## 🧪 Teste em Ambiente Local

Se está testando localmente (`npm run dev`):

1. A URL local será:
   ```
   http://localhost:3000/api/integracoes/olist/callback
   ```

2. **Você NÃO pode usar localhost no painel OLIST!**
   - O painel OLIST precisa acessar sua URL para fazer o callback
   - Localhost não é acessível pela internet

3. **Opções para testar:**
   - Use um **tunnel** como `ngrok`:
     ```bash
     npm install -g ngrok
     ngrok http 3000
     # Copie a URL gerada (ex: https://xxxx-1.ngrok.io)
     # Use como: https://xxxx-1.ngrok.io/api/integracoes/olist/callback
     ```
   - Ou teste em **produção** (Vercel) clicando em **Conectar**

---

## 📋 Resumo Rápido

| Cenário | Ação |
|---------|------|
| Acaba de fazer deploy no Vercel | Verifique `OLIST_REDIRECT_URI` nas env vars do Vercel |
| Mudou o domínio/URL do app | Atualize no painel OLIST e na variável de ambiente |
| Está testando localmente | Use `ngrok` ou teste em produção |
| Não tem certeza qual URL usar | Use `https://cash-flow-wee.vercel.app/api/integracoes/olist/callback` |

---

## 🆘 Ainda não funciona?

Se depois de seguir tudo acima ainda der erro:

1. **Limpe cache do navegador:**
   ```
   CTRL+SHIFT+Delete → "Todos os tempos" → "Limpar dados"
   ```

2. **Verificar logs no Vercel:**
   ```bash
   vercel logs --follow
   ```

3. **Testar a rota callback diretamente:**
   ```bash
   curl -I "https://cash-flow-wee.vercel.app/api/integracoes/olist/callback"
   # Deve retornar 400 (sem código) ou 302 (redireciona), não 404
   ```

4. **Contato OLIST support:** Se tudo está correto, pode ser um problema no lado deles
   - Email: support@olist.com ou suporte via plataforma Tiny

---

## 📚 Referências

- Arquivo de ambiente: `.env.local` (vide linha 13: `OLIST_REDIRECT_URI`)
- Código do OAuth: `lib/olist/oauth.ts` (linha 22 usa `getEnv('OLIST_REDIRECT_URI')`)
- Rota do callback: `app/api/integracoes/olist/callback/route.ts`
- Documentação OLIST: https://accounts.tiny.com.br
