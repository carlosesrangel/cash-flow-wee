# Pipeline de Dados Olist — Importação Inicial + Sincronização Diária

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Actions (Diário)                 │
│                   Sincronização às 02:00 AM                │
└──────────────────┬──────────────────────────────────────────┘
                   │ POST /api/integracoes/olist/sync
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                   Next.js API Route                          │
│          /app/api/integracoes/olist/sync/route.ts           │
└──────────────────┬──────────────────────────────────────────┘
                   │ runOlistSync(orgId, mode)
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                   Olist Sync Engine                          │
│  - Detecta automaticamente: initial ou incremental           │
│  - Initial: windowDays = 3650 (10 anos de histórico)        │
│  - Incremental: since = último sincronismo                  │
└──────────────────┬──────────────────────────────────────────┘
                   │ syncSellers, syncContacts, syncOrders, etc
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                   Supabase Database                          │
│  olist_orders, olist_contacts, olist_products,              │
│  olist_accounts_payable, olist_accounts_receivable, etc      │
└─────────────────────────────────────────────────────────────┘
```

## Fases de Implementação

### Fase 1: Importação Inicial (Manual)

**Objetivo:** Carregar o histórico completo da Olist (~10 anos).

**Como funciona:**
1. Usuário faz login no sistema
2. Navega para Integrações → Conectar Olist
3. Autoriza via OAuth2
4. Sistema detecta que é primeiro sync ("initial mode")
5. Busca histórico completo com `windowDays: 3650`

**Dados importados:**
- Clientes/Contatos (com datas)
- Produtos (full sync sempre)
- Pedidos históricos (com datas)
- Contas a pagar (últimos 10 anos)
- Contas a receber (últimos 10 anos)
- Vendedores, formas de pagamento

**Duração estimada:**
- Primeira importação: 5-15 minutos (depende do volume)
- Monitorado via tabela `sync_runs`

---

### Fase 2: Sincronização Incremental Diária (Automático)

**Objetivo:** Manter dados atualizados com alterações do último dia.

**Implementação:**

#### 1. GitHub Action (`.github/workflows/olist-daily-sync.yml`)

```yaml
name: Sincronização Olist Diária

on:
  schedule:
    # Executa diariamente às 02:00 AM (UTC) = 23:00 BRT (previous day)
    - cron: '0 2 * * *'
  workflow_dispatch:  # Permite disparo manual

jobs:
  sync:
    runs-on: ubuntu-latest
    
    steps:
      - name: Sincronizar dados Olist
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          OLIST_REDIRECT_URI: ${{ secrets.OLIST_REDIRECT_URI }}
        run: |
          # Disparar sync para cada organização conectada
          curl -X POST "${{ secrets.SUPABASE_URL }}/functions/v1/sync-olist" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{"mode": "incremental"}'
      
      - name: Notificar se falhar
        if: failure()
        run: |
          # Notificar via email, Slack, etc
          echo "Sincronização Olist falhou. Verificar logs."
```

#### 2. Supabase Edge Function (Alternativa elegante)

Se preferir centralizar a lógica em Supabase:

```typescript
// supabase/functions/sync-olist/index.ts

import { createClient } from '@supabase/supabase-js'

