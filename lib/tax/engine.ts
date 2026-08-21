import type { MonthlyValue } from '@/lib/forecast/scenarios'

/**
 * Simples Nacional, faixa 1 (Anexo I/III, receita bruta anual até R$ 180 mil)
 * — alíquota efetiva de partida usada como estimativa até o regime real da
 * organização ser configurado em Configurações. Não é uma constante fiscal
 * definitiva: o cálculo exato depende do faturamento acumulado nos últimos
 * 12 meses (RBT12) e da atividade (Anexo I a V), fora do escopo desta fase.
 */
export const DEFAULT_TAX_RATE = 0.06

export type TaxObligation = {
  ano: number
  mes: number
  receitaProjetada: number
  aliquota: number
  valorImposto: number
  /** YYYY-MM-DD — sempre dia 20 do mês subsequente ao mês de referência da receita. */
  vencimento: string
}

/**
 * Um imposto referente à receita de um mês vence no dia 20 do mês seguinte
 * (regra padrão do Simples Nacional/DAS). Dezembro rola para janeiro do ano
 * seguinte.
 */
function dueDateForMonth(ano: number, mes: number): string {
  const dueMonth = mes === 12 ? 1 : mes + 1
  const dueYear = mes === 12 ? ano + 1 : ano
  return `${dueYear}-${String(dueMonth).padStart(2, '0')}-20`
}

export function computeTaxSchedule(entries: MonthlyValue[], aliquota: number = DEFAULT_TAX_RATE): TaxObligation[] {
  return entries
    .map((entry) => ({
      ano: entry.ano,
      mes: entry.mes,
      receitaProjetada: entry.value,
      aliquota,
      valorImposto: Math.round(entry.value * aliquota * 100) / 100,
      vencimento: dueDateForMonth(entry.ano, entry.mes),
    }))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
}
