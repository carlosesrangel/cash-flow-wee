# WEE CASH FLOW & BUSINESS INTELLIGENCE PLATFORM

## PAPEL

Atue simultaneamente como:

- Senior Full Stack Engineer
- Software Architect
- Data Engineer
- Analytics Engineer
- Financial Systems Architect
- Product Designer especializado em ferramentas financeiras
- QA Engineer
- Security Engineer

Você está construindo uma aplicação web real para uma pequena empresa brasileira de varejo chamada **WEE**.

A aplicação não deve ser apenas um dashboard.

Ela deve funcionar como uma plataforma operacional de:

1. fluxo de caixa;
2. tesouraria;
3. contas a pagar;
4. contas a receber;
5. projeções;
6. cenários financeiros;
7. planejamento de pagamentos;
8. acompanhamento de vendas;
9. análise de clientes;
10. inteligência comercial;
11. controle tributário projetado;
12. reuniões estratégicas de gestão.

O objetivo é substituir progressivamente um modelo financeiro atualmente mantido em Excel e Power Query, preservando suas regras úteis, mas construindo uma arquitetura web robusta, auditável, escalável e muito mais simples de operar.

---

# 1. OBJETIVO DE NEGÓCIO

A WEE precisa responder diariamente e durante reuniões de gestão perguntas como:

- Quanto dinheiro realmente temos hoje?
- Quanto entra nos próximos 7, 15, 30, 60 e 90 dias?
- Quanto precisa sair nesses mesmos períodos?
- Em quais dias o caixa ficará pressionado?
- Qual será o menor saldo de caixa projetado?
- Existe algum período de saldo negativo?
- Quais pagamentos podem gerar problema de liquidez?
- Quais contas estão vencidas?
- Quais recebimentos estão atrasados?
- Quanto temos de recebíveis confirmados?
- Quanto esperamos receber das vendas futuras?
- Quanto das vendas ainda está preso em parcelas?
- Quanto estamos pagando em taxas financeiras?
- Qual o impacto dos impostos?
- O faturamento realizado está acima ou abaixo do planejado?
- Se adiarmos determinado pagamento, como muda o caixa?
- Se as vendas ficarem 10% abaixo da meta, teremos problema?
- Qual é o faturamento por mês?
- Qual é o ticket médio?
- Quantos pedidos tivemos?
- Quantos clientes novos e recorrentes?
- Quais produtos, clientes e canais estão gerando mais vendas?
- Qual é a tendência do negócio?
- Quanto caixa operacional será necessário para sustentar o crescimento?

O sistema precisa transformar essas perguntas em uma interface intuitiva para pessoas que não são especialistas em BI ou finanças.

---

# 2. PRINCÍPIO CENTRAL

Não construir uma cópia do Excel.

Usar o Excel atual apenas como referência para as regras de negócio.

Construir uma aplicação web orientada a decisões.

A hierarquia visual deve priorizar:

**situação atual -> próximos riscos -> causas -> ações possíveis -> detalhes.**

---

# 3. STACK PREFERENCIAL

Utilizar versões estáveis e atuais, verificando compatibilidade antes de instalar dependências.

Preferência:

- Next.js com App Router
- TypeScript estrito
- React
- Tailwind CSS
- shadcn/ui
- Supabase
- PostgreSQL
- Supabase Auth
- Row Level Security
- Zod
- React Hook Form
- TanStack Table
- biblioteca madura de gráficos compatível com React
- date-fns ou equivalente
- Vitest
- Playwright
- Vercel para deployment

Não adicione tecnologias apenas por moda.

Priorize:

- simplicidade;
- manutenibilidade;
- confiabilidade;
- segurança;
- excelente UX;
- baixo custo operacional.

Se alguma tecnologia diferente resolver claramente melhor determinado requisito, documente a decisão antes de adotá-la.

---

# 4. ARQUITETURA DE DADOS

Utilizar PostgreSQL como camada central.

APIs externas nunca devem ser consultadas diretamente pelo navegador.

Fluxo:

External APIs -> server integration layer -> normalized database -> financial engine -> application UI.

Nunca deixar dashboards dependentes diretamente da disponibilidade da SumUp ou Olist.

Manter dados sincronizados localmente.

Implementar sincronização:

- inicial completa;
- incremental;
- manual;
- automática;
- idempotente;
- com retry;
- exponential backoff;
- logging;
- tratamento de rate limit;
- registro da última sincronização bem-sucedida.

Criar uma página "Saúde das Integrações".

---

# 5. FONTES DE DADOS E SOURCE OF TRUTH

## 5.1 Olist ERP / Tiny

A Olist é o ERP oficial da empresa.

Antes de implementar qualquer endpoint:

