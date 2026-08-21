# 📊 Status do Dashboard - 21/08/2026

## ✅ Concluído

### 1. **Branding WEE CASH FLOW**
- ✅ Logo aumentado em 30% (48px → 64px)
- ✅ Cor e fonte padronizadas (Space Mono, brand-navy)
- ✅ Favicon adicionado ao metadata
- **Arquivo**: `components/layout/sidebar.tsx`

### 2. **Dados Sincronizados**
- ✅ Olist: 4.317 registros
- ✅ SumUp: 2.239 registros
- ✅ Reconciliação: 582 matches
- **Total**: 6.556 registros

### 3. **Filtros Avançados**
- ✅ Contas a Pagar: 5 tipos de filtro
- ✅ Contas a Receber: 5 tipos de filtro
- ✅ Padrão: Hoje → próximos 60 dias

### 4. **Documentação**
- ✅ CASH_FLOW_GUIDE.md (explicação completa)
- ✅ SYNC_SETUP.md (setup e troubleshooting)
- ✅ IMPLEMENTATION_COMPLETE.md (resumo técnico)

---

## ⚠️ Em Progresso (Requer Criação de Tabelas)

### Tabelas que Precisam Ser Criadas no Supabase

```sql
-- Sales Metrics (Aba Vendas)
CREATE TABLE sales_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  data_venda DATE NOT NULL,
  quantidade_vendas INTEGER DEFAULT 0,
  receita_total DECIMAL(15,2) DEFAULT 0,
  receita_realizada DECIMAL(15,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Customer Analytics (Aba Clientes)
CREATE TABLE customer_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  cliente_olist_id INTEGER NOT NULL,
  cliente_nome VARCHAR(255),
  quantidade_pedidos INTEGER DEFAULT 0,
  total_gasto DECIMAL(15,2) DEFAULT 0,
  total_recebido DECIMAL(15,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Product Analytics (Aba Produtos)
CREATE TABLE product_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  produto_olist_id INTEGER NOT NULL,
  produto_nome VARCHAR(255),
  quantidade_vendas INTEGER DEFAULT 0,
  receita_total DECIMAL(15,2) DEFAULT 0,
  receita_realizada DECIMAL(15,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Forecast Versions (Aba Planejamento)
CREATE TABLE forecast_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Forecast Monthly Projections
CREATE TABLE forecast_monthly_projections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID NOT NULL REFERENCES forecast_versions(id),
  mes INTEGER NOT NULL,
  ano INTEGER NOT NULL,
  projected_revenue DECIMAL(15,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Forecast Tax Projections
CREATE TABLE forecast_tax_projections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID NOT NULL REFERENCES forecast_versions(id),
  mes_vencimento INTEGER NOT NULL,
  ano_vencimento INTEGER NOT NULL,
  dia_vencimento INTEGER DEFAULT 20,
  aliquota DECIMAL(5,4) DEFAULT 0.10,
  valor_estimado DECIMAL(15,2) DEFAULT 0,
  tipo_imposto VARCHAR(50) DEFAULT 'IRRF',
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 📋 Explicação das Abas Que Faltam Dados

### 1. **Aba Planejamento** (Vazia)
**O que deveria mostrar**:
- Lista de versões de forecast (Base, Conservador, Otimista)
- Tabela com projeções de receita por mês
- Gráfico de tendência
- Tabs: "Receita", "Imposto", "Cenários"

**Dados necessários**:
- `forecast_versions` — versões de forecast
- `forecast_monthly_projections` — receita projetada
- `forecast_tax_projections` — impostos estimados

**Próximo passo**: Criar as tabelas no Supabase, depois popular com os dados do script `populate-analytics.ts`

### 2. **Aba Cenários** (Vazia)
**O que deveria mostrar**:
- Grid de cenários (Base, Conservador, Otimista, Custom)
- Multiplicadores por mês (Ano × Jan-Dez)
- Botão "Novo Cenário"

**Dados necessários**:
- `forecast_scenarios` — definição de cenários
- `scenario_multipliers` — multiplicadores por mês

### 3. **Aba Vendas** (Receita zerada)
**Problema**: Tabela `sales_metrics` não existe
**Solução**: Criar tabela e popular com dados de `olist_orders`

**Dados disponíveis**:
```
Olist Orders (410 registros):
- numero_pedido
- data_prevista
- valor_total_pedido
- situacao
- cliente_olist_id
```

**Cálculo**:
```
Receita = SUM(valor_total_pedido) groupado por data_prevista
Receita Realizada = SUM(valor_total_pedido) 
                   WHERE existe reconciliation_match
```

### 4. **Aba Clientes** (Vazia)
**O que deveria mostrar**:
- Tabela: Cliente | Quantidade Pedidos | Total Gasto | Total Recebido
- Gráfico: Top 10 clientes por receita
- Filtro: Ordernar por gasto, por recebimento, etc

**Dados disponíveis**:
```
Olist Contacts (565 registros) + Olist Orders (410) + Reconciliation (582)
```

**Cálculo**:
```
SELECT
  cliente_olist_id,
  cliente_nome,
  COUNT(*) as quantidade_pedidos,
  SUM(valor_total_pedido) as total_gasto,
  SUM(CASE WHEN matched THEN valor_total_pedido ELSE 0 END) as total_recebido
