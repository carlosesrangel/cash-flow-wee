import 'server-only'
import { sumupFetch, getSumupMerchantCode } from '@/lib/sumup/client'

export type SumupConnectionStatus = 'configurado' | 'erro_configuracao'

export async function checkSumupStatus(): Promise<SumupConnectionStatus> {
  if (!process.env.SUMUP_API_KEY || !process.env.SUMUP_MERCHANT_CODE) {
    return 'erro_configuracao'
  }

  try {
    await sumupFetch(`/v2.1/merchants/${getSumupMerchantCode()}/transactions/history`, { limit: 1 })
    return 'configurado'
  } catch {
    return 'erro_configuracao'
  }
}
