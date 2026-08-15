import { diffDaysFromToday } from '@/lib/cash-flow/dates'

export type AgingBucket = 'vencido' | '0-7' | '8-15' | '16-30' | '31-60' | '61-90' | '90+'

/** Fixed bands per Prompt Mestre seção 10, measured from `todayStr` to `cashDate`. */
export function computeAgingBucket(cashDate: string, todayStr: string): AgingBucket {
  const diff = diffDaysFromToday(cashDate, todayStr)
  if (diff < 0) return 'vencido'
  if (diff <= 7) return '0-7'
  if (diff <= 15) return '8-15'
  if (diff <= 30) return '16-30'
  if (diff <= 60) return '31-60'
  if (diff <= 90) return '61-90'
  return '90+'
}

export const AGING_BUCKET_LABEL: Record<AgingBucket, string> = {
  vencido: 'Vencido',
  '0-7': '0 a 7 dias',
  '8-15': '8 a 15 dias',
  '16-30': '16 a 30 dias',
  '31-60': '31 a 60 dias',
  '61-90': '61 a 90 dias',
  '90+': 'Acima de 90 dias',
}