```

### 5. **Aba Produtos** (Vazia)
**O que deveria mostrar**:
- Tabela: Produto | Quantidade Vendas | Receita | Receita Realizada
- Gráfico: Top 10 produtos
- Filtro: Ordenar por quantidade, receita, etc

**Dados disponíveis**:
```
Olist Products (2.286 registros) + Olist Orders (410)
```

### 6. **Aba Reconciliação** (Confusa)
**Explicação**:

A reconciliação é o **match automático** entre:
1. **Contas a Receber (Olist)** — Quando você vende algo
2. **Transações SumUp** — Quando o cliente paga via SumUp
3. **Data de Liquidação** — Quando o dinheiro cai na sua conta

**Exemplo**:
```
Pedido Olist #12345
├─ Data: 01/08/2026
├─ Cliente: João Silva
├─ Valor: R$ 500
├─ Status: Contas a Receber (pendente)
│
└─ Reconciliação Match
   ├─ Transação SumUp #XYZ789
   ├─ Data: 03/08/2026 (data de liquidação)
   ├─ Valor: R$ 500 (combina!)
   └─ Status: ✓ Matched → Receita Realizada
```

**582 Matches encontrados** = 582 vendas que foram pagas via SumUp

**O que a tabela mostra**:
- ID da match
- Status (pending, confirmed, rejected)
- Reason (automático, manual review, etc)
- Dados do recebível
- Referência à transação SumUp

### 7. **Aba Configurações** (Vazia)
**O que deveria mostrar**:
- Aba 1: Organização
  - Nome, CNPJ, Email, Logo
  - Saldo mínimo de caixa (alerta)
  - Moeda (BRL padrão)
  
- Aba 2: Integrações
  - Status Olist (conectado)
  - Status SumUp (conectado)
  - Teste de conexão
  
- Aba 3: Usuários
  - Listar membros
  - Roles (admin, operacional, visualização)
  - Adicionar/remover usuários
  
- Aba 4: Impostos
  - IRRF padrão (%)
  - Data padrão de vencimento (20)
  - Tipos de imposto

---

## 🚀 Próximos Passos (Prioritário)

### P1: Criar Tabelas no Supabase (5 min)
1. Ir para Supabase → SQL Editor
2. Executar o script SQL acima para criar:
   - `sales_metrics`
   - `customer_analytics`
   - `product_analytics`
   - `forecast_versions`
   - `forecast_monthly_projections`
   - `forecast_tax_projections`

### P2: Popular Dados (2-3 min por script)
```bash
npm run populate:analytics
```

### P3: Criar Componentes de Página
- [ ] Pages: Vendas, Clientes, Produtos, Planejamento, Cenários, Configurações
- [ ] Components: Sales chart, Customer table, Product grid, Forecast table
- [ ] Conectar dados às tabelas

---

## 📝 Fluxo de Caixa - Detalhe por Data (Não Implementado Ainda)

**O que fazer**:
1. Clickar em uma data na curva de caixa
2. Expandir card mostrando:
   - **Entradas**: Recebimentos que caíram na conta naquela data
   - **Saídas**: Pagamentos que saíram da conta
   - **Saldo**: Total inicial - Saídas + Entradas

**Exemplo**:
```
21/08/2026 — Saldo Final: R$ 25.340,50
├─ Saldo Inicial: R$ 20.000
├─ Entradas
│  ├─ Transação SumUp #1: R$ 3.500 (Pedido #12345)
│  ├─ Transação SumUp #2: R$ 2.340 (Pedido #12346)
│  └─ Total Entradas: R$ 5.840
├─ Saídas
│  ├─ Nota Fiscal #NF-001: R$ 500 (Fornecedor A)
│  └─ Total Saídas: R$ 0 (não houve débito nesse dia)
└─ Saldo Final: R$ 25.840
```

**Implementação**:
- Usar `Cash Flow Engine` para calcular detalhes por data
- Criar componente expandable com entradas/saídas
- Ligar a `Cash Flow Table` para detalhe

---

## 📊 Imposto - Cálculo e Vencimento

**Regra**:
- Alíquota: 10% (configurável em Settings)
- Vencimento: Dia 20 do mês **subsequente**

**Exemplo**:
```
Agosto/2026 Receita Projetada: R$ 10.000
├─ Imposto: R$ 1.000 (10%)
└─ Vencimento: 20/09/2026 (próximo mês)

Setembro/2026 Receita Projetada: R$ 12.000
├─ Imposto: R$ 1.200 (10%)
└─ Vencimento: 20/10/2026
```

**Implementação**:
- Script `populate-analytics.ts` já calcula isso
- Tabela `forecast_tax_projections` armazena
- Aba "Planejamento" → Tab "Imposto" mostra

---

## 🎯 Resumo Final

| Aba | Status | % Completo | Próximo Passo |
|-----|--------|-----------|----------------|
| Visão Geral | ⚠️ Parcial | 70% | Adicionar curva de caixa |
| Contas a Pagar | ✅ Completo | 100% | — |
| Contas a Receber | ✅ Completo | 100% | — |
| Fluxo de Caixa | ⚠️ Parcial | 80% | Adicionar detalhe por data |
| **Planejamento** | ❌ Vazio | 0% | Criar tabelas no SB |
| **Cenários** | ❌ Vazio | 0% | Criar tabelas no SB |
| **Vendas** | ⚠️ Incompleto | 30% | Criar tabela sales_metrics |
| **Clientes** | ❌ Vazio | 0% | Criar tabela customer_analytics |
| **Produtos** | ❌ Vazio | 0% | Criar tabela product_analytics |
| **Reconciliação** | ✅ Funciona | 100% | (talvez melhorar UI) |
| **Configurações** | ❌ Vazio | 0% | Criar página |

**Tempo estimado para 100%**: ~4 horas
- Criar tabelas: 5 min
- Popular dados: 10 min
- Criar componentes: 180 min
- Testar e polir: 45 min

---

**Gerado**: 21/08/2026  
**Status Dashboard**: 70% Completo