1. consultar a documentação oficial atual;
2. preferir API V3 quando disponível;
3. usar OAuth2 corretamente;
4. utilizar V2 somente quando o recurso necessário não estiver disponível ou houver uma justificativa concreta;
5. documentar qualquer fallback.

Nunca inventar endpoint ou propriedade.

### Dados necessários

Integrar:

- Pedidos
- Detalhes dos pedidos
- Itens dos pedidos
- Clientes / contatos
- Contas a pagar
- Contas a receber
- Formas de pagamento, quando disponíveis
- Vendedores, quando disponíveis
- Produtos, se necessários para detalhamento comercial

### Olist será source of truth para

- pedidos;
- clientes;
- produtos vendidos;
- faturamento operacional;
- contas a pagar;
- contas a receber;
- fornecedores;
- documentos;
- situação financeira registrada no ERP.

---

# 6. SUMUP

Integrar SumUp usando API server-side.

Nunca expor API key no frontend.

Utilizar os recursos atuais da API oficial para:

- histórico de transactions;
- detalhe individual da transaction;
- transaction events;
- payouts.

A lógica existente utiliza informações equivalentes a:

```text
/v2.1/merchants/{merchant_code}/transactions/history
/v2.1/merchants/{merchant_code}/transactions
/v1.0/merchants/{merchant_code}/payouts
```

Mas confirmar sempre a documentação oficial atual antes de implementar.

Armazenar, quando disponíveis:

- transaction id;
- transaction code;
- amount;
- refunded amount;
- timestamp;
- status;
- payment type;
- card type;
- entry mode;
- installments count;
- payouts total;
- payouts received;
- payout plan;
- payout date;
- payout type;
- fee;
- transaction events;
- installment number;
- payout due date;
- payout effective date;
- payout event status.

---

# 7. REGRA FUNDAMENTAL DE RECONCILIAÇÃO

NÃO somar simplesmente:

Olist Orders + Olist Accounts Receivable + SumUp Transactions.

Isso causaria dupla contagem.

Criar uma camada explícita de reconciliação.

Definir conceitualmente:

### Venda

Pedido/faturamento proveniente do ERP.

### Conta a receber

Direito financeiro registrado no ERP.

### Liquidação SumUp

Movimento financeiro específico das vendas processadas pela SumUp.

### Caixa

Valor efetivamente recebido ou projetado para determinada data.

Quando uma conta a receber da Olist estiver vinculada a uma venda SumUp, usar a SumUp para melhorar a precisão de:

- data de liquidação;
- parcelas;
- taxas;
- valores líquidos;
- eventos de payout.

Nunca contabilizar os dois recebimentos.

Criar mecanismos de matching utilizando, conforme disponibilidade:

- transaction code;
- order id;
- document number;
- external order number;
- value;
- customer;
- date;
- payment method;
- metadata.

Registrar:

- reconciliado automaticamente;
- reconciliado manualmente;
- não reconciliado;
- conflito.

Criar uma tela específica de **Reconciliação Financeira**.

---

# 8. CONTAS A PAGAR

A aplicação precisa importar histórico e futuro do Olist ERP.

Campos essenciais:

- ID;
- fornecedor;
- histórico;
- documento;
- data de emissão;
- vencimento;
- valor original;
- saldo aberto;
- valor pago;
- situação;
- categoria;
- data efetiva do pagamento, quando fornecida;
- origem;
- atualização.

Situações normalizadas:

- paga;
- parcialmente paga;
- aberta;
- vencida;
- cancelada.

Contas canceladas não entram no fluxo.

Para parcial:

```text
valor_pago = valor_original - saldo_aberto
```

Nunca assumir que data de vencimento é igual a data efetiva de pagamento.

Caso a API não informe a data efetiva de baixa, registrar explicitamente que ela é desconhecida.

Não fabricar datas.

---

# 9. CATEGORIZAÇÃO DE DESPESAS

O fluxo atual da WEE possui categorias operacionais recorrentes como:

- Impostos
- Ourives
- Eletroformação
- Complementos
- Pedras
- Banhos
- Cravação
- Prototipagem
- Transportes
- Embalagens
- Papelaria
- Correios
- Eventos
- Visual Merchandising
- Energia e água
- Cartão de crédito
- Aluguel
- Internet e telefone
- Tráfego pago
- Manutenção
- Plano médico
- Contabilidade
- Retiradas
- Projetos
- Shooting
- Análise gemológica
- Despesas gerais

Não depender apenas do texto da API.

Criar tabela de regras de categorização.

Permitir ao usuário mapear:

Fornecedor -> Categoria.

Também permitir regras por palavras no histórico.

Uma categorização manual deve poder substituir a categorização automática.

Guardar histórico dessas mudanças.

---

# 10. CONTAS A RECEBER

Integrar contas a receber históricas e futuras da Olist.

Campos principais:

