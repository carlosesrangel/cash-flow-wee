# 💰 Guia Completo: Cash Flow WEE

## Índice
1. [Visão Geral do Sistema](#visão-geral-do-sistema)
2. [Contas a Pagar](#contas-a-pagar)
3. [Contas a Receber](#contas-a-receber)
4. [Planejar Pagamentos](#planejar-pagamentos)
5. [Fluxo de Caixa](#fluxo-de-caixa)
6. [Filtros e Busca](#filtros-e-busca)

---

## Visão Geral do Sistema

O **Cash Flow WEE** é uma plataforma integrada que sincroniza dados de **Olist** e **SumUp** para oferecer uma visão completa do fluxo de caixa da sua empresa.

### Dados Disponíveis

| Fonte | Dados | Sincronização |
|-------|-------|----------------|
| **Olist** | Pedidos, Contas a Receber, Contas a Pagar, Produtos, Vendedores | Diária (02:00 UTC) |
| **SumUp** | Transações, Repasses/Payouts | Diária (03:00 UTC) |
| **WEE** | Planejamento, Cenários, Simulações | Manual |

---

## Contas a Pagar

### O que é?
**Contas a Pagar (AP - Accounts Payable)** são suas obrigações financeiras com fornecedores. Cada conta representa um pagamento que você precisa fazer.

### Dados Exibidos

| Campo | Descrição | Origem |
|-------|-----------|--------|
| **Nº Documento** | Número da nota fiscal ou documento | Olist |
| **Histórico** | Descrição do produto/serviço | Olist |
| **Fornecedor** | Nome do fornecedor | Olist Contacts |
| **Valor** | Valor total do documento | Olist |
| **Data Vencimento** | Quando o pagamento vence | Olist |
| **Status de Vencimento** | Situação (vencido, a vencer, etc) | Calculado |
| **Dias em Atraso** | Quantos dias está vencido | Calculado |

### Classificação de Status

- 🔴 **Vencido**: Data de vencimento já passou
- 🟠 **0-7 dias**: Vence nos próximos 7 dias
- 🟡 **8-15 dias**: Vence entre 8 e 15 dias
- 🟢 **+15 dias**: Vence em mais de 15 dias
- ⚪ **Cancelado**: Documento cancelado (não considera no fluxo)

### Filtros Disponíveis (Novo! ⭐)

```
Data de Vencimento
├─ Padrão: Hoje → Próximos 60 dias
├─ Intervalo customizável (data início e data fim)
└─ Predefinições: Próxima semana, Próximo mês, Próximos 90 dias

Status de Vencimento
├─ Vencido
├─ A Vencer (0-7 dias)
├─ A Vencer (8-15 dias)
├─ A Vencer (+15 dias)
└─ Cancelado

Fornecedor
├─ Busca por nome
└─ Seleção múltipla

Valor
├─ Mínimo e máximo
└─ Filtro rápido: "Acima de R$X"
```

### Exemplo de Uso

**Cenário**: Você quer saber quais pagamentos vence esta semana para planejar o caixa.

1. Acesse **Contas a Pagar**
2. Filtro de Data: "Próxima semana" (ou customize: hoje → próximos 7 dias)
3. Filtro de Status: "A Vencer (0-7 dias)"
4. Ordene por Valor (decrescente) para ver os maiores pagamentos primeiro
5. Resultado: Lista de pagamentos prioritários

---

## Contas a Receber

### O que é?
**Contas a Receber (AR - Accounts Receivable)** são seus direitos financeiros com clientes. Cada conta representa um pagamento que você espera receber.

### Dados Exibidos

| Campo | Descrição | Origem |
|-------|-----------|--------|
| **Nº Documento** | Número do pedido | Olist |
| **Histórico** | Descrição do produto vendido | Olist |
| **Cliente** | Nome do cliente | Olist Contacts |
| **Valor** | Valor total do pedido | Olist |
| **Data Vencimento** | Quando o pagamento vence | Olist |
| **Data Liquidação** | Quando foi efetivamente recebido | Reconciliação (Olist + SumUp) |
| **Status** | Recebido, Pendente, Cancelado | Calculado |

### Ciclo de Vida

```
Pedido Criado (Olist)
    ↓
Contas a Receber (AR)
    ↓
SumUp Transação Recebida
    ↓
Reconciliação (Data Liquidação)
    ↓
Status: Realizado
```

### Classificação de Status

- 🟢 **Realizado**: Já foi recebido (data_liquidacao preenchida)
- 🟠 **Contratado**: Pendente de recebimento
  - 🔴 **Vencido**: Passou da data e ainda não recebeu
  - 🟡 **0-7 dias**: Vence em até 7 dias
  - 🟡 **8-15 dias**: Vence entre 8 e 15 dias
  - 🟢 **+15 dias**: Vence em mais de 15 dias
- ⚪ **Cancelado**: Venda cancelada

### Filtros Disponíveis (Novo! ⭐)

```
Data de Vencimento
├─ Padrão: Hoje → Próximos 60 dias
├─ Intervalo customizável
└─ Predefinições: Próxima semana, Próximo mês, Próximos 90 dias

Status de Recebimento
├─ Realizado (já recebeu)
├─ Contratado - Vencido (atrasado)
├─ Contratado - A Vencer 0-7 dias
├─ Contratado - A Vencer 8-15 dias
├─ Contratado - A Vencer +15 dias
└─ Cancelado

Cliente
├─ Busca por nome
└─ Seleção múltipla

Valor
├─ Mínimo e máximo
└─ Filtro rápido: "Acima de R$X"
```

### Exemplo de Uso

**Cenário**: Você quer cobrar todos os pagamentos vencidos de mais de 30 dias.

1. Acesse **Contas a Receber**
2. Filtro de Status: "Contratado - Vencido"
3. Filtro de Data: Personalizar → "Até 30 dias atrás" (antes de 22/07/2026)
4. Resultado: Lista de clientes inadimplentes para ação de cobrança

---

## Planejar Pagamentos

### O que é?
**Planejar Pagamentos** é uma ferramenta de **simulação de cenários** para otimizar seu fluxo de caixa. Permite testar diferentes datas de vencimento sem afetar os dados reais.

### Funcionalidade Principal

#### 1. **Lista de Contas a Pagar**
- Mostra todas as contas a pagar pendentes
- Ordena por data de vencimento

#### 2. **Criação de Cenários**
Um cenário é um "o que se" — você especifica ajustes nas datas de vencimento e vê o impacto.

**Exemplo de Cenário:**
```
Cenário: "Negociar Prazos"
├─ Fornecedor A: aumentar prazo de 30 dias para 60 dias
├─ Fornecedor B: aumentar prazo de 15 dias para 45 dias
└─ Fornecedor C: sem mudança
```

#### 3. **Análise de Impacto**
Quando você seleciona um cenário, o sistema calcula:

| Métrica | Descrição |
|---------|-----------|
| **Saldo Mínimo Antes** | Menor saldo do período com datas originais |
| **Saldo Mínimo Depois** | Menor saldo do período com novo cenário |
| **Data do Saldo Mínimo** | Quando ocorre o saldo mínimo |
| **Dias Negativos Antes** | Quantos dias o saldo fica negativo (original) |
| **Dias Negativos Depois** | Quantos dias o saldo fica negativo (cenário) |
| **Indicador de Melhoria** | ✅ Melhora ou ⚠️ Piora o fluxo |

### Casos de Uso

#### Caso 1: Otimizar Fluxo Positivo
**Objetivo**: Reduzir dias com saldo negativo
**Ação**: Criar cenário aumentando prazos de pagamento
**Resultado**: Sincronizar pagamentos com recebimentos

#### Caso 2: Negociar com Fornecedores
**Objetivo**: Saber qual ajuste de prazo é mais impactante
**Ação**: Testar diferentes cenários antes de negociar
**Resultado**: Data precisa para proposição

#### Caso 3: Reduzir Necessidade de Capital de Giro
**Objetivo**: Minimizar custos de empréstimo/cheque especial
**Ação**: Simular extensão de prazos
**Resultado**: Economia de juros

### Fluxo de Uso

```
1. Ir para "Planejar Pagamentos"
2. Ver resumo: Pagamentos Pendentes + Cenários Disponíveis
3. Observar "Contas a Pagar" no painel esquerdo
4. Selecionar um "Cenário de Simulação"
5. Ver "Análise de Impacto" no painel inferior
6. ✅ Se melhora → considerar implementar
7. ❌ Se piora → ajustar parâmetros
```

### Dados Necessários

Para funcionar, são necessários:
- ✅ Contas a Pagar sincronizadas (Olist)
- ✅ Cenários criados (manual, via API)
- ✅ Histórico de fluxo de caixa (calculado automaticamente)

---

## Fluxo de Caixa

### O que é?
**Fluxo de Caixa** é o resumo dinâmico de todo o dinheiro entrando e saindo da sua empresa.

### Tipos de Visualização

#### 📅 Fluxo Diário
- Saldo dia a dia
- Muito granular
- Ideal para: Decisões operacionais diárias
- Atualização: Real-time (conforme recebimentos/pagamentos)

#### 📊 Fluxo Mensal
- Saldo acumulado por mês
- Visão média
- Ideal para: Planejamento mensal
- Atualização: No final do mês

#### 📈 Fluxo Anual
- Saldo acumulado por ano
- Visão estratégica
- Ideal para: Planejamento anual, projeções
- Atualização: No final do ano

### Componentes do Fluxo

```
SALDO INICIAL (1º dia do período)
    ↓
+ RECEBIMENTOS (Contas a Receber realizadas)
    ↓
- PAGAMENTOS (Contas a Pagar realizadas)
    ↓
= SALDO FINAL (último dia do período)
```

### Cores e Indicadores

- 🟢 **Saldo Positivo**: Empresa tem caixa
- 🔴 **Saldo Negativo**: Empresa precisa de crédito/capital
- 🟡 **Saldo Crítico**: Abaixo de limite mínimo

---

## Filtros e Busca

### Padrão de Data (Novo! ⭐)

Todas as páginas de AP/AR agora mostram por padrão:
```
Data Vencimento: HOJE → PRÓXIMOS 60 DIAS
```

**Por quê?**
- Foco em decisões operacionais (próximas 2 meses)
- Reduz clutter de dados históricos
- Alinha com ciclo de planning comum

**Como Customizar?**
1. Clique no filtro de Data
2. Selecione "Intervalo Personalizado"
3. Escolha data início e fim
4. Aplique filtro

### Predefinições Rápidas

```
📅 Filtro de Data
├─ Próxima Semana (hoje → próximos 7 dias)
├─ Próximo Mês (hoje → próximos 30 dias)
├─ Próximos 60 Dias (padrão)
├─ Próximos 90 Dias
├─ Este Mês (1º → último dia do mês atual)
├─ Próximo Mês (1º → último dia do mês que vem)
├─ Este Trimestre
├─ Este Ano
└─ Intervalo Personalizado (data-picker)
```

### Ordenação

Padrão: **Data de Vencimento (ascendente)**

Outras opções:
- Por Fornecedor/Cliente (A-Z)
- Por Valor (crescente/decrescente)
- Por Status de Vencimento

### Busca Textual

Busque por:
- Nome do fornecedor/cliente
- Número do documento
- Descrição do histórico

---

## Integração de Dados

### Fluxo de Sincronização

```
Olist API
├─ Pedidos → Contas a Receber
├─ Faturas → Contas a Pagar
├─ Contatos → Fornecedores/Clientes
└─ Produtos → Referência de histórico

SumUp API
├─ Transações → Liquidações de AR
└─ Payouts → Detalhes de repasse

Reconciliação (Automática)
├─ Match: AR (Olist) + Transação (SumUp)
├─ Data Liquidação = Data SumUp
└─ Status: Realizado
```

### Dados Não Sincronizados

⚠️ **O sistema NÃO sincroniza automaticamente:**
- Despesas não vinculadas a Olist/SumUp
- Impostos (IRPJ, PIS, COFINS, etc)
- Juros e multas
- Transações manuais ou de outras fontes

💡 **Solução**: Use a aba "Configurações" para adicionar categorias customizadas.

---

## Perguntas Frequentes

### P: Por que meu saldo do fluxo não bate com meu banco?
**R**: O Cash Flow WEE mostra apenas dados de Olist + SumUp. Se você tem outras fontes de receita/despesa, elas não aparecem.

### P: Posso editar as datas de vencimento?
**R**: Não nos dados reais (para manter auditoria). Mas pode simular em **Planejar Pagamentos** sem afetar nada.

### P: Como saber se um pagamento foi feito?
**R**: Se aparece em **Contas a Receber** com status "Realizado", significa que uma transação SumUp foi matched e a data de liquidação foi preenchida.

### P: Posso exportar os dados?
**R**: Sim! Cada tabela tem botão de export (CSV/Excel) - em desenvolvimento.

### P: Qual é o fluxo ideal de caixa?
**R**: Não há "ideal" universal. Depende do seu negócio. Mas geralmente:
- ✅ Recebimentos antes de pagamentos = positivo
- ⚠️ Pagamentos antes de recebimentos = negativo (precisa de capital)

---

**Última Atualização**: 21/08/2026  
**Status**: ✅ Cash Flow + Planejar Pagamentos Funcionando  
**Próximo**: Adicionar Forecast vs Realizado
