# Guia de Setup — Sincronização Olist Automática

## Pré-requisitos

- ✅ Projeto no GitHub (git push)
- ✅ Conta Supabase criada
- ✅ Credenciais Olist em `.env.local` (OLIST_CLIENT_ID, OLIST_CLIENT_SECRET)
- ✅ Deploy no Vercel (ou outro host)

---

## Step 1: Preparar Credenciais Locais

### 1.1 Verificar `.env.local`

```bash
# Verificar que estas variáveis existem
cat .env.local | grep OLIST_
cat .env.local | grep SUPABASE_
```

Devem incluir:
```
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

OLIST_CLIENT_ID=...
OLIST_CLIENT_SECRET=...
OLIST_REDIRECT_URI=https://seu-app.vercel.app/integracoes/olist/callback
OLIST_STATE_SECRET=...
```

### 1.2 Gerar SYNC_API_TOKEN (para GitHub Action)

Token secreto para GitHub Action disparar sync sem autenticação de usuário:

```bash
# Generate random token (40 caracteres)
openssl rand -hex 20

# Exemplo output: a7f3b2c9d1e4f6g8h0i2j4k6l8m0n2o4p6q8r0s2
```

Salve este token, vamos precisar no Step 3.

---

## Step 2: Testar Sincronização Manual (Local)

### 2.1 Conectar Olist pela primeira vez

1. Abra a aplicação localmente: `npm run dev`
2. Vá para **Integrações**
3. Clique **Conectar Olist**
4. Autorize via OAuth2
5. Sistema automaticamente faz sync inicial (histórico completo)
6. Verifique **Integrações → Status** para ver progresso

### 2.2 Verificar dados importados

```sql
-- Conectar ao Supabase SQL Editor

-- Ver último sync
SELECT id, org_id, status, started_at, completed_at, records_received
FROM sync_runs
WHERE integration = 'olist'
ORDER BY started_at DESC
LIMIT 5;

-- Ver contatos importados
SELECT COUNT(*) as total FROM olist_contacts WHERE org_id = 'seu-org-id';

-- Ver pedidos importados
SELECT COUNT(*) as total FROM olist_orders WHERE org_id = 'seu-org-id';
```

### 2.3 Testar sync manual via API (curl)

```bash
# Disparar sync manual como se fosse a API pública
curl -X POST http://localhost:3000/api/integracoes/olist/sync \
  -H "Cookie: auth-token=..." \
  -H "Content-Type: application/json"

# Ou via sync-all (com token)
SYNC_API_TOKEN="a7f3b2c9d1e4f6g8h0i2j4k6l8m0n2o4p6q8r0s2" \
curl -X POST http://localhost:3000/api/integracoes/olist/sync-all \
  -H "Authorization: Bearer $SYNC_API_TOKEN" \
  -H "Content-Type: application/json"
```

---

## Step 3: Configurar GitHub Secrets

### 3.1 Acessar Settings do Repositório

1. GitHub → seu repositório
2. **Settings** (aba do repo, não a sua conta)
3. **Secrets and variables** → **Actions**

### 3.2 Adicionar Secrets

Clique **New repository secret** para cada um. O workflow roda a sincronização
como processo Node comum dentro do runner (`npm run sync:olist`), não mais via
chamada HTTP à Vercel — por isso precisa das credenciais Olist diretamente:

| Nome | Valor | Origem |
|------|-------|--------|
| `SUPABASE_URL` | `https://xxx.supabase.co` | Supabase Dashboard → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` (longa chave) | Supabase Dashboard → Project Settings → API → Service Role Secret |
| `OLIST_CLIENT_ID` | (o mesmo de `.env.local`) | Painel Olist/Tiny → Configurações → Aplicativos |
| `OLIST_CLIENT_SECRET` | (o mesmo de `.env.local`) | Painel Olist/Tiny → Configurações → Aplicativos |
| `OLIST_STATE_SECRET` | (o mesmo de `.env.local`) | Gerado localmente (`openssl rand -hex 32`) |
| `SLACK_WEBHOOK_URL` | (se quiser alertas) | Criar em Slack → Apps → Incoming Webhooks |

`SYNC_API_TOKEN`, `VERCEL_URL` e `OLIST_REDIRECT_URI` não são mais usados pelo
workflow diário (a rota HTTP da Vercel só é usada pelo botão manual do
dashboard) — pode deixá-los configurados sem problema, ou removê-los.

### 3.3 Teste: Verificar que os secrets foram criados

```bash
# Localmente
cd seu-projeto
gh secret list  # Listar secrets (GitHub CLI)
```

---

## Step 4: Ativar GitHub Action

### 4.1 Fazer Push do workflow

```bash
# Verificar que o arquivo existe
ls -la .github/workflows/olist-daily-sync.yml

