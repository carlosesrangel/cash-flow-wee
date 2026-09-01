export type CashBucket = 'realizado' | 'contratado' | 'projetado'

export type ClassifiedEntry =
  | { included: true; bucket: CashBucket; date: string }
  | { included: false; reason: 'cancelado' | 'situacao_desconhecida' | 'dados_incompletos' }

/**
 * The only `situacao` values confirmed against the real WEE Olist data as of
 * this phase (see docs/superpowers/specs/2026-08-15-fase5-cashflow-design.md,
 * "Evidência real usada nesta design"): `aberto` and `pago`. Both
 * `cancelado` and the Olist API's `cancelada` spelling are kept — if a
 * different value ever comes back from Olist, it falls into
 * `situacao_desconhecida` below rather than being silently treated as
 * `aberto`.
 */
const KNOWN_SITUACOES = ['aberto', 'pago', 'cancelado', 'cancelada']

export type AccountsReceivableInput = {
  valor: number | null
  saldo: number | null
  situacao: string | null
  data_vencimento: string | null
  data_liquidacao: string | null
}

/**
 * `saldo` (not `situacao`) decides realizado vs. contratado — it's the
 * numeric field the Olist keeps consistent with actual payments
 * (`valor_pago = valor - saldo`), so it survives `situacao` text changes.
 *
 * `reconciledCashDate` is the linked SumUp event's `due_date` when this AR
 * row has a resolved reconciliation match (computed by the caller — see
 * `lib/cash-flow/engine.ts`'s `loadReconciledCashDates`); ADR-002 makes it
 * the most precise settlement date available for card installments.
 */
export function classifyAccountsReceivable(
  ar: AccountsReceivableInput,
  reconciledCashDate: string | null
): ClassifiedEntry {
  if (ar.situacao === 'cancelado' || ar.situacao === 'cancelada') return { included: false, reason: 'cancelado' }
  if (!ar.situacao || !KNOWN_SITUACOES.includes(ar.situacao)) {
    return { included: false, reason: 'situacao_desconhecida' }
  }
  if (ar.valor === null || ar.saldo === null) {
    return { included: false, reason: 'dados_incompletos' }
  }

  const date = reconciledCashDate ?? ar.data_liquidacao ?? ar.data_vencimento
  if (!date) return { included: false, reason: 'dados_incompletos' }

  return { included: true, bucket: ar.saldo === 0 ? 'realizado' : 'contratado', date }
}

export type AccountsPayableInput = {
  valor: number | null
  saldo: number | null
  situacao: string | null
  data_vencimento: string | null
}

/**
 * Olist's `/contas-pagar` listing doesn't expose an effective payment date
 * (see docs/integrations/olist.md) — `data_vencimento` is used even for
 * `realizado` (saldo === 0) rows, an approximation documented in the spec's
 * "Riscos e suposições", not a fabricated fact.
 */
export function classifyAccountsPayable(ap: AccountsPayableInput): ClassifiedEntry {
  if (ap.situacao === 'cancelado' || ap.situacao === 'cancelada') return { included: false, reason: 'cancelado' }
  if (!ap.situacao || !KNOWN_SITUACOES.includes(ap.situacao)) {
    return { included: false, reason: 'situacao_desconhecida' }
  }
  if (ap.valor === null || ap.saldo === null || !ap.data_vencimento) {
    return { included: false, reason: 'dados_incompletos' }
  }

  return { included: true, bucket: ap.saldo === 0 ? 'realizado' : 'contratado', date: ap.data_vencimento }
}