export default async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  )

  // 1. Listar todas as organizações com Olist conectada
  const { data: connections } = await supabase
    .from('integration_connections')
    .select('org_id')
    .eq('provider', 'olist')
    .eq('status', 'conectado')

  // 2. Para cada org, chamar POST /api/integracoes/olist/sync
  for (const conn of connections || []) {
    try {
      const response = await fetch(
        `${Deno.env.get('SITE_URL')}/api/integracoes/olist/sync`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`, // Service role JWT
            'Content-Type': 'application/json'
          }
        }
      )
      
      if (!response.ok) {
        console.error(`Sync falhou para org ${conn.org_id}:`, await response.text())
      }
    } catch (error) {
      console.error(`Erro ao sincronizar org ${conn.org_id}:`, error)
    }
  }

  return new Response(JSON.stringify({ status: 'ok' }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
```

---

## Configuração Passo a Passo

### 1. Preparar Credenciais (GitHub Secrets)

No repositório GitHub:
- Vá para **Settings → Secrets and variables → Actions**
- Adicione:
  - `SUPABASE_URL`: URL do seu projeto Supabase
  - `SUPABASE_SERVICE_ROLE_KEY`: Service role key (NUNCA pública!)
  - `OLIST_REDIRECT_URI`: seu redirect URI
  - `SITE_URL`: https://seu-app.vercel.app (ou domínio customizado)

### 2. Monitoramento de Sync

**Tabela `sync_runs` rastreia cada sincronização:**

```sql
SELECT 
  id,
  org_id,
  integration,
  status,        -- 'running', 'success', 'failed'
  started_at,
  completed_at,
  records_received,
  error_message
FROM sync_runs
ORDER BY started_at DESC
LIMIT 50;
```

**Dashboard no app (opcional):**
Adicionar página `/integrações/status` mostrando:
- Último sync: data/hora
- Status: ✅ Sucesso / ⚠️ Aguardando / ❌ Erro
- Registros importados
- Próximo agendamento

### 3. Alertas e Notificações

**Configurar alertas para sync falhado:**

- Email via Supabase Auth ou Resend
- Webhook no Slack
- Webhook na sua app mobile/web

Exemplo com Slack:

```typescript
// Chamar após falha de sync
await fetch('https://hooks.slack.com/services/YOUR/WEBHOOK', {
  method: 'POST',
  body: JSON.stringify({
    text: `❌ Olist Sync Falhou para ${orgName}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Erro:* ${errorMessage}\n*Org:* ${orgName}\n*Horário:* ${new Date().toLocaleString('pt-BR')}`
        }
      }
    ]
  })
})
```

---

## Fluxo de Dados Detalhado

### Sincronização Inicial (Primeira vez)

1. ✅ Usuário conecta Olist via OAuth2
2. ✅ Sistema cria token em `integration_connections`
3. ✅ Primeiro POST `/api/integracoes/olist/sync` dispara
4. ✅ Sistema detecta: "Nenhum sync anterior" → **mode = 'initial'**
5. ✅ Busca histórico de **3.650 dias** (10 anos)
6. ✅ Importa:
   - Contatos desde 2016
   - Pedidos desde 2016
   - Contas a pagar desde 2016
   - Contas a receber desde 2016
   - Produtos (todos)
7. ✅ Executa reconciliação automática
8. ✅ Registra em `sync_runs` com status 'success'

### Sincronização Incremental (Diárias)

1. ✅ GitHub Action dispara diariamente às 02:00 UTC
2. ✅ Faz POST `/api/integracoes/olist/sync`
3. ✅ Sistema verifica: "Sync anterior? Sim" → **mode = 'incremental'**
4. ✅ Busca apenas mudanças das **últimas 24 horas**
5. ✅ Importa apenas registros novos/modificados
6. ✅ Executa reconciliação
7. ✅ Logs em `sync_runs`

**Tempo:** ~1-3 minutos (very fast!)

---

## Casos de Uso

### Use Case 1: Importar primeiro mês de história

O usuário quer apenas junho 2026, não os últimos 10 anos.

**Solução:**
1. Modificar o código em `lib/olist/sync/accounts-payable.ts`:
   ```typescript
   const apArOptions = mode === 'initial' ? { windowDays: 30 } : {}
   ```
2. Ou aceitar um parâmetro URL: `/sync?windowDays=30`

### Use Case 2: Reprocessar tudo (Reset)

Se houver erro na importação:

```sql
-- 1. Limpar dados
DELETE FROM olist_orders WHERE org_id = 'your-org-id';
DELETE FROM olist_contacts WHERE org_id = 'your-org-id';
-- ... outras tabelas

-- 2. Forçar próximo sync como initial
DELETE FROM sync_runs 
WHERE org_id = 'your-org-id' 
  AND integration = 'olist' 
  AND status = 'success';

-- 3. Disparar sync via UI ou API
POST /api/integracoes/olist/sync
```

### Use Case 3: Pausar/Retomar sincronização

Se quiser pausar atualizações temporariamente:

```sql
UPDATE integration_connections
SET status = 'desconectado'  -- Pausa
WHERE org_id = 'your-org-id' AND provider = 'olist';

-- Depois, para retomar:
UPDATE integration_connections
SET status = 'conectado'  
WHERE org_id = 'your-org-id' AND provider = 'olist';
```

---

## Performance e Limites

| Métrica | Valor | Notas |
|---------|-------|-------|
| Sincronização Inicial | 5-15 min | Depende do volume |
| Sincronização Incremental | 1-3 min | Muito rápida |
| Limite de Rate (Olist) | ~25 req/min | Tratado com retry + backoff |
| Refresh Token TTL | 1 dia | Se não sincronizar por 24h, exige reconexão |
| Histórico máximo | 10 anos | Configurável, padrão = windowDays: 3650 |

---

## Troubleshooting

### ❌ "Sincronização em andamento"
Outro sync ainda está rodando. Espere 10 min (staleness threshold).
```sql
-- Ver sync em andamento
SELECT * FROM sync_runs WHERE status = 'running';
```

### ❌ "Token expirado" / "Precisa reautorizar"
Token refresh expirou (1 dia sem sincronismo).
**Solução:** Reconectar via `/integracoes/olist/conectar`

### ❌ Rate limit (429)
Olist limitou requisições.
**Solução:** Retry automático com backoff já implementado. Se persistir, aumentar delay em `lib/olist/client.ts`.

### ❌ GitHub Action falhando
1. Verificar Secrets em GitHub → Settings → Secrets
2. Testar disparo manual: Actions → Sync Olist Diária → Run workflow
3. Ver logs: Actions → workflow run → step output

---

## Checklist de Implementação

- [ ] Credenciais Olist configuradas em `.env.local`
- [ ] Usuário conecta Olist via OAuth2 (teste manual)
- [ ] Primeiro sync roda e histórico é importado
- [ ] Tabela `sync_runs` registra sucesso
- [ ] GitHub Secrets configurados (SUPABASE_URL, SERVICE_ROLE_KEY, etc)
- [ ] `.github/workflows/olist-daily-sync.yml` criado
- [ ] Workflow testado manualmente (Run workflow)
- [ ] Próxima sincronização automática verificada no horário agendado
- [ ] Alertas (email/Slack) configurados para falhas
- [ ] Dashboard de status criado (opcional)

---

## Próximos Passos

1. **Fase 3:** Adicionar UI para:
   - Ver status último sync
   - Disparar sync manual
   - Pausar/retomar sincronização

2. **Fase 4:** Analytics:
   - Gráfico de volume de pedidos/clientes por semana
   - Alertas de anomalias (volume muito baixo = possível erro)

3. **Fase 5:** Webhooks da Olist:
   - Se Olist oferecer webhooks, usar para sync em tempo real
   - Atualmente é poll-based; webhooks seria push-based
