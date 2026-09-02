export type FiscalOrder = {
  data_faturamento: string | null
  valor_total_pedido: number | null
  situacao: string | number | null
}

const CANCELLED = new Set(['cancelado', 'cancelada', 'cancelled', 'canceled'])

/** Fiscal accrual source: invoice date, never the order date or a payment date. */
export function fiscalRevenueDate(order: Pick<FiscalOrder, 'data_faturamento'>): string | null {
  return order.data_faturamento
}

export function isValidFiscalRevenue(order: FiscalOrder): boolean {
  return Boolean(order.data_faturamento) && Number(order.valor_total_pedido ?? 0) > 0 && !CANCELLED.has(String(order.situacao ?? '').toLowerCase())
}

