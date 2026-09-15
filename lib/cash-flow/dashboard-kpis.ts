import type { CashFlowDay } from '@/lib/cash-flow/aggregate'
import { shiftDateString } from '@/lib/cash-flow/dates'

export type DashboardKpis = {
  saldoAtual: number | null
  entradas30: number
  saidas30: number
  saldoEm30: number | null
  entradasRealizadas: number
  entradasContratadasProjetadas: number
  saidasRealizadas: number
  saidasContratadasProjetadas: number
}

/** Cards consume canonical closing balances, including any reconciliation within the horizon. */
export function calculateDashboardKpis(days: CashFlowDay[], today: string, saldoAtual: number | null): DashboardKpis {
  const next30 = days.filter((day) => day.date > today && day.date <= shiftDateString(today, 30))
  const sum = (rows: CashFlowDay[], side: 'entradas' | 'saidas', bucket: 'realizado' | 'contratado' | 'projetado') =>
    rows.reduce((total, day) => total + day[side][bucket], 0)
  const entradas30 = sum(next30, 'entradas', 'realizado') + sum(next30, 'entradas', 'contratado') + sum(next30, 'entradas', 'projetado')
  const saidas30 = sum(next30, 'saidas', 'realizado') + sum(next30, 'saidas', 'contratado') + sum(next30, 'saidas', 'projetado')

  return {
    saldoAtual,
    entradas30,
    saidas30,
    saldoEm30: next30.at(-1)?.saldoFinal ?? null,
    entradasRealizadas: sum(days, 'entradas', 'realizado'),
    entradasContratadasProjetadas: sum(days, 'entradas', 'contratado') + sum(days, 'entradas', 'projetado'),
    saidasRealizadas: sum(days, 'saidas', 'realizado'),
    saidasContratadasProjetadas: sum(days, 'saidas', 'contratado') + sum(days, 'saidas', 'projetado'),
  }
}
