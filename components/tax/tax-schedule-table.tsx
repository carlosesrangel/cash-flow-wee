'use client'

import { formatBRL } from '@/lib/format/currency'
import { formatDateOnlyBR } from '@/lib/format/date'
import type { TaxObligation } from '@/lib/tax/engine'
import { Badge } from '@/components/ui/badge'

const MES_NOMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

export function TaxScheduleTable({ schedule, today }: { schedule: TaxObligation[]; today: string }) {
  if (schedule.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma obrigação calculada.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium">Receita de Referência</th>
            <th className="px-4 py-3 text-right font-medium">Receita Projetada</th>
            <th className="px-4 py-3 text-right font-medium">Alíquota</th>
            <th className="px-4 py-3 text-right font-medium">RBT12</th>
            <th className="px-4 py-3 text-left font-medium">Faixa</th>
            <th className="px-4 py-3 text-right font-medium">Imposto Estimado</th>
            <th className="px-4 py-3 text-left font-medium">Vencimento</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-left font-medium">Origem</th>
          </tr>
        </thead>
        <tbody>
          {schedule.map((s) => {
            const isPast = s.vencimento < today
            const daysUntil = Math.ceil(
              (new Date(s.vencimento).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24)
            )
            const status = isPast ? 'vencido' : daysUntil <= 15 ? 'proximo' : 'futuro'
            return (
              <tr key={`${s.ano}-${s.mes}`} className="border-b hover:bg-muted/50 last:border-0">
                <td className="px-4 py-3 font-medium">
                  {MES_NOMES[s.mes - 1]}/{s.ano}
                </td>
                <td className="px-4 py-3 text-right font-mono">{formatBRL(s.receitaProjetada)}</td>
                <td className="px-4 py-3 text-right text-muted-foreground">{(s.aliquota * 100).toFixed(1)}%</td>
                <td className="px-4 py-3 text-right font-mono">{formatBRL(s.rbt12)}</td>
                <td className="px-4 py-3 text-muted-foreground">{s.faixa}</td>
                <td className="px-4 py-3 text-right font-mono font-semibold">{formatBRL(s.valorImposto)}</td>
                <td className="px-4 py-3">{formatDateOnlyBR(s.vencimento)}</td>
                <td className="px-4 py-3">
                  {status === 'vencido' && <Badge variant="destructive">Vencido</Badge>}
                  {status === 'proximo' && <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">Próximo</Badge>}
                  {status === 'futuro' && <Badge variant="secondary">Futuro</Badge>}
                </td>
                <td className="px-4 py-3"><Badge variant={s.origem === 'realizado' ? 'success' : 'secondary'}>{s.origem === 'realizado' ? 'Realizado' : 'Projetado'}</Badge></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
