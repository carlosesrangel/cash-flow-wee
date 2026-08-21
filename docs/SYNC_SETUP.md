# 🔄 Configuração de Sincronização Olist/SumUp

Guia completo para configurar a carga inicial e sincronizações automáticas de dados do Olist e SumUp no Supabase.

## Índice

1. [Visão Geral](#visão-geral)
2. [Pré-requisitos](#pré-requisitos)
3. [Carga Inicial](#carga-inicial)
4. [Sincronizações Automáticas](#sincronizações-automáticas)
5. [Monitoramento](#monitoramento)
6. [Troubleshooting](#troubleshooting)

---

## Visão Geral

O sistema de sincronização funciona em duas fases:

### Fase 1: Carga Inicial (One-time)
- **Quando**: Uma única vez no setup inicial, ou manualmente quando necessário
- **O que**: Sincroniza histórico completo (3650 dias) de ambas as integrações
- **Duração**: ~45 minutos por integração (Olist + SumUp)
- **Acionamento**: Manual via GitHub Actions ou terminal local

### Fase 2: Sincronizações Automáticas (Recorrentes)
- **Quando**: Diariamente em horários agendados
- **O que**: Sincroniza apenas dados novos/alterados (últimas 24h)
- **Duração**: ~5-10 minutos por integração
- **Olist**: 02:00 UTC (23:00 BRT anterior)
- **SumUp**: 03:00 UTC (00:00 BRT)

---

## Pré-requisitos

Antes de começar, certifique-se de que:

### 1. **Variáveis de Ambiente Configuradas**
As seguintes variáveis devem estar definidas no GitHub Secrets:

```
SUPABASE_URL              # URL do projeto Supabase
SUPABASE_SERVICE_ROLE_KEY # Chave de serviço do Supabase
OLIST_CLIENT_ID           # ID do cliente Olist
OLIST_CLIENT_SECRET       # Secret do cliente Olist
OLIST_STATE_SECRET        # Secret de estado para OAuth Olist
SUMUP_API_KEY             # Chave API do SumUp
SUMUP_MERCHANT_CODE       # Código do merchant SumUp
SLACK_WEBHOOK_URL         # (Opcional) Para notificações Slack
```

**Para definir secrets no GitHub:**
1. Vá para Settings → Secrets and variables → Actions
2. Clique em "New repository secret"
3. Adicione cada variável acima

### 2. **Migrations do Supabase Executadas**

As migrations devem estar aplicadas no Supabase (veja `SETUP_MIGRATIONS.md`):

```sql
✅ 0001_foundation.sql
✅ 0002_sync_runs.sql
...
✅ 0017_sales_analytics_views.sql
```

### 3. **Integrações Conectadas**

Ao menos uma organização deve ter Olist e/ou SumUp conectadas. A tabela `integration_connections` deve conter:

```sql
SELECT * FROM integration_connections
WHERE provider IN ('olist', 'sumup') AND status = 'conectado';
```

---

## Carga Inicial

### Opção 1: Via GitHub Actions (Recomendado)

**Para executar via interface web:**

1. Vá para **Actions** no seu repositório GitHub
2. Selecione o workflow **"Carga Inicial de Dados"**
3. Clique em **"Run workflow"**
4. Escolha as opções:
   - **Integration**: `both` (padrão), `olist-only`, ou `sumup-only`
   - **Org ID**: deixe em branco para todas as organizações
5. Clique em **"Run workflow"**

**Monitore o progresso:**
- Vá para a execução do workflow
- Acompanhe os logs em tempo real
- Verifique o status final (✅ sucesso ou ❌ falha)

### Opção 2: Via Terminal Local

**Execute localmente:**

```bash
# Carga inicial completa (Olist + SumUp, todas as orgs)
npm run load:initial

# Apenas Olist
npm run load:initial -- --olist-only

# Apenas SumUp
npm run load:initial -- --sumup-only

# Uma organização específica
npm run load:initial -- --org <org-id>

# Combinações
npm run load:initial -- --org <org-id> --olist-only
```

**Requisitos locais:**
- Node.js 24+ instalado
- `.env.local` com todas as variáveis de ambiente
- Acesso à internet (para APIs Olist/SumUp)

### Exemplo de Saída

```
🚀 Iniciando carga inicial de dados

📋 2 organização(ões) para carregar

📊 Iniciando carga inicial do Olist...

🔄 Olist: org-12345678...
✅ Olist org-12345678 concluído em 1247s

🔄 Olist: org-87654321...
✅ Olist org-87654321 concluído em 892s

📊 Iniciando carga inicial do SumUp...

🔄 SumUp: org-12345678...
✅ SumUp org-12345678 concluído em 342s

🔄 SumUp: org-87654321...
✅ SumUp org-87654321 concluído em 278s

✅ Carga inicial concluída com sucesso!
📋 Os dados estão agora sincronizados no Supabase.
⏰ As sincronizações automáticas continuarão rodando conforme configurado.
```

---

## Sincronizações Automáticas

Após a carga inicial, as sincronizações funcionam automaticamente.

### Agendamento

| Integração | Horário      | Janela de Sincronização |
|------------|--------------|-------------------------|
| **Olist**  | 02:00 UTC    | 23:00 BRT (dia anterior)|
| **SumUp**  | 03:00 UTC    | 00:00 BRT (dia atual)  |

### Workflows Disponíveis

#### 1. **Sincronização Olist Diária**
- **Arquivo**: `.github/workflows/olist-daily-sync.yml`
- **Acionamento**: Automático diário ou manual
- **Script**: `scripts/run-olist-sync.ts`

**Disparar manualmente:**
```
Actions → Sincronização Olist Diária → Run workflow
  → Modo: incremental (padrão) ou initial
```

#### 2. **Sincronização SumUp Diária**
- **Arquivo**: `.github/workflows/sumup-daily-sync.yml`
- **Acionamento**: Automático diário ou manual
- **Script**: `scripts/run-sumup-sync.ts`

**Disparar manualmente:**
```
Actions → Sincronização SumUp Diária → Run workflow
  → Modo: incremental (padrão) ou initial
```

#### 3. **Carga Inicial de Dados**
- **Arquivo**: `.github/workflows/initial-data-load.yml`
- **Acionamento**: Manual
- **Script**: `scripts/run-initial-load.ts`

---

## Monitoramento

### Via Dashboard Supabase

Verifique o status dos syncs na tabela `sync_runs`:

```sql
-- Últimos 10 syncs
SELECT
  org_id,
  integration,
  status,
  started_at,
  finished_at,
  records_received,
  error_message
FROM sync_runs
ORDER BY started_at DESC
LIMIT 10;

-- Status resumido
SELECT
  integration,
  status,
  COUNT(*) as count
FROM sync_runs
WHERE started_at > now() - interval '7 days'
GROUP BY integration, status;

-- Última sincronização bem-sucedida por integração
SELECT DISTINCT ON (org_id, integration)
  org_id,
  integration,
  started_at,
  finished_at,
  records_received
FROM sync_runs
WHERE status = 'success'
ORDER BY org_id, integration, started_at DESC;
```

### Via GitHub Actions

1. Vá para **Actions** no seu repositório
2. Visualize o histórico de execuções dos workflows
3. Clique em uma execução para ver logs detalhados

### Via Slack (Opcional)

Se o `SLACK_WEBHOOK_URL` estiver configurado, receba notificações automáticas:
- ✅ Sucesso de sincronizações
- ❌ Falhas de sincronizações
- ⏳ Status de health check

---

## Troubleshooting

### Problema: Sync não está rodando nos horários agendados

**Causa**: Workflows agendados no GitHub podem ter atraso de até 10 minutos.

**Solução**:
1. Verifique se o branch default está correto (deve ser `main`)
2. Verifique se o arquivo `.github/workflows/*.yml` está no branch padrão
3. Verifique o histórico em **Actions** para ver se há tentativas falhadas

### Problema: "Erro ao buscar conexões"

**Causa**: Nenhuma organização com a integração conectada.

**Solução**:
```sql
-- Verificar conexões ativas
SELECT * FROM integration_connections
WHERE status = 'conectado';

-- Se vazio, conectar uma organização via UI
```

### Problema: "SUMUP_API_KEY must be set"

**Causa**: Variável de ambiente não configurada.

**Solução**:
1. Verifique se `SUMUP_API_KEY` está em GitHub Secrets
2. Localmente, adicione ao `.env.local`
3. Reinicie o script

### Problema: Sync para em meio da execução com timeout

**Causa**: Rate limit ou problema de conectividade.

**Solução**:
1. Verifique a saúde da API (Olist/SumUp)
2. Aguarde alguns minutos e dispare novamente
3. Consulte logs no GitHub Actions para mais detalhes
4. Se persistir, contate o suporte das APIs

### Problema: Registros não aparecem no Supabase

**Causa**: Dados retornados da API mas não inseridos.

**Solução**:
```sql
-- Verificar registros recentes
SELECT COUNT(*) FROM olist_sellers
WHERE created_at > now() - interval '24 hours';

SELECT COUNT(*) FROM sumup_transactions
WHERE created_at > now() - interval '24 hours';

-- Verificar erros de sync
SELECT error_message FROM sync_runs
WHERE status = 'failed'
ORDER BY started_at DESC
LIMIT 5;
```

---

## Scripts Disponíveis

### `npm run sync:olist`
Sincroniza dados do Olist (modo incremental por padrão).

```bash
npm run sync:olist                          # Todas as orgs, incremental
npm run sync:olist -- --org <org-id>       # Org específica
npm run sync:olist -- --mode initial       # Força carga inicial
```

### `npm run sync:sumup`
Sincroniza dados do SumUp (modo incremental por padrão).

```bash
npm run sync:sumup                         # Todas as orgs, incremental
npm run sync:sumup -- --org <org-id>      # Org específica
npm run sync:sumup -- --mode initial      # Força carga inicial
```

### `npm run load:initial`
Carga inicial unificada de ambas as integrações.

```bash
npm run load:initial                      # Todas as orgs, Olist + SumUp
npm run load:initial -- --olist-only      # Apenas Olist
npm run load:initial -- --sumup-only      # Apenas SumUp
npm run load:initial -- --org <org-id>    # Org específica
```

---

## Roadmap Futuro

- [ ] Dashboard de monitoramento em tempo real
- [ ] Alertas via email para falhas
- [ ] Retry automático para sincronizações falhadas
- [ ] Sincronização incremental mais inteligente (delta tracking)
- [ ] API endpoint para status de sync
- [ ] Suporte para múltiplos merchant codes SumUp

---

## Contato & Suporte

Para dúvidas ou problemas:
1. Verifique os logs no GitHub Actions
2. Consulte a tabela `sync_runs` para dados brutos
3. Abra uma issue no repositório com detalhes da falha

---

**Última atualização**: 21/08/2026
**Status**: ✅ Funcional (Olist + SumUp)