# Commit e push
git add .github/workflows/olist-daily-sync.yml
git commit -m "feat: add daily Olist sync via GitHub Action"
git push origin main
```

### 4.2 Verificar que action foi criado

1. GitHub → seu repositório
2. **Actions** (aba)
3. Buscar **Sincronização Olist Diária**
4. Deve estar listado (mas ainda não rodou, pois a data agendada não chegou)

### 4.3 Teste: Disparar manualmente

1. Abra **Actions** → **Sincronização Olist Diária**
2. Clique **Run workflow** → **Run workflow**
3. Aguarde ~2-3 min
4. Verifique:
   - ✅ Workflow rodou sem erro
   - ✅ Logs mostram `✅ Sincronização iniciada com sucesso`
   - ✅ Supabase mostra novo registro em `sync_runs` com status `running` depois `success`

---

## Step 5: Verificar Agendamento

### 5.1 Quando roda?

- **Tempo:** Diariamente às 02:00 AM UTC (= 23:00 BRT do dia anterior)
- **Timezone:** UTC (horário padrão GitHub)

Para mudar horário, edite `.github/workflows/olist-daily-sync.yml`:

```yaml
on:
  schedule:
    # Mudar para 05:00 UTC (02:00 BRT)
    - cron: '0 5 * * *'
```

### 5.2 Ver histórico de execuções

1. GitHub → **Actions** → **Sincronização Olist Diária**
2. Lista mostra todas as execuções (manuais + agendadas)
3. Clique em uma execução para ver logs detalhados

---

## Step 6: Configurar Alertas (Opcional)

### 6.1 Slack Alerts

Se quiser ser notificado de sucesso/falha:

1. Slack Workspace → **Apps**
2. Buscar **Incoming Webhooks** → **Add to Slack**
3. Copiar webhook URL (começa com `https://hooks.slack.com/...`)
4. GitHub → Settings → Secrets → **New secret**
   - Nome: `SLACK_WEBHOOK_URL`
   - Valor: webhook URL do Slack

O workflow já inclui steps de notificação; eles ativarão automaticamente.

### 6.2 Email Alerts (Supabase)

Configurar notificação de email quando sync falha:

```sql
-- Criar trigger que envia email em falha
-- (Implementar via Supabase Functions)
```

---

## Troubleshooting

### ❌ "Token de autorização inválido" (401)

**Causa:** `SYNC_API_TOKEN` errado ou não configurado.

**Solução:**
1. GitHub → Settings → Secrets → verificar `SYNC_API_TOKEN`
2. Deve corresponder ao token gerado em Step 2.2
3. Se esqueceu o token, gere um novo:
   ```bash
   openssl rand -hex 20
   ```
4. Atualize o secret no GitHub

### ❌ "Erro ao buscar conexões" (500)

**Causa:** `SUPABASE_SERVICE_ROLE_KEY` inválida.

**Solução:**
1. Verificar que o secret está correto
2. Copiar novamente de Supabase → Project Settings → API → Service Role Secret
3. Atualizar GitHub secret

### ❌ Workflow rodou mas nenhuma org foi sincronizada

**Causa:** Nenhuma organização tem Olist com status `conectado`.

**Solução:**
1. Verificar Supabase:
   ```sql
   SELECT org_id, status FROM integration_connections 
   WHERE provider = 'olist';
   ```
2. Se não houver registros, ir para app e conectar Olist manualmente
3. Reexecutar workflow

### ❌ "Sync já em andamento"

**Causa:** Um sync anterior ainda está rodando (travou).

**Solução:**
1. Aguardar 10 minutos (staleness threshold)
2. Ou limpar manualmente:
   ```sql
   UPDATE sync_runs
   SET status = 'failed', error_message = 'Cancelado manualmente'
   WHERE org_id = 'seu-org-id' 
     AND integration = 'olist'
     AND status = 'running'
     AND started_at < now() - interval '30 minutes';
   ```

---

## Checklist Final

- [ ] `.env.local` tem todas as variáveis Olist/Supabase
- [ ] SYNC_API_TOKEN gerado e seguro
- [ ] GitHub Secrets configurados (5-6 secrets)
- [ ] `.github/workflows/olist-daily-sync.yml` commitado
- [ ] Workflow testado manualmente (Run workflow)
- [ ] Sync rodou com sucesso e dados aparecem em Supabase
- [ ] Próximo sync agendado para 02:00 UTC amanhã
- [ ] (Opcional) Slack alerts configurados

---

## Próximos Passos

1. **Criar dashboard** para ver:
   - Último sync: data/hora/status
   - Próximo sync: data/hora agendada
   - Registros importados na semana

2. **Implementar retry automático** se sync falhar:
   - Verificar se há connection issue (token expirado)
   - Se token expirado, reconnect automático

3. **Alertas inteligentes**:
   - Se volume muito baixo (possível erro)
   - Se sync leva mais de 20 min (anomalia)

---

## Support

Se tiver dúvidas:
- Verificar GitHub Action logs: **Actions** → workflow → step details
- Verificar Supabase logs: **Project Settings** → **Logs**
- Ver documentação: `/docs/olist-data-pipeline.md`
