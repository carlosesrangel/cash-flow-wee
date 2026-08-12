export type NavItem = {
  label: string
  href: string
  children?: NavItem[]
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Visão Geral', href: '/visao-geral' },
  {
    label: 'Fluxo de Caixa',
    href: '/fluxo-de-caixa/diario',
    children: [
      { label: 'Diário', href: '/fluxo-de-caixa/diario' },
      { label: 'Mensal', href: '/fluxo-de-caixa/mensal' },
      { label: 'Anual', href: '/fluxo-de-caixa/anual' },
    ],
  },
  { label: 'Contas a Receber', href: '/contas-a-receber' },
  { label: 'Contas a Pagar', href: '/contas-a-pagar' },
  { label: 'Planejar Pagamentos', href: '/planejar-pagamentos' },
  { label: 'Planejamento', href: '/planejamento' },
  { label: 'Cenários', href: '/cenarios' },
  { label: 'Vendas', href: '/vendas' },
  { label: 'Clientes', href: '/clientes' },
  { label: 'Produtos', href: '/produtos' },
  { label: 'Impostos', href: '/impostos' },
  { label: 'Reconciliação', href: '/reconciliacao' },
  { label: 'Integrações', href: '/integracoes' },
  { label: 'Configurações', href: '/configuracoes' },
]
