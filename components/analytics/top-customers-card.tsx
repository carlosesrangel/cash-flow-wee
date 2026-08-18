import { formatBRL } from '@/lib/format/currency'
import type { TopCustomer } from '@/lib/analytics/engine'

interface Props {
  customers: TopCustomer[]
}

export function TopCustomersCard({ customers }: Props) {
  if (customers.length === 0) {
    return <p className="text-sm text-neutral-500">Sem clientes com receita realizada.</p>
  }

  return (
    <div className="rounded-lg border bg-white p-6">
      <h3 className="mb-4 text-lg font-medium">Top Clientes</h3>
      <div className="space-y-3">
        {customers.slice(0, 10).map((customer) => (
          <div key={customer.customerId} className="flex items-center justify-between border-b pb-3 last:border-b-0">
            <div className="flex-1">
              <div className="font-medium text-sm">{customer.customerName}</div>
              <div className="text-xs text-neutral-500">
                {customer.orderCount} pedidos • Ticket: {formatBRL(customer.avgOrderValue)}
              </div>
            </div>
            <div className="text-right">
              <div className="font-bold text-sm">{formatBRL(customer.lifetimeValue)}</div>
              <div className="text-xs text-neutral-500">{customer.revenuePercentage}% da receita</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