- id;
- cliente;
- documento;
- pedido de origem;
- emissão;
- vencimento;
- valor;
- saldo;
- situação;
- valor realizado;
- valor em aberto;
- meio de pagamento;
- origem;
- data efetiva de recebimento, se disponível.

Classificar:

- realizada;
- parcial;
- futura;
- vencida;
- vence hoje.

Criar aging:

- vencido;
- 0 a 7 dias;
- 8 a 15 dias;
- 16 a 30 dias;
- 31 a 60 dias;
- 61 a 90 dias;
- acima de 90 dias.

---

# 11. RECEBÍVEIS SUMUP

Preservar e aprimorar a lógica atualmente usada no Excel.

Identificar transações:

```text
type = PAYMENT
status = SUCCESSFUL
amount > 0
```

Para pagamentos parcelados:

```text
parcelas_restantes =
max(0, payouts_total - payouts_received)
```

Dar preferência aos `transaction_events` reais da SumUp para determinar a agenda futura de payout.

Utilizar eventos de payout com status ainda pertinentes à liquidação futura segundo a documentação oficial.

Extrair quando existente:

- installment number;
- event status;
- due date;
- payout date;
- event amount.

Usar essa agenda como informação mais precisa do que uma estimativa matemática quando estiver disponível.

---

# 12. MOTOR HISTÓRICO DE TAXAS SUMUP

Reimplementar no backend a lógica existente de Taxas_12M.

Calcular janela móvel de 12 meses.

Considerar somente transações válidas.

Agrupar pelas dimensões disponíveis:

```text
payment_type
card_type
installments
entry_mode
payout_plan
```

Calcular:

- quantidade de transações;
- valor bruto;
- quantidade com fee conhecida;
- base de valor com fee;
- fee total;
- taxa média simples;
- taxa média ponderada;
- participação no faturamento;
- participação em número de transações.

A principal taxa para projeções deve ser:

```text
taxa_media_ponderada =
fee_total / valor_base_taxa
```

Criar níveis de fallback:

1. combinação exata;
2. payment type + número de parcelas;
3. payment type;
4. taxa global.

Não usar amostras muito pequenas sem sinalizar baixa confiança.

Criar indicador de confiança:

- alta;
- média;
- baixa.

A UI deve mostrar quando um cálculo depende de fallback.

---

# 13. PERFIL HISTÓRICO DE RECEBIMENTO

Reproduzir conceitualmente a atual lógica Perfil_Recebimento_12M.

Para cada modalidade de venda identificar distribuição histórica entre:

```text
mês da venda
e
mês efetivo do recebimento
```

Calcular:

```text
meses_ate_receber
```

e a participação financeira recebida em cada período.

Isso permitirá converter vendas projetadas em entrada de caixa projetada.

Não assumir que venda e caixa pertencem ao mesmo mês.

---

# 14. PROJEÇÃO MANUAL DE VENDAS

Criar módulo chamado:

**Planejamento de Receita**

O usuário deve poder digitar manualmente o faturamento esperado por mês.

Interface semelhante a uma grade financeira simples:

| Ano | Jan | Fev | Mar | ... | Dez | Total |
|---|---:|---:|---:|---:|---:|---:|

Também disponibilizar visão em lista.

Salvar no banco.

Nunca hardcodar a projeção no código.

Cada alteração deve registrar:

- usuário;
- data;
- valor anterior;
- valor novo;
- cenário;
- comentário opcional.

---

# 15. VERSIONAMENTO DE FORECAST

Não sobrescrever previsões antigas.

Criar versões.

Exemplos:

- Planejamento Original
- Forecast Agosto 2026
- Forecast Setembro 2026
- Budget 2027

Permitir comparar:

```text
Forecast Original
vs
Forecast Atual
vs
Realizado
```

Meses realizados jamais devem ser substituídos pela projeção no relatório "Realizado".

Entretanto, preservar o forecast originalmente planejado para medir desvio.

---

# 16. CENÁRIOS

Criar inicialmente:

- Base
- Conservador
- Otimista

Permitir duplicar cenários.

Permitir multiplicadores por mês ou período.

Exemplo:

```text
Base = 100%
Conservador = 85%
Otimista = 115%
```

Os percentuais devem ser editáveis.

Também permitir cenário customizado.

---

# 17. SEED INICIAL DE PLANEJAMENTO

Criar os seguintes registros apenas como dados iniciais editáveis.

