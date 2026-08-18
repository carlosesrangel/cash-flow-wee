import { formatBRL } from '@/lib/format/currency'
import type { ProductRevenue } from '@/lib/analytics/engine'

interface Props {
  products: ProductRevenue[]
}

export function ProductsRevenueCard({ products }: Props) {
  if (products.length === 0) {
    return <p className="text-sm text-neutral-500">Sem dados de produtos.</p>
  }

  const total = products.reduce((sum, p) => sum + p.total, 0)

  return (
    <div className="rounded-lg border bg-white p-6">
      <h3 className="mb-4 text-lg font-medium">Receita por Produto</h3>
      <div className="space-y-3">
        {products.slice(0, 10).map((product) => {
          const percentage = (product.total / total) * 100

          return (
            <div key={product.productId}>
              <div className="flex items-baseline justify-between gap-2 text-sm mb-1">
                <div className="font-medium truncate">{product.productName}</div>
                <div className="text-right whitespace-nowrap">
                  <div className="font-bold">{formatBRL(product.total)}</div>
                </div>
              </div>
              <div className="h-4 overflow-hidden rounded bg-neutral-100">
                <div className="h-full bg-blue-500" style={{ width: `${percentage}%` }} />
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                {product.invoiceCount} vendas • {product.uniqueCustomers} clientes
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
