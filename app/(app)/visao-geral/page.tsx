import { getCurrentMember } from '@/lib/auth/session'
import { canManageCashBalance } from '@/lib/auth/rbac'
import { resolveOpeningBalance, buildCashFlowDays } from '@/lib/cash-flow/engine'
import { loadCanonicalCashFlow } from '@/lib/ledger/canonical-cash-flow'
import { getMinimumProjectedBalance } from '@/lib/cash-flow/aggregate'
import { calculateDashboardKpis } from '@/lib/cash-flow/dashboard-kpis'
import { diffDaysFromToday, shiftDateString } from '@/lib/cash-flow/dates'
import { toLocalDateParam } from '@/lib/integrations/date'
import { formatBRL } from '@/lib/format/currency'
import { formatDateOnlyBR } from '@/lib/format/date'
import { CashCurveChart } from '@/components/cash-flow/cash-curve-chart'
import { BalanceForm } from '@/components/cash-flow/balance-form'
import { ManualEntryForm } from '@/components/cash-flow/manual-entry-form'
import Image from 'next/image'

function MetricCard({
  label,
  value,
  accentColor = '#082d74',
  footnote,
}: {
  label: string
  value: string
  accentColor?: string
  footnote?: string
}) {
  return (
    <div
      className="rounded-sm border bg-white p-6 transition-shadow duration-200 hover:shadow-md"
      style={{ borderColor: '#e3ded0', borderWidth: '1px' }}
    >
      <p
        className="text-xs font-medium uppercase tracking-widest mb-4"
        style={{ color: '#8a8579', fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em' }}
      >
        {label}
      </p>
      <p
        className="text-4xl font-light mb-2 tabular-nums"
        style={{ color: accentColor, fontFamily: '"Playfair Display", serif' }}
      >
        {value}
      </p>
      {footnote && (
        <p className="text-xs" style={{ color: '#8a8579', fontFamily: '"Jost", sans-serif' }}>
          {footnote}
        </p>
      )}
    </div>
  )
}

export default async function VisaoGeralPage() {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver a visão geral.</p>
  }

  const today = toLocalDateParam(new Date())
  const from = shiftDateString(today, -90)
  const to = shiftDateString(today, 90)

  const entries = await loadCanonicalCashFlow(member.orgId)
  const days = await buildCashFlowDays(member.orgId, from, to, entries)

  // Independently anchored at "today" (not `from`, which is 90 days in the
  // past) so a snapshot recorded today is picked up immediately, and built
  // purely from resolveOpeningBalance's realizado-only accounting — never
  // the day array's blended saldoInicial, which includes unrealized
  // (contratado) AR/AP and would misrepresent an unconfirmed projection as
  // today's actual balance.
  const currentBalance = await resolveOpeningBalance(member.orgId, shiftDateString(today, 1), entries)
  const saldoAtual = currentBalance?.balance ?? null
  const saldoAtualAsOf = currentBalance?.asOf ?? null

  const kpis = calculateDashboardKpis(days, today, saldoAtual)

  const minimum = getMinimumProjectedBalance(days.filter((d) => d.date >= today))

  return (
    <div style={{ backgroundColor: '#eae7de' }} className="min-h-screen">
      {/* Header com Logo */}
      <div
        style={{
          backgroundColor: '#403b38',
          borderBottom: '1px solid #3a3530',
          color: '#efece3',
        }}
        className="sticky top-0 z-50 backdrop-blur-sm"
      >
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Image
                src="/logo2.jpg"
                alt="WEE"
                width={40}
                height={40}
                style={{
                  objectFit: 'contain',
                }}
              />
            </div>
            <div>
              <div style={{ fontFamily: '"Playfair Display", serif', fontSize: '18px', fontWeight: 400 }}>
                WEE Cash Flow
              </div>
              <div
                style={{
                  fontFamily: '"Space Mono", monospace',
                  fontSize: '10px',
                  letterSpacing: '0.1em',
                  color: '#a39d8d',
                  textTransform: 'uppercase',
                }}
              >
                Visão Geral
              </div>
            </div>
          </div>
          <div style={{ fontFamily: '"Space Mono", monospace', fontSize: '11px', letterSpacing: '0.08em' }}>
            {new Date().toLocaleDateString('pt-BR')}
          </div>
        </div>
      </div>

      <div className="space-y-12 px-6 py-12">
        <div className="max-w-7xl mx-auto">
          {/* Hero Section */}
          <div className="mb-16 text-center max-w-2xl mx-auto">
            <p
              style={{
                fontFamily: '"Space Mono", monospace',
                fontSize: '12px',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: '#8a8579',
                marginBottom: '12px',
              }}
            >
              Controle Financeiro
            </p>
            <h1
              style={{
                fontFamily: '"Playfair Display", serif',
                fontSize: '52px',
                fontWeight: 300,
                color: '#1c1a17',
                margin: '0 0 8px',
                letterSpacing: '-0.02em',
              }}
            >
              Visão Geral do Caixa
            </h1>
            <p style={{ color: '#57534b', fontSize: '15px', lineHeight: 1.6 }}>
              Acompanhe seu fluxo de caixa em tempo real com projeções precisas
            </p>
          </div>

          {/* KPI Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            <MetricCard
              label="Saldo Atual"
              value={kpis.saldoAtual != null ? formatBRL(kpis.saldoAtual) : '—'}
              accentColor="#082d74"
              footnote={
                saldoAtualAsOf && saldoAtualAsOf !== today
                  ? `há ${diffDaysFromToday(today, saldoAtualAsOf)} dia(s)`
                  : 'Hoje'
              }
            />
            <MetricCard
              label="Entradas (30 dias)"
              value={formatBRL(kpis.entradas30)}
              accentColor="#1c6e3c"
              footnote="Próximos 30 dias"
            />
            <MetricCard
              label="Saídas (30 dias)"
              value={formatBRL(kpis.saidas30)}
              accentColor="#c2341e"
              footnote="Próximos 30 dias"
            />
            <MetricCard
              label="Saldo em 30 dias"
              value={kpis.saldoEm30 != null ? formatBRL(kpis.saldoEm30) : '—'}
              accentColor="#846340"
              footnote="Projetado"
            />
          </div>

          {/* Alert Section */}
          {minimum && minimum.balance < 0 && (
            <div
              className="rounded-sm border p-6 mb-12"
              style={{
                backgroundColor: '#fdf5f2',
                borderColor: '#d9b3a8',
                borderWidth: '1px',
              }}
            >
              <div className="flex gap-4">
                <div style={{ fontSize: '20px', flexShrink: 0 }}>⚠️</div>
                <div>
                  <h3 style={{ color: '#c2341e', marginBottom: '4px', fontWeight: 600 }}>
                    Alerta: Saldo Negativo
                  </h3>
                  <p
                    style={{
                      color: '#6b3d30',
                      fontSize: '14px',
                      lineHeight: 1.6,
                      fontFamily: '"Jost", sans-serif',
                    }}
                  >
                    Seu saldo será negativo em <strong>{formatDateOnlyBR(minimum.date)}</strong> chegando a{' '}
                    <strong>{formatBRL(minimum.balance)}</strong>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Chart Section */}
          <div
            className="rounded-sm border p-8 mb-12"
            style={{ backgroundColor: '#faf8f1', borderColor: '#e3ded0', borderWidth: '1px' }}
          >
            <h2
              style={{
                fontFamily: '"Playfair Display", serif',
                fontSize: '32px',
                fontWeight: 300,
                color: '#1c1a17',
                marginBottom: '4px',
              }}
            >
              Curva de Caixa
            </h2>
            <p style={{ color: '#57534b', marginBottom: '24px', fontSize: '14px' }}>
              Projeção do saldo nos próximos 180 dias
            </p>
            <div className="h-96 w-full">
              <CashCurveChart days={days} />
            </div>
          </div>

          {/* Forms Section */}
          {canManageCashBalance(member.role) && (
            <div className="space-y-8">
              <h2
                style={{
                  fontFamily: '"Playfair Display", serif',
                  fontSize: '32px',
                  fontWeight: 300,
                  color: '#1c1a17',
                  marginBottom: '24px',
                }}
              >
                Administração
              </h2>
              <div className="grid gap-8 lg:grid-cols-2">
                <div className="rounded-sm border p-8" style={{ backgroundColor: '#faf8f1', borderColor: '#e3ded0' }}>
                  <BalanceForm />
                </div>
                <div className="rounded-sm border p-8" style={{ backgroundColor: '#faf8f1', borderColor: '#e3ded0' }}>
                  <ManualEntryForm />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        className="border-t py-8 mt-16"
        style={{
          backgroundColor: '#403b38',
          borderTopColor: '#3a3530',
          color: '#efece3',
          textAlign: 'center',
        }}
      >
        <p
          style={{
            fontFamily: '"Space Mono", monospace',
            fontSize: '10px',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#a39d8d',
          }}
        >
          WEE Cash Flow & Business Intelligence Platform
        </p>
      </div>
    </div>
  )
}