```csv
ano,mes,receita
2026,6,35500
2026,7,38000
2026,8,77500
2026,9,39500
2026,10,55000
2026,11,55000
2026,12,115000
2027,1,27000
2027,2,45000
2027,3,45000
2027,4,57000
2027,5,65000
2027,6,55000
2027,7,55000
2027,8,105000
2027,9,60000
2027,10,67000
2027,11,75000
2027,12,135000
2028,1,35100
2028,2,58500
2028,3,58500
2028,4,74100
2028,5,84500
2028,6,71500
2028,7,71500
2028,8,136500
2028,9,78000
2028,10,87100
2028,11,97500
2028,12,175500
2029,1,35100
2029,2,58500
2029,3,58500
2029,4,74100
2029,5,84500
2029,6,71500
2029,7,71500
2029,8,136500
2029,9,78000
2029,10,87100
2029,11,97500
2029,12,175500
2030,1,35100
2030,2,58500
2030,3,58500
2030,4,74100
2030,5,84500
2030,6,71500
2030,7,71500
2030,8,136500
2030,9,78000
2030,10,87100
2030,11,97500
2030,12,175500
```

Os meses anteriores à data atual devem ser tratados como planejamento histórico e utilizados para análise de Forecast vs Realizado, não como caixa futuro.

---

# 18. SAZONALIDADE INTRAMÊS

Preservar a inteligência atualmente existente.

Dividir cada mês em três faixas:

```text
Faixa 1: dias 01 a 09
Faixa 2: dias 10 a 19
Faixa 3: dias 20 ao final
```

Calcular pesos históricos com base nas vendas realizadas.

Fallback:

1. mesmo mês do ano anterior;
2. mesmo mês mais recente disponível;
3. média global dos últimos 12 meses.

Guardar junto à projeção:

- peso;
- fonte utilizada;
- ano histórico utilizado;
- nível de confiança.

---

# 19. MIX DE FORMAS DE PAGAMENTO

Para converter faturamento projetado em recebimento projetado:

Distribuir receita futura conforme mix histórico recente.

Dimensões possíveis:

```text
payment_type
card_type
installments
entry_mode
payout_plan
```

Calcular participação histórica ponderada.

Aplicar participação sobre receita projetada.

Depois aplicar taxa financeira projetada.

Depois aplicar perfil histórico de prazo de recebimento.

Resultado:

```text
Receita Projetada
-> Mix de Pagamentos
-> Taxas
-> Agenda de Recebimento
-> Recebimento Líquido Projetado
```

---

# 20. MOTOR DE FLUXO DE CAIXA

Criar uma camada central chamada conceitualmente:

```text
CashFlowEngine
```

Ela deve consolidar por data:

### Entradas realizadas

- recebimentos efetivamente registrados;
- payouts SumUp efetivamente realizados;
- entradas manuais reconciliadas;
- outras fontes confirmadas.

### Entradas contratadas

- contas a receber abertas;
- agenda de payouts SumUp;
- recebíveis conhecidos.

### Entradas projetadas

- vendas futuras projetadas convertidas em recebimentos futuros.

### Saídas realizadas

- contas efetivamente pagas.

### Saídas comprometidas

- contas a pagar abertas ou parciais.

### Saídas projetadas

- impostos;
- despesas planejadas;
- outros compromissos inseridos manualmente.

Nunca misturar essas naturezas sem identificação.

Cada lançamento deve carregar:

```text
realizado
contratado
projetado
simulado
```

---

# 21. SALDO DE CAIXA

Criar conceito explícito de:

**Saldo de Caixa Confirmado**

Como inicialmente não existe integração bancária obrigatória, permitir informar manualmente:

- data de referência;
- saldo bancário;
- dinheiro físico, se relevante;
- investimentos líquidos, se relevantes;
- comentários.

Somente usuários autorizados podem alterar.

Registrar tudo no audit log.

O motor deve projetar:

```text
saldo_final_dia =
saldo_inicial
+ entradas
- saídas
```

O saldo final de um dia alimenta o saldo inicial do dia seguinte.

---

# 22. AJUSTES MANUAIS

Permitir lançamentos manuais somente quando necessários.

Tipos:

- entrada;
- saída;
- ajuste de saldo.

Exigir:

- descrição;
- valor;
- data;
- categoria;
- responsável;
- justificativa.

Registrar usuário e timestamp.

Nunca apagar silenciosamente.

Usar soft delete e audit log.

---

# 23. PLANEJADOR DE PAGAMENTOS

Este é um dos módulos mais importantes.

Criar tela:

**Planejar Pagamentos**

Mostrar contas futuras ordenadas por vencimento.

Permitir selecionar uma conta e criar uma data de pagamento simulada diferente da data de vencimento.

Exemplo:

```text
Original: 15/09
Cenário: 25/09
```

Imediatamente recalcular o fluxo.

Mostrar:

```text
Saldo mínimo antes
Saldo mínimo depois
Data do saldo mínimo
Dias com caixa negativo antes
Dias com caixa negativo depois
```

Também permitir:

- dividir pagamento;
- antecipar;
- postergar;
- excluir temporariamente do cenário;
- restaurar data original.

IMPORTANTE:

Na primeira versão essas ações são exclusivamente simulações internas.

NÃO alterar o ERP Olist.

Guardar separadamente:

