import { formatBRL } from '@/lib/format/currency'
import { formatDateBR } from '@/lib/format/date'
import type { ClassifiedEntry } from '@/lib/cash-flow/classify'
import { AGING_BUCKET_LABEL, type AgingBucket } from '@/lib/cash-flow/aging'

export type AccountsPayableRow = {
  id: string
  numeroDocumento: string | null
  historico: string | null
  fornecedorNome: string | null
  valor: number | null
  classification: ClassifiedEntry
  agingBucket: AgingBucket | null
}

const EXCLUSION_REASON_LABEL: Record<Exclude<ClassifiedEntry, { included: true }>['reason'], string> = {
  cancelado: 'cancelado',
  situacao_desconhecida: 'situação desconhecida',
  dados_incompletos: 'dados incompletos',
}

const BUCKET_LABEL: Record<'realizado' | 'contratado', string> = {
  realizado: 'Realizado',
  contratado: 'Contratado',
}

export function AccountsPayableTable({ rows, today }: { rows: AccountsPayableRow[]; today: string }) {
  void today
  const included = rows.filter((row) => row.classification.included)
  const excluded = rows.filter((row) => !row.classification.included)

  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">Nenhuma conta a pagar encontrada.</p>
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-neutral-50 text-neutral-600">
            <tr>
              <th className="px-3 py-2 font-medium">Documento</th>
              <th className="px-3 py-2 font-medium">Fornecedor</th>
              <th className="px-3 py-2 font-medium">Vencimento</th>
              <th className="px-3 py-2 font-medium">Valor</th>
              <th className="px-3 py-2 font-medium">Situação</th>
              <th className="px-3 py-2 font-medium">Vencimento em</th>
            </tr>
          </thead>
          <tbody>
            {included.map((row) => {
              const classification = row.classification as { included: true; bucket: 'realizado' | 'contratado'; date: string }
              return (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{row.numeroDocumento ?? row.historico ?? '—'}</td>
                  <td className="px-3 py-2">{row.fornecedorNome ?? '—'}</td>
                  <td className="px-3 py-2">{formatDateBR(classification.date)}</td>
                  <td className="px-3 py-2">{row.valor != null ? formatBRL(row.valor) : '—'}</td>
                  <td className="px-3 py-2">{BUCKET_LABEL[classification.bucket]}</td>
                  <td className="px-3 py-2">{row.agingBucket ? AGING_BUCKET_LABEL[row.agingBucket] : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {excluded.length > 0 && (
        <details className="rounded-lg border bg-neutral-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-neutral-700">
            Fora do fluxo de caixa ({excluded.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {excluded.map((row) => (
              <li key={row.id} className="text-neutral-600">
                {row.numeroDocumento ?? row.historico ?? row.id} —{' '}
                {EXCLUSION_REASON_LABEL[(row.classification as { included: false; reason: keyof typeof EXCLUSION_REASON_LABEL }).reason]}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
