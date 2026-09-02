import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/reconciliation/run'
import { isVerifiedReconciliation } from '@/lib/reconciliation/verification'
import { loadComparableUniverse } from '@/lib/reconciliation/comparable-universe'
import { buildSignedBridge } from '@/lib/reconciliation/signed-bridge'
import { buildOperationalAlerts, deriveIntegrationHealth, evaluateHealthChecks, type HealthSyncRun, type IntegrationHealth } from './health'

type Connection = { provider: 'olist' | 'sumup'; status: 'desconectado' | 'conectado' | 'precisa_reautorizar' }
type RefreshRun = { created_at: string; analytics_finished_at: string | null; ledger_finished_at: string | null }
type Order = { id: string; data: string | null; data_faturamento: string | null; valor_total_pedido: number | null; situacao: string | number | null; id_nota_fiscal: number | null; raw: Record<string, unknown> | null }
type Match = { id: string; olist_accounts_receivable_id: string; sumup_transaction_id: string | null; sumup_transaction_event_id: string | null; status: string; match_reason: Record<string, unknown> | null; olist_accounts_receivable: Array<{ valor: number | null }> | null }
type Ledger = { source: string; source_id: string | null; source_event_id: string | null; direction: string; event_date: string; amount: number | null; metadata: Record<string, unknown> | null; superseded_at: string | null; status: string }

const money = (value: number) => Math.round(value * 100) / 100
const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()
const cancelled = (value: unknown) => value === 4 || value === 9 || ['cancelado', 'cancelada', 'cancelled', 'canceled'].includes(normalize(value))
const successfulSumup = (row: { status: string | null; eventType: string | null }) => ['successful', 'success', 'reconciled', 'settled', 'paid_out', 'scheduled', 'pending'].includes(normalize(row.status))
const cancelledOrder = (row: Order) => cancelled(row.situacao) || cancelled(row.raw?.situacao ?? row.raw?.situacaoNome ?? row.raw?.situacao_nome)
const positiveOrder = (row: Order) => Number(row.valor_total_pedido ?? 0) > 0 && !cancelledOrder(row)
const isPreInvoice = (row: Order) => {
  const sourceStatus = normalize(row.raw?.situacaoNome ?? row.raw?.situacao_nome ?? row.situacao)
  return ['aberto', 'aprovado', 'preparando_envio', 'pronto_envio', 'pre_invoice', 'pre-invoice'].includes(sourceStatus) || [0, 1, 2].includes(Number(row.situacao))
}

function classifyMissingBillingDate(row: Order): 'CANCELLED' | 'SOURCE_MISSING_FIELD' | 'PRE_INVOICE' | 'OTHER' {
  if (cancelledOrder(row)) return 'CANCELLED'
  if (row.id_nota_fiscal) return 'SOURCE_MISSING_FIELD'
  if (isPreInvoice(row)) return 'PRE_INVOICE'
  return 'OTHER'
}