```text
data_vencimento_original
data_pagamento_cenario
```

Nunca destruir a informação de origem.

---

# 24. ALERTAS DE LIQUIDEZ

Criar alertas automáticos.

Exemplos:

### Crítico

Saldo projetado abaixo de zero.

### Atenção

Saldo abaixo do mínimo de segurança configurado.

### Concentração

Muitas contas vencendo em poucos dias.

### Recebíveis

Recebimentos relevantes atrasados.

### Forecast

Venda significativamente abaixo da meta.

### Integração

Sincronização falhou.

Permitir configurar:

```text
Saldo mínimo desejado
```

---

# 25. SIMULAÇÕES WHAT-IF

Criar ferramentas simples de cenário.

Exemplos:

```text
Vendas -10%
Vendas -20%
Vendas +10%
Recebimentos atrasados 7 dias
Despesas +10%
```

Permitir combinar condições.

Não modificar dados originais.

Exibir claramente quando o usuário está vendo um cenário.

---

# 26. DASHBOARD PRINCIPAL

O dashboard deve responder à situação da empresa em poucos segundos.

Primeira linha:

- Saldo de Caixa Atual
- Entradas próximos 30 dias
- Saídas próximos 30 dias
- Saldo projetado em 30 dias
- Menor saldo projetado
- Data do menor saldo

Segunda camada:

### Curva do Caixa

Gráfico diário:

```text
Realizado -> Contratado -> Projetado
```

Diferenciar visualmente as três zonas.

Incluir linha de saldo mínimo de segurança.

### Próximos 30 dias

Entradas vs Saídas.

### Alertas

Mostrar somente informações que demandem atenção.

### Contas críticas

Próximos vencimentos de maior impacto.

---

# 27. VISÃO MENSAL DO FLUXO DE CAIXA

Inspirar-se no modelo de gestão atual, mas não copiar a planilha.

Permitir escolher mês.

Mostrar por dia:

- saldo inicial;
- entradas;
- saídas;
- resultado diário;
- saldo final.

Permitir expandir cada dia para ver lançamentos.

Usuário deve conseguir clicar em um valor e chegar aos registros que o formaram.

---

# 28. VISÃO ANUAL

Criar matriz:

```text
Categoria | Jan | Fev | Mar | ... | Dez | Total
```

Separar:

- Entradas
- Saídas
- Resultado operacional
- Saldo final

Permitir drill-down.

Permitir trocar:

```text
Realizado
Realizado + Contratado
Forecast
Cenário
```

---

# 29. DASHBOARD DE VENDAS

Usar Olist Orders como fonte principal.

KPIs:

- faturamento;
- quantidade de pedidos;
- ticket médio;
- clientes;
- clientes novos;
- clientes recorrentes;
- frequência;
- receita por cliente;
- receita por produto;
- receita por canal;
- receita por vendedor, quando existir;
- evolução mensal;
- acumulado do ano;
- comparação com planejamento.

Filtros:

- período;
- cliente;
- produto;
- canal;
- vendedor;
- status.

Nunca chamar pedido cancelado de venda realizada.

Definir claramente quais situações do ERP entram no faturamento.

Essa regra deve ser configurável e documentada.

---

# 30. CLIENTES

Criar visão de clientes.

Mostrar:

- número de clientes;
- novos clientes;
- recorrentes;
- receita por cliente;
- ticket médio;
- número de pedidos;
- última compra;
- frequência;
- top clientes.

Não implementar métricas de CRM sem dados suficientes.

Não inventar LTV se o histórico necessário não existir.

Se for calcular LTV histórico, nomear corretamente como valor histórico observado ou estimativa, conforme metodologia.

---

# 31. PRODUTOS

Se os detalhes de pedido fornecerem dados adequados:

mostrar:

- faturamento por produto;
- unidades;
- ticket médio por item;
- ranking;
- tendência;
- participação no faturamento.

Não calcular margem sem custo confiável.

Caso custo não esteja disponível, deixar margem explicitamente indisponível.

---

# 32. FORECAST VS REALIZADO

Criar relatório:

```text
Mês
Planejado
Realizado
Diferença R$
Diferença %
```

Mostrar YTD.

Permitir visualizar cenário original e forecast mais recente.

---

# 33. IMPOSTOS

Criar módulo tributário independente do restante do motor financeiro.

Não espalhar regras tributárias pelo código.

Criar tabela versionável de regras.

Permitir cadastrar:

- regime;
- validade inicial;
- validade final;
- faixas;
- alíquotas;
- parcelas a deduzir;
- vencimento;
- observações.

A lógica atual possui cálculo baseado no Simples Nacional e RBT12.

Migrar essa lógica somente depois de validá-la.

ATENÇÃO:

Regras tributárias brasileiras mudam.

