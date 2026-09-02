# Auditoria UX — Reconciliação Financeira

Status: fluxo reformulado em código; validação visual autenticada pendente.

A superfície agora prioriza exceções, mostra KPIs de parcelas Tiny, vínculos SumUp, exceções, taxa por valor e variância, e mantém ações de confirmar/desfazer restritas ao perfil autorizado. Códigos técnicos continuam ocultos no resumo; detalhes de candidatos são apresentados como valor e vencimento.

A captura visual de produção ficou bloqueada nesta execução porque a rota redireciona para `/login` e não foi usado nenhum segredo de autenticação. O próximo passo de validação é abrir `/reconciliacao` com uma sessão de teste e conferir mobile/desktop, foco de teclado, contraste e estados vazios com dados reais.