function duplicateCount(rows: Ledger[], verifiedArIds: Set<string>, now: Date): number {
  const groups = new Map<string, Ledger[]>()
  for (const row of rows.filter((item) => !item.superseded_at)) {
    const key = row.source_event_id
      ? `event:${row.source_event_id}`
      : `row:${row.source}:${row.source_id}:${row.event_date}:${row.direction}:${row.amount}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const sourceDuplicates = [...groups.values()].filter((group) => group.length > 1).length
  const arGroups = new Map<string, Ledger[]>()
  for (const row of rows.filter((item) => !item.superseded_at)) {
    const id = typeof row.metadata?.receivable_id === 'string' ? row.metadata.receivable_id : null
    if (id) arGroups.set(id, [...(arGroups.get(id) ?? []), row])
  }
  const resolvedArDuplicates = [...verifiedArIds].map((id) => arGroups.get(id) ?? []).filter((group) => group.some((row) => row.source !== 'sumup')).length
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
  const forecastActualCollisions = rows.filter((row) => !row.superseded_at && row.source === 'forecast' && row.status === 'projected' && row.event_date < nextMonth).length
  return sourceDuplicates + resolvedArDuplicates + forecastActualCollisions
}

export type SystemHealth = {
  generatedAt: string
  integrations: IntegrationHealth[]
  olist: {
    orderCount: number
    latestOrderNumber: number | null
    latestOrderDate: string | null
    latestOrderSyncedAt: string | null
    dataAgeDays: number | null
    coverage: { period: string; total: number; invoiced: number; preInvoice: number; cancelled: number; unexpectedMissing: number; percent: number; allPersisted: number; allInvoiced: number; allPercent: number }
  }
  financial: {
    reconciliationStatus: 'PASS' | 'ATTENTION'
    signedBridgeDifference: number
    unexplainedResidual: number
    missingSemanticReceivables: number
    duplicateSemanticEvents: number
    verifiedMatches: number
    legacyMatches: number
    ambiguousMatches: number
  }
  checks: ReturnType<typeof evaluateHealthChecks>
  alerts: ReturnType<typeof buildOperationalAlerts>
}

export async function loadSystemHealth(orgId: string, now = new Date()): Promise<SystemHealth> {
  const admin = createAdminSupabaseClient()
  const [runs, connections, latestOrder, orderCount, orders, matches, ledger, comparable, refreshRun] = await Promise.all([
    fetchAllPages<HealthSyncRun>((from, to) => admin.from('sync_runs').select('integration, status, started_at, finished_at, records_received, records_created, records_updated, error_count, error_message').eq('org_id', orgId).order('started_at', { ascending: false }).range(from, to), 'Falha ao carregar execuções de integração'),
    admin.from('integration_connections').select('provider, status').eq('org_id', orgId),
    admin.from('olist_orders').select('numero_pedido, data, synced_at').eq('org_id', orgId).order('data', { ascending: false }).limit(1).maybeSingle(),
    admin.from('olist_orders').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    fetchAllPages<Order>((from, to) => admin.from('olist_orders').select('id, data, data_faturamento, valor_total_pedido, situacao, id_nota_fiscal, raw').eq('org_id', orgId).range(from, to), 'Falha ao carregar qualidade fiscal'),
    fetchAllPages<Match>((from, to) => admin.from('reconciliation_matches').select('id, olist_accounts_receivable_id, sumup_transaction_id, sumup_transaction_event_id, status, match_reason, olist_accounts_receivable:olist_accounts_receivable_id (valor)').eq('org_id', orgId).range(from, to), 'Falha ao carregar qualidade da reconciliação'),
    fetchAllPages<Ledger>((from, to) => admin.from('financial_ledger').select('source, source_id, source_event_id, direction, event_date, amount, metadata, superseded_at, status').eq('org_id', orgId).range(from, to), 'Falha ao carregar integridade do ledger'),
    loadComparableUniverse(orgId),
    admin.from('financial_refresh_runs').select('created_at, analytics_finished_at, ledger_finished_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (connections.error || latestOrder.error || orderCount.error || refreshRun.error) throw new Error('Falha ao carregar saúde das integrações')

  const connectionByProvider = new Map((connections.data ?? []).map((row: Connection) => [row.provider, row.status]))
  const olistHealth = deriveIntegrationHealth({ provider: 'olist', runs: runs.filter((run) => run.integration === 'olist'), connectionStatus: connectionByProvider.get('olist') ?? null, now })
  const sumupHealth = deriveIntegrationHealth({ provider: 'sumup', runs: runs.filter((run) => run.integration === 'sumup'), connectionStatus: connectionByProvider.get('sumup') ?? null, now })
  const refresh = refreshRun.data as RefreshRun | null
  const analyticsHealth = deriveIntegrationHealth({ provider: 'analytics', runs: refresh?.analytics_finished_at ? [{ integration: 'analytics', status: 'success', started_at: refresh.created_at, finished_at: refresh.analytics_finished_at, records_received: null, records_created: null, records_updated: null, error_count: 0, error_message: null }] : [], now })
  const ledgerHealth = deriveIntegrationHealth({ provider: 'ledger', runs: refresh?.ledger_finished_at ? [{ integration: 'ledger', status: 'success', started_at: refresh.created_at, finished_at: refresh.ledger_finished_at, records_received: null, records_created: null, records_updated: null, error_count: 0, error_message: null }] : [], now })

  const validOrders = orders.filter(positiveOrder)
  const allInvoiced = validOrders.filter((row) => Boolean(row.data_faturamento)).length
  const monthIndex = now.getUTCMonth()
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), monthIndex - 12, 1)).toISOString().slice(0, 10)
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), monthIndex, 1)).toISOString().slice(0, 10)
  // Order date is used only to find records that should have a billing date;
  // fiscal revenue itself still uses data_faturamento exclusively elsewhere.
  const coverageCandidates = orders.filter((row) => {
    const sourceDate = (row.data_faturamento || row.data)?.slice(0, 10)
    return Boolean(sourceDate && sourceDate >= periodStart && sourceDate < periodEnd && positiveOrder(row))
  })
  const invoiced = coverageCandidates.filter((row) => Boolean(row.data_faturamento)).length
  const preInvoice = coverageCandidates.filter((row) => !row.data_faturamento && classifyMissingBillingDate(row) === 'PRE_INVOICE').length
  const cancelledCount = orders.filter((row) => {
    const sourceDate = (row.data_faturamento || row.data)?.slice(0, 10)
    return Boolean(sourceDate && sourceDate >= periodStart && sourceDate < periodEnd && cancelledOrder(row))
  }).length
  const unexpectedMissing = coverageCandidates.filter((row) => !row.data_faturamento && !['PRE_INVOICE', 'CANCELLED'].includes(classifyMissingBillingDate(row))).length
  const coverageTotal = coverageCandidates.length
  const latestOrderDate = latestOrder.data?.data ?? null
  const dataAgeDays = latestOrderDate ? Math.max(0, Math.floor((now.getTime() - Date.parse(`${latestOrderDate}T00:00:00Z`)) / 86_400_000)) : null

  const verified = matches.filter((match) => isVerifiedReconciliation(match))
  const legacy = matches.filter((match) => match.match_reason?.v2_classification === 'LEGACY_UNVERIFIED').length
  const ambiguous = matches.filter((match) => match.match_reason?.v2_classification === 'AMBIGUOUS' || match.status === 'conflito').length
  const matchedSumupIds = new Set(verified.map((match) => match.sumup_transaction_id).filter((id): id is string => Boolean(id)))
  const matchedArValue = verified.reduce((sum, match) => sum + Number(match.olist_accounts_receivable?.[0]?.valor ?? 0), 0)
  const matchedSumupValue = comparable.sumupRows.filter((row) => matchedSumupIds.has(row.id)).reduce((sum, row) => sum + row.value, 0)
  const unmatchedSumup = comparable.sumupRows.filter((row) => row.date && row.date >= (comparable.report.COMPARABLE_START_DATE ?? '') && row.date <= (comparable.report.COMPARABLE_END_DATE ?? '') && ['pos', 'ecom'].includes(normalize(row.paymentType)) && successfulSumup(row) && !matchedSumupIds.has(row.id))
  const signed = buildSignedBridge({
    tinyComparableValue: comparable.report.TINY_COMPARABLE_VALUE,
    actualSumupValue: comparable.report.SUMUP_COMPARABLE_VALUE,
    unmatchedSumupByCategory: [{ category: 'UNMATCHED_SUMUP_COMPARABLE', value: unmatchedSumup.reduce((sum, row) => sum + row.value, 0), evidence: 'SumUp comparável sem match verificado' }],
    unmatchedTinyValue: Math.max(0, comparable.report.TINY_COMPARABLE_VALUE - matchedArValue),
    verifiedDateAlignmentValue: matchedSumupValue - matchedArValue,
  })
  const verifiedArIds = new Set(verified.map((match) => match.olist_accounts_receivable_id))
  const duplicateSemanticEvents = duplicateCount(ledger, verifiedArIds, now)
  const activeLedger = ledger.filter((row) => !row.superseded_at)
  const activeOlistIds = new Set(activeLedger.filter((row) => row.source === 'olist' && row.source_id).map((row) => row.source_id as string))
  const activeSumupEventIds = new Set(activeLedger.filter((row) => row.source === 'sumup' && row.source_event_id).map((row) => row.source_event_id as string))
  const missingSemanticReceivables = matches.filter((match) => {
    const represented = verifiedArIds.has(match.olist_accounts_receivable_id)
      ? Boolean(match.sumup_transaction_event_id && activeSumupEventIds.has(match.sumup_transaction_event_id))
      : activeOlistIds.has(match.olist_accounts_receivable_id)
    return !represented && Number(match.olist_accounts_receivable?.[0]?.valor ?? 0) > 0
  }).length
  const financial = {
    reconciliationStatus: Math.abs(signed.check) <= 0.01 && duplicateSemanticEvents === 0 && missingSemanticReceivables === 0 ? 'PASS' as const : 'ATTENTION' as const,
    signedBridgeDifference: money(signed.check),
    unexplainedResidual: money(Math.abs(signed.check)),
    missingSemanticReceivables,
    duplicateSemanticEvents,
    verifiedMatches: verified.length,
    legacyMatches: legacy,
    ambiguousMatches: ambiguous,
  }
  const checks = evaluateHealthChecks({ signedBridgeDifference: financial.signedBridgeDifference, unexplainedResidual: financial.unexplainedResidual, missingSemanticReceivables, duplicateSemanticEvents, unexpectedMissingDataFaturamento: unexpectedMissing })
  return {
    generatedAt: now.toISOString(),
    integrations: [olistHealth, sumupHealth, analyticsHealth, ledgerHealth],
    olist: {
      orderCount: orderCount.count ?? 0,
      latestOrderNumber: latestOrder.data?.numero_pedido ?? null,
      latestOrderDate,
      latestOrderSyncedAt: latestOrder.data?.synced_at ?? null,
      dataAgeDays,
      coverage: { period: `${periodStart.slice(0, 7)}..${periodEnd.slice(0, 7)} (exclusive)`, total: coverageTotal, invoiced, preInvoice, cancelled: cancelledCount, unexpectedMissing, percent: coverageTotal ? money((invoiced / coverageTotal) * 100) : 0, allPersisted: orders.length, allInvoiced, allPercent: orders.length ? money((allInvoiced / orders.length) * 100) : 0 },
    },
    financial,
    checks,
    alerts: buildOperationalAlerts({ integrations: [olistHealth, sumupHealth, analyticsHealth, ledgerHealth], checks, legacyMatches: legacy, ambiguousMatches: ambiguous }),
  }
}