Não assumir que as regras de 2026 continuam iguais em 2027, 2028, 2029 ou 2030.

Criar arquitetura versionada.

Para regras não validadas:

```text
status = NECESSITA VALIDAÇÃO CONTÁBIL
```

Não apresentar projeção tributária incerta como fato.

---

# 34. RBT12

Quando habilitado:

calcular RBT12 usando receita tributável correta.

Não assumir que SumUp representa automaticamente todo faturamento tributável.

Criar fonte configurável da receita tributável.

Preferencialmente usar informação consolidada do ERP quando isso representar corretamente o faturamento fiscal.

Documentar a metodologia.

---

# 35. EXPERIÊNCIA DE USO EM REUNIÃO

Este sistema será usado durante reuniões.

Portanto:

- telas devem carregar rapidamente;
- informações principais devem ficar acima da dobra;
- filtros precisam ser simples;
- números devem ser grandes e legíveis;
- detalhes devem aparecer sob demanda;
- tooltips devem explicar métricas;
- gráficos devem responder perguntas;
- evitar excesso de gráficos decorativos;
- evitar aparência genérica de template SaaS.

Projetar para notebook/desktop primeiro, mas garantir responsividade.

Idioma inicial:

```text
Português do Brasil
```

Valores:

```text
BRL
R$ 1.234,56
```

Datas:

```text
dd/MM/yyyy
```

Timezone:

```text
America/Sao_Paulo
```

---

# 36. NAVEGAÇÃO

Estrutura sugerida:

```text
Visão Geral
Fluxo de Caixa
  Diário
  Mensal
  Anual
Contas a Receber
Contas a Pagar
Planejar Pagamentos
Planejamento
Cenários
Vendas
Clientes
Produtos
Impostos
Reconciliação
Integrações
Configurações
```

---

# 37. AUTENTICAÇÃO

Aplicação privada.

Não permitir cadastro público.

Utilizar login por e-mail e senha.

Permitir convite de usuários.

Implementar recuperação segura de senha.

---

# 38. PERFIS DE ACESSO

Criar inicialmente:

### OWNER / ADMIN

Acesso total.

Pode:

- alterar projeções;
- lançar ajustes;
- alterar saldo confirmado;
- administrar usuários;
- administrar integrações;
- criar cenários;
- editar regras.

### MANAGER

Pode:

- visualizar dashboards;
- criar cenários;
- planejar pagamentos;
- alterar projeções se autorizado;
- visualizar contas.

Não pode:

- alterar credenciais;
- administrar usuários.

### VIEWER

Somente leitura.

Projetar RBAC de forma que permissões possam evoluir.

---

# 39. SEGURANÇA

Obrigatório:

- Row Level Security;
- secrets apenas server-side;
- `.env.local` ignorado pelo Git;
- `.env.example` sem segredos;
- validação Zod;
- proteção contra acesso indevido entre organizações;
- audit log;
- rate limiting onde apropriado;
- mascaramento de informações sensíveis quando necessário;
- logs sem tokens;
- logs sem senhas;
- proteção CSRF onde aplicável;
- sessões seguras.

Nunca armazenar senha manualmente.

Usar o sistema de autenticação.

---

# 40. LGPD E DADOS DE CLIENTES

Coletar somente dados necessários.

Evitar exibir CPF/CNPJ completo desnecessariamente.

Criar helper de mascaramento.

Restringir dados pessoais conforme perfil.

---

# 41. MODELO DE DADOS

Desenhar schema normalizado, mas não excessivamente complexo.

Entidades mínimas conceituais:

```text
organizations
profiles
organization_members
integration_connections
sync_runs

olist_orders
olist_order_items
olist_contacts
olist_accounts_payable
olist_accounts_receivable
olist_products

sumup_transactions
sumup_transaction_events
sumup_payouts

financial_categories
category_rules

cash_balance_snapshots
manual_cash_entries

forecast_versions
forecast_entries
forecast_scenarios

payment_scenarios
payment_scenario_items

tax_rule_versions

reconciliation_matches

audit_logs
```

Adicionar índices relevantes para:

- datas;
- IDs externos;
- transaction codes;
- order IDs;
- situação;
- organização.

Aplicar unique constraints para impedir duplicidade durante sincronização.

---

# 42. OBSERVABILIDADE

Cada sync deve registrar:

- integração;
- início;
- fim;
- status;
- páginas processadas;
- registros recebidos;
- registros criados;
- registros atualizados;
- erros;
- duração.

Mostrar na aplicação:

```text
Última atualização SumUp
Última atualização Olist
```

---

# 43. QUALIDADE DOS DADOS

Criar Data Quality checks.

Exemplos:

- conta sem vencimento;
- conta sem fornecedor;
- recebível sem cliente;
- transaction sem transaction_code;
- conta negativa inesperada;
- venda duplicada;
- payout sem transaction;
- recebível potencialmente duplicado;
- distribuição de recebimentos diferente de aproximadamente 100%;
- forecast ausente;
- falha de categorização.

