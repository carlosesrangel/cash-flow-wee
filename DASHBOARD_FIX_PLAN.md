# 📋 Plano de Correção do Dashboard

## Status das Abas

| Aba | Status | Problema | Solução |
|-----|--------|----------|----------|
| **Visão Geral** | ⚠️ Incompleta | Curva de caixa não mostra | Derivar de olist_accounts_* |
| **Contas a Pagar** | ✅ OK | — | Filtros já funcionando |
| **Contas a Receber** | ✅ OK | — | Filtros já funcionando |
| **Fluxo de Caixa** | ⚠️ Incompleta | Sem detalhe por data | Adicionar expandable rows |
| **Planejamento** | ❌ Vazio | Sem forecast_versions | Criar dados de forecast |
| **Cenários** | ❌ Vazio | Sem forecast_scenarios | Criar dados de cenários |
| **Vendas** | ⚠️ Incompleta | Receita zerada | Derivar de olist_orders + reconciliação |
| **Clientes** | ❌ Vazio | Sem customer_analytics | Derivar de olist_contacts + pedidos |
| **Produtos** | ❌ Vazio | Sem product_analytics | Derivar de olist_products + pedidos |
| **Reconciliação** | ✅ Funciona | Confuso | Explicar melhor a UI |
| **Configurações** | ❌ Vazio | Sem implementação | Criar abas de settings |

---

## Dados Disponíveis

✅ **OLIST** (6.317 registros):
- olist_sellers (1)
- olist_products (2.286)
- olist_orders (410)
- olist_accounts_receivable (625)
- olist_accounts_payable (419)
- olist_contacts (565)
- olist_payment_methods (11)

✅ **SUMUP** (2.239 registros):
- sumup_transactions (709)
- sumup_payouts (1.528)

✅ **RECONCILIAÇÃO** (582 registros):
- reconciliation_matches

❌ **ANALYTICS** (VAZIO):
- sales_metrics (0)
- product_analytics (0)
- customer_analytics (0)
- forecast_versions (0)
- forecast_scenarios (0)

---

## Estratégia de Preenchimento

### 1. **Sales Metrics** (Aba Vendas)
Derivar de:
```sql
SELECT 
  DATE(o.data_vencimento) as data,
  COUNT(*) as quantidade_vendas,
  SUM(o.valor) as receita,
  SUM(CASE WHEN rm.id IS NOT NULL THEN o.valor ELSE 0 END) as receita_realizada
FROM olist_orders o
LEFT JOIN reconciliation_matches rm ON o.id = rm.olist_accounts_receivable_id
GROUP BY DATE(o.data_vencimento)
```

### 2. **Customer Analytics** (Aba Clientes)
Derivar de:
```sql
SELECT 
  c.olist_id,
  c.nome as cliente_nome,
  COUNT(DISTINCT o.id) as quantidade_pedidos,
  SUM(o.valor) as total_gasto,
  SUM(CASE WHEN rm.id IS NOT NULL THEN o.valor ELSE 0 END) as total_recebido
FROM olist_contacts c
LEFT JOIN olist_orders o ON c.olist_id = o.cliente_olist_id
LEFT JOIN reconciliation_matches rm ON o.id = rm.olist_accounts_receivable_id
WHERE c.tipo = 'cliente'
GROUP BY c.olist_id, c.nome
```

### 3. **Product Analytics** (Aba Produtos)
Derivar de:
```sql
SELECT 
  p.olist_id,
  p.nome as produto_nome,
  COUNT(DISTINCT o.id) as quantidade_vendas,
  SUM(o.valor) as receita_total,
  SUM(CASE WHEN rm.id IS NOT NULL THEN o.valor ELSE 0 END) as receita_realizada
FROM olist_products p
LEFT JOIN olist_orders o ON p.olist_id = o.produto_olist_id
LEFT JOIN reconciliation_matches rm ON o.id = rm.olist_accounts_receivable_id
GROUP BY p.olist_id, p.nome
```

### 4. **Forecast Data** (Aba Planejamento)
Criar estrutura:
```sql
INSERT INTO forecast_versions (org_id, name, created_at)
VALUES ('30805a10-b85f-4ac0-bd1a-899f93678725', 'Projeção 2026', NOW());

INSERT INTO forecast_monthly_projections (version_id, month, ano, projected_revenue)
SELECT 
  version.id,
  EXTRACT(MONTH FROM o.data_vencimento),
  2026,
  SUM(o.valor)
FROM forecast_versions version
JOIN olist_orders o ON 1=1
GROUP BY version.id, EXTRACT(MONTH FROM o.data_vencimento)
```

### 5. **Imposto** (Derivado de Forecast)
Criar tabela de imposto com vencimento dia 20 de cada mês:
```
Vencimento | Valor Imposto | % de Receita
20/08/26   | R$ 523,40    | 10% (exemplo)
20/09/26   | R$ 628,50    | 10%
20/10/26   | R$ 512,30    | 10%
```

---

## Branding Fixes

### Logo
- [ ] Aumentar WEE em 30%
- [ ] Padronizar cor e fonte (CASH FLOW)
- [ ] Adicionar como favicon

### Arquivos a Modificar
- `app/layout.tsx` — Logo principal
- `components/ui/logo.tsx` — Componente de logo
- `public/favicon.ico` — Favicon

---

## Implementação (Prioridade)

### P1 (Crítico)
- [ ] Corrigir branding WEE CASH FLOW
- [ ] Popular sales_metrics (Aba Vendas)
- [ ] Popular customer_analytics (Aba Clientes)
- [ ] Popular product_analytics (Aba Produtos)
- [ ] Criar forecast_versions básico (Aba Planejamento)

### P2 (Importante)
- [ ] Adicionar detalhe no Fluxo de Caixa (expandable rows)
- [ ] Criar dados de cenários
- [ ] Implementar cálculo de impostos
- [ ] Finalizar Configurações

### P3 (Polish)
- [ ] Melhorar explicação de Reconciliação
- [ ] Adicionar mais analytics
- [ ] Criar dashboards avançados

---

## Estimativa de Tempo
- Logo + Branding: 15 min
- Populate sales_metrics: 30 min
- Populate customer_analytics: 30 min
- Populate product_analytics: 30 min
- Forecast básico: 45 min
- Fluxo de Caixa detalhe: 45 min
- **Total**: ~3 horas

---

**Próximo passo**: Executar P1 por completo
