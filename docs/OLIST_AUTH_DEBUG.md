# OLIST Autenticação - Debug & Solução

**Data:** 2026-08-19  
**Status:** ✅ Identificado e corrigido

## Problema Identificado

Erro de autenticação ao tentar sincronizar dados do OLIST era causado por:

### 🔴 Causa Raiz
O redirect URI cadastrado localmente no `.env.local` tinha um **domínio incorreto**:
- ❌ **Antes:** `https://wee-cash-flow.vercel.app/api/integracoes/olist/callback`
- ✅ **Depois:** `https://cash-flow-wee.vercel.app/api/integracoes/olist/callback`

O domínio correto do Vercel é `cash-flow-wee` (não `wee-cash-flow`).

## Soluções Aplicadas

### 1. ✅ Atualizar `.env.local`
```
OLIST_REDIRECT_URI=https://cash-flow-wee.vercel.app/api/integracoes/olist/callback
```
**Status:** FEITO

### 2. ✅ Atualizar Vercel Environment Variables
Via CLI:
```bash
vercel env rm OLIST_REDIRECT_URI
echo 'https://cash-flow-wee.vercel.app/api/integracoes/olist/callback' | vercel env add OLIST_REDIRECT_URI production
```
**Status:** FEITO

### 3. 🚨 **AÇÃO MANUAL NECESSÁRIA** - Atualizar no Painel Olist/Tiny

Você PRECISA atualizar o redirect URI no aplicativo registrado no Olist/Tiny:

**Passo a passo:**
1. Acesse https://www.tiny.com.br
2. Faça login com suas credenciais
3. Vá para **Configurações** → **Geral** (ou similar)
4. Localize **Aplicativos** ou **Apps**
5. Encontre o aplicativo criado para este projeto (nome: "WEE Cash Flow" ou similar)
6. Edite as configurações
7. Procure por **Redirect URI** ou **Authorization Redirect URL**
8. Atualize para: `https://cash-flow-wee.vercel.app/api/integracoes/olist/callback`
9. Salve as alterações

⚠️ **Importante:** Alterar o Redirect URI pode exigir que você **gere um novo Client Secret**. Se isso acontecer:
- Copie o novo `OLIST_CLIENT_SECRET`
- Atualize em `.env.local` e no Vercel:
  ```bash
  echo 'seu-novo-secret-aqui' | vercel env add OLIST_CLIENT_SECRET production
  ```

## Verificação

Após fazer as alterações no Olist/Tiny:

1. **Localmente:** Teste com `npm run dev`
   ```bash
   # Acesse http://localhost:3000/integracoes
   # Clique em "Conectar OLIST"
   # Você será redirecionado para o Olist
   # Após autorizar, deverá retornar à página de integração
   ```

2. **Em Produção:** O fluxo deve funcionar em:
   - https://cash-flow-wee.vercel.app/integracoes

## Variáveis de Ambiente - Status Atual

✅ Todas as variáveis estão configuradas em `.env.local` e no Vercel:

| Variável | Local | Vercel | Valor |
|----------|-------|--------|-------|
| OLIST_CLIENT_ID | ✓ | ✓ | tiny-api-1c765c8c... |
| OLIST_CLIENT_SECRET | ✓ | ✓ | FLuUFLg0BF3P57oi... |
| OLIST_REDIRECT_URI | ✓ | ✓ | https://cash-flow-wee.vercel.app/... |
| OLIST_STATE_SECRET | ✓ | ✓ | 3S5a85VRrjNDa... |

## Fluxo de Autenticação OAuth2

```
1. Usuário clica em "Conectar OLIST"
   ↓
2. Rota GET /api/integracoes/olist/connect é acionada
   ↓
3. buildAuthorizeUrl() constrói URL para Olist/Tiny
   ↓
4. Usuário é redirecionado para https://accounts.tiny.com.br (autorização)
   ↓
5. Usuário autoriza a aplicação
   ↓
6. Olist/Tiny redireciona para OLIST_REDIRECT_URI com `code` e `state`
   ↓
7. Rota GET /api/integracoes/olist/callback recebe o código
   ↓
8. exchangeCodeForTokens() faz POST para Olist/Tiny com o código
   ↓
9. Tokens (access + refresh) são salvos em `integration_connections`
   ↓
10. Usuário vê "Conectado com sucesso!"
```

## Possíveis Erros Posteriores

Se ainda houver erro depois de atualizar tudo:

### Erro: "Olist connection unavailable for org... reauthorization required"
- Significa que o refresh token expirou (válido por 1 dia)
- Solução: Clique em "Conectar OLIST" novamente para reautoriz

ar

### Erro: "Olist API request failed (401)"
- Pode indicar que o access token ficou inválido
- Solução: O sistema tenta renovar com o refresh token automaticamente
- Se não funcionar: Reconecte via "Conectar OLIST"

### Erro: "invalid_client" ao conectar
- Significa que o CLIENT_ID ou CLIENT_SECRET estão incorretos
- Ou o Redirect URI não foi atualizado no Olist
- Solução: Verifique as credenciais no Olist/Tiny

## Referências

- Olist API Docs: https://docs.tiny.com.br (em produção, este arquivo pode ser em outro local)
- OAuth2 Implementation: `/lib/olist/oauth.ts`
- Callback Route: `/app/api/integracoes/olist/callback/route.ts`
- Sync Route: `/app/api/integracoes/olist/sync/route.ts`
- Documentação: `/docs/integrations/olist.md`
