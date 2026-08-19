# 🔧 Executar Migrations no Supabase

## Instruções Passo-a-Passo

### 1. Acesse Supabase Dashboard
- Ir para https://supabase.com/dashboard
- Selecionar seu projeto `wee-cash-flow`

### 2. Abra SQL Editor
- Clicar em "SQL Editor" no menu lateral esquerdo

### 3. Execute cada migration na ordem

**Para cada arquivo de migration (0001 até 0017):**

1. Clique em "New Query"
2. Abra o arquivo em: `supabase/migrations/000X_*.sql`
3. Copie TODO o conteúdo do arquivo
4. Cole no editor Supabase
5. Clique em "Run" (ou Ctrl+Enter)
6. Aguarde sucesso (sem erros)
7. Próximo arquivo

### 4. Ordem das migrations:
```
✅ 0001_foundation.sql
✅ 0002_sync_runs.sql
✅ 0003_grants.sql
✅ 0004_tighten_grants.sql
✅ 0005_audit_logs_actor_check.sql
✅ 0006_revoke_public_routine_execute.sql
✅ 0007_olist_integration.sql
✅ 0008_sync_runs_nullable_counts.sql
✅ 0009_sumup_integration.sql
✅ 0010_replace_sumup_transaction_events.sql
✅ 0011_reconciliation.sql
✅ 0012_reconciliation_rejected_status.sql
✅ 0013_cash_flow.sql
✅ 0014_forecast_planning.sql
✅ 0015_forecast_planning_seed.sql
✅ 0016_payment_planning.sql
✅ 0017_sales_analytics_views.sql
```

### 5. Verifique Sucesso
No SQL Editor, rode:
```sql
SELECT version();
```

Se retornar a versão do PostgreSQL, tudo funcionou!

---

**Tempo estimado:** ~10 minutos

**Me avise quando terminar!** Aí vou configurar o Vercel.
