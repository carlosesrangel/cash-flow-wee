# Auditoria RFV — Cash Flow WEE

Status: `RFV_IMPLEMENTED=YES`, com filtros cumulativos na tela de Clientes.

Recência é calculada por `daysSinceLastOrder`; frequência por `orderCount`; valor por `lifetimeValue`. A tela expõe as faixas solicitadas: recência 0–29, 30–60, 61–90, 91–180, 181–365, 366–730 e 731+ dias; frequência 1, 2–3, 4–6, 7–10 e 11+ compras; valor R$ 0–1.000, R$ 1.001–2.000, R$ 2.001–3.000, R$ 3.001–5.000, R$ 5.001–10.000 e R$ 10.001+.

Os filtros são cumulativos: cada seleção é aplicada sobre a mesma coleção de clientes já calculada. O LTV exibido usa a métrica `lifetime_value`; a tabela não apresenta mais “Peças” como indicador principal.

Fontes atuais: `app/api/analytics/customers/route.ts`, `lib/analytics/engine.ts`, view `v_customer_metrics`, pedidos e itens Olist sincronizados. O refresh de analytics deve permanecer idempotente e excluir cancelamentos pela regra comercial vigente antes de publicar métricas.