Criar tela:

**Qualidade dos Dados**

---

# 44. EXPLAINABILITY

Todo número relevante deve ser rastreável.

Ao clicar em:

```text
Entradas próximos 30 dias = R$ X
```

o usuário deve conseguir visualizar quais registros compõem R$ X.

Não criar métricas caixa-preta.

---

# 45. PERFORMANCE

Evitar recalcular toda história a cada page load.

Criar:

- queries agregadas;
- views;
- materialized views somente quando justificadas;
- caching seguro quando apropriado.

Manter cálculos financeiros críticos no backend ou banco.

---

# 46. TESTES FINANCEIROS

Testes unitários obrigatórios para:

- saldo inicial/final;
- fluxo acumulado;
- conta parcial;
- conta vencida;
- parcelas restantes;
- taxas ponderadas;
- fallback de taxas;
- distribuição de forecast;
- sazonalidade;
- perfil de recebimento;
- reconciliação;
- prevenção de dupla contagem;
- cenários;
- RBT12;
- impostos.

Utilizar fixtures determinísticas.

Os testes devem provar que:

```text
saldo_final = saldo_inicial + entradas - saídas
```

sempre permanece consistente.

---

# 47. TESTES DE INTEGRAÇÃO

Não depender da API real durante a suíte normal.

Criar fixtures representativas para Olist e SumUp.

Testar:

- paginação;
- rate limit;
- timeout;
- erro 401;
- registros duplicados;
- respostas vazias;
- campos opcionais;
- alterações incrementais.

---

# 48. MODO DEMONSTRAÇÃO

Caso as credenciais reais ainda não estejam disponíveis:

não interromper o desenvolvimento.

Criar modo demo usando dados fictícios claramente identificados como:

```text
DADOS DE DEMONSTRAÇÃO
```

Nunca misturar demo e produção.

---

# 49. EXPORTAÇÃO

Preparar arquitetura para:

- CSV;
- Excel;
- impressão amigável.

Não tornar exportação uma dependência para o MVP.

---

# 50. REGRAS DE IMPLEMENTAÇÃO

Não começar criando componentes aleatórios.

Primeiro:

1. inspecionar o repositório;
2. mapear arquitetura existente;
3. criar plano de implementação;
4. definir modelo de dados;
5. definir source of truth;
6. definir reconciliação;
7. só então construir.

Se o projeto estiver vazio, criar a estrutura necessária.

Não apagar código existente sem necessidade.

Não substituir uma solução funcional sem justificar.

---

# 51. NÃO INVENTAR

Nunca inventar:

- endpoint;
- propriedade da API;
- regra fiscal;
- data de pagamento;
- relacionamento entre pedido e transaction;
- valor de taxa;
- status;
- customer id;
- saldo bancário.

Quando a informação não existir:

```text
unknown / null / não disponível
```

é melhor do que uma inferência silenciosa.

---

# 52. DOCUMENTAÇÃO DE API

Antes de implementar Olist ou SumUp:

consultar documentação oficial atual.

Documentar em:

```text
docs/integrations/olist.md
docs/integrations/sumup.md
```

Registrar:

- endpoints utilizados;
- autenticação;
- scopes;
- paginação;
- rate limit;
- campos usados;
- estratégia incremental;
- edge cases.

---

# 53. CREDENCIAIS

Criar `.env.example`.

Exemplos conceituais:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

SUMUP_API_KEY=
SUMUP_MERCHANT_CODE=

OLIST_CLIENT_ID=
OLIST_CLIENT_SECRET=
OLIST_REDIRECT_URI=
```

Confirmar os nomes finais conforme implementação.

Nunca preencher valores reais no repositório.

---

# 54. FASES DE DESENVOLVIMENTO

## Fase 0

Architecture & Requirements.

Produzir:

```text
docs/architecture.md
docs/data-model.md
docs/financial-rules.md
docs/assumptions.md
```

## Fase 1

Foundation:

- Next.js;
- database;
- auth;
- organization;
- layout;
- RBAC.

## Fase 2

Olist integration.

## Fase 3

SumUp integration.

## Fase 4

Reconciliation layer.

## Fase 5

Cash Flow Engine.

## Fase 6

Forecast Engine.

## Fase 7

Payment Scenario Engine.

## Fase 8

Sales and Customer BI.

## Fase 9

Taxes.

## Fase 10

Testing, security and deployment.

---

# 55. MVP

O MVP somente será considerado pronto quando a sócia puder fazer login e responder:

1. quanto temos de caixa;
2. quanto entra;
3. quanto sai;
4. quanto sobra;
5. quando poderá faltar dinheiro;
6. quais pagamentos estão causando a pressão;
7. qual o efeito de mudar determinada data de pagamento;
8. quanto estamos vendendo;
9. quanto vendemos frente ao planejado.

Não considerar o MVP concluído apenas porque dashboards apareceram na tela.

---

# 56. DEFINIÇÃO DE PRONTO

Para cada funcionalidade exigir:

- implementação funcional;
- tipos TypeScript;
- tratamento de erro;
- loading;
- empty state;
- permission check;
- testes relevantes;
- responsividade;
- acessibilidade básica;
- documentação quando necessária.

---

# 57. README

Criar README completo contendo:

- objetivo;
- arquitetura;
- stack;
- setup;
- variáveis;
- banco;
- migrations;
- seed;
- autenticação;
- Olist;
- SumUp;
- sincronização;
- testes;
- deployment;
- troubleshooting.

---

# 58. DECISÕES IMPORTANTES

Manter arquivo:

```text
docs/decisions.md
```

Registrar decisões relevantes e seus motivos.

Exemplo:

```text
ADR-001: Olist Orders como source of truth para vendas
ADR-002: SumUp como source of truth para settlement de pagamentos SumUp
ADR-003: Simulações de contas a pagar não escrevem no ERP no MVP
```

---

# 59. INTERFACE FINANCEIRA

A aplicação deve parecer uma ferramenta de gestão criada especificamente para a WEE.

Evitar aparência de:

- template administrativo genérico;
- planilha web;
- dashboard com dezenas de gráficos;
- ERP pesado.

Priorizar:

- clareza;
- elegância;
- hierarquia;
- densidade adequada;
- informação financeira acionável.

---

# 60. PRIMEIRA TELA AO ENTRAR

O usuário deve imediatamente enxergar algo semelhante conceitualmente a:

```text
WEE
Fluxo de Caixa

Saldo atual
R$ XXX.XXX

Saldo mínimo projetado
R$ XX.XXX em DD/MM

Próximos 30 dias
Entradas: R$ XXX
Saídas: R$ XXX
Resultado: R$ XXX

[CURVA DE CAIXA]

ALERTAS
3 contas relevantes vencem esta semana
Saldo fica abaixo da reserva mínima em DD/MM
Forecast do mês está X% abaixo da meta
```

---

# 61. FILOSOFIA DO PRODUTO

O software deve transformar:

```text
dados -> informação -> risco -> decisão -> ação
```

Não apenas:

```text
dados -> gráfico
```

Sempre que implementar uma visualização pergunte:

**Qual decisão essa visualização ajuda a tomar?**

Caso não exista uma resposta clara, provavelmente a visualização não é necessária.

---

# 62. RESTRIÇÕES DO PRIMEIRO RELEASE

No primeiro release:

- Olist é read-only;
- SumUp é read-only;
- nenhum pagamento real é executado;
- nenhuma conta é alterada automaticamente;
- nenhum vencimento é alterado no ERP;
- nenhuma ação financeira irreversível é realizada.

As ações de gestão devem ocorrer em uma camada de cenário.

---

# 63. FUTURO

Preparar a arquitetura, sem necessariamente implementar agora, para:

- integração bancária;
- importação OFX;
- alertas por WhatsApp;
- alertas por e-mail;
- IA para explicar variações;
- geração automática de resumo de reunião;
- sugestões de renegociação;
- previsão estatística de vendas;
- comparação orçamento vs realizado;
- DRE gerencial;
- estoque e necessidade de compras;
- capital de giro;
- integração com Power BI.

Não implementar essas funções prematuramente.

---

# 64. COMPORTAMENTO ESPERADO DO AGENTE

Trabalhe como engenheiro responsável por um produto financeiro real.

Não tente impressionar com complexidade.

Questione regras que possam gerar resultado financeiro incorreto.

Prefira explicitamente:

```text
"não tenho dado suficiente"
```

a inventar uma resposta.

Quando encontrar ambiguidade financeira relevante:

1. documentar;
2. escolher a alternativa mais conservadora quando possível;
3. marcar a suposição;
4. não contaminar silenciosamente os cálculos.

---

# 65. PRIMEIRA AÇÃO

Antes de escrever implementação substancial:

1. inspecione todo o repositório;
2. leia este documento integralmente;
3. consulte a documentação oficial atual da SumUp e Olist;
4. gere um plano técnico;
5. proponha o modelo de dados;
6. identifique possíveis riscos de dupla contagem;
7. identifique informações financeiras ainda ausentes;
8. escreva as decisões em `docs/`;
9. implemente por fases;
10. rode testes após cada fase.

Se alguma credencial não estiver disponível, utilize mocks e continue construindo a aplicação.

Não bloqueie todo o desenvolvimento por ausência de uma integração.

O resultado final deve ser uma aplicação executável, testada, documentada e pronta para receber as credenciais de produção da WEE.