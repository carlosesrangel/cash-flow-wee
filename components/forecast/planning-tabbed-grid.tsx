'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatBRL } from '@/lib/format/currency'
import type { MonthlyValue } from '@/lib/forecast/scenarios'

const MONTH_LABEL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

interface SalesMixRow {
  modalidade: string
  percentual: number
  parcelas_media: number
  taxa_cartao: number
  dias_recebimento: number
}

interface CMVProjectionRow {
  ano_gasto: number
  mes_gasto: number
  semana: string
  valor_cmv: number
  trimestre_origem: string
}

interface ProjectedARRow {
  data_vencimento: string
  valor_total: number
  modalidades: number
  parcelas_max: number
}

function monthKey(ano: number, mes: number): string {
  return `${ano}-${mes}`
}

export function PlanningTabbedGrid({
  versionId,
  entries,
  canEdit,
  salesMix,
  cmvProjections,
  projectedAR,
}: {
  versionId: string
  entries: MonthlyValue[]
  canEdit: boolean
  salesMix?: SalesMixRow[]
  cmvProjections?: CMVProjectionRow[]
  projectedAR?: ProjectedARRow[]
}) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'metas' | 'mix' | 'cmv' | 'ar'>('metas')
  const [values, setValues] = useState(() => {
    const map = new Map<string, number>()
    for (const entry of entries) map.set(monthKey(entry.ano, entry.mes), entry.value)
    return map
  })
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const years = Array.from(new Set(entries.map((e) => e.ano))).sort((a, b) => a - b)

  async function handleBlur(ano: number, mes: number, raw: string) {
    const receita = Number(raw)
    if (Number.isNaN(receita)) return
    const key = monthKey(ano, mes)
    if (values.get(key) === receita) return

    setPendingKey(key)
    setError(null)
    try {
      const response = await fetch('/api/forecast/entradas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId, ano, mes, receita }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao salvar')
      } else {
        setValues((prev) => new Map(prev).set(key, receita))
        router.refresh()
      }
    } catch {
      setError('Falha ao salvar')
    } finally {
      setPendingKey(null)
    }
  }

  const tabClasses =
    'px-4 py-2 text-sm font-medium border-b-2 cursor-pointer transition-colors'
  const activeTabClasses = 'border-blue-500 text-blue-600 bg-blue-50'
  const inactiveTabClasses = 'border-transparent text-neutral-600 hover:text-neutral-900 hover:border-neutral-300'

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <div className="border-b bg-white">
        <div className="flex gap-0">
          <button
            onClick={() => setActiveTab('metas')}
            className={`${tabClasses} ${activeTab === 'metas' ? activeTabClasses : inactiveTabClasses}`}
          >
            📊 Metas
          </button>
          <button
            onClick={() => setActiveTab('mix')}
            className={`${tabClasses} ${activeTab === 'mix' ? activeTabClasses : inactiveTabClasses}`}
          >
            💳 Mix de Vendas
          </button>
          <button
            onClick={() => setActiveTab('cmv')}
            className={`${tabClasses} ${activeTab === 'cmv' ? activeTabClasses : inactiveTabClasses}`}
          >
            📦 CMV
          </button>
          <button
            onClick={() => setActiveTab('ar')}
            className={`${tabClasses} ${activeTab === 'ar' ? activeTabClasses : inactiveTabClasses}`}
          >
            🏦 A.R. Projetado
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div className="rounded-lg border bg-white p-4">
        {/* Metas Tab */}
        {activeTab === 'metas' && (
          <div className="space-y-2">
            <p className="text-sm text-neutral-600">
              Edite as metas de receita mensal para cada ano. Os valores serão usados para projetar o mix de vendas, CMV e contas a receber.
            </p>
            {years.length === 0 ? (
              <p className="text-sm text-neutral-500">Nenhum mês planejado ainda nesta versão.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-neutral-50 text-neutral-600">
                    <tr>
                      <th className="px-3 py-2 font-medium">Ano</th>
                      {MONTH_LABEL.map((label) => (
                        <th key={label} className="px-3 py-2 text-right font-medium">
                          {label}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {years.map((ano) => {
                      const rowValues = MONTH_LABEL.map((_, i) => values.get(monthKey(ano, i + 1)))
                      const total = rowValues.reduce((sum: number, v) => sum + (v ?? 0), 0)
                      return (
                        <tr key={ano} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium">{ano}</td>
                          {rowValues.map((value, i) => {
                            const mes = i + 1
                            const key = monthKey(ano, mes)
                            if (value === undefined) {
                              return (
                                <td key={key} className="px-3 py-2 text-right text-neutral-300">
                                  —
                                </td>
                              )
                            }
                            return (
                              <td key={key} className="px-2 py-1 text-right">
                                {canEdit ? (
                                  <input
                                    aria-label={`${MONTH_LABEL[i]} ${ano}`}
                                    type="number"
                                    step="0.01"
                                    defaultValue={value}
                                    disabled={pendingKey === key}
                                    onBlur={(e) => handleBlur(ano, mes, e.target.value)}
                                    className="w-24 rounded border px-1 py-1 text-right text-sm"
                                  />
                                ) : (
                                  formatBRL(value)
                                )}
                              </td>
                            )
                          })}
                          <td className="px-3 py-2 text-right font-medium">{formatBRL(total)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Mix de Vendas Tab */}
        {activeTab === 'mix' && (
          <div className="space-y-2">
            <p className="text-sm text-neutral-600">
              Distribuição de modalidades de pagamento usada para projetar contas a receber.
            </p>
            {!salesMix || salesMix.length === 0 ? (
              <p className="text-sm text-neutral-500">Nenhum mix de vendas configurado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-neutral-50 text-neutral-600">
                    <tr>
                      <th className="px-3 py-2 font-medium">Modalidade</th>
                      <th className="px-3 py-2 text-right font-medium">%</th>
                      <th className="px-3 py-2 text-right font-medium">Parcelas</th>
                      <th className="px-3 py-2 text-right font-medium">Taxa Cartão</th>
                      <th className="px-3 py-2 text-right font-medium">Dias Recebimento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesMix.map((row) => (
                      <tr key={row.modalidade} className="border-b last:border-0">
                        <td className="px-3 py-2 font-medium capitalize">{row.modalidade}</td>
                        <td className="px-3 py-2 text-right">{row.percentual.toFixed(1)}%</td>
                        <td className="px-3 py-2 text-right">{row.parcelas_media.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right">{(row.taxa_cartao * 100).toFixed(2)}%</td>
                        <td className="px-3 py-2 text-right">{row.dias_recebimento}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* CMV Tab */}
        {activeTab === 'cmv' && (
          <div className="space-y-2">
            <p className="text-sm text-neutral-600">
              CMV com defasagem trimestral (Q2 budget gasto em Q1, distribuído bi-semanalmente).
            </p>
            {!cmvProjections || cmvProjections.length === 0 ? (
              <p className="text-sm text-neutral-500">Nenhuma projeção de CMV configurada.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-neutral-50 text-neutral-600">
                    <tr>
                      <th className="px-3 py-2 font-medium">Data Gasto</th>
                      <th className="px-3 py-2 font-medium">Trimestre Origem</th>
                      <th className="px-3 py-2 font-medium">Semana</th>
                      <th className="px-3 py-2 text-right font-medium">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cmvProjections
                      .slice(0, 50)
                      .map((row, idx) => (
                        <tr key={idx} className="border-b last:border-0">
                          <td className="px-3 py-2">
                            {row.mes_gasto}/{row.ano_gasto}
                          </td>
                          <td className="px-3 py-2">{row.trimestre_origem}</td>
                          <td className="px-3 py-2">{row.semana}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatBRL(row.valor_cmv)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {cmvProjections.length > 50 && (
                  <p className="mt-2 text-xs text-neutral-500">... e mais {cmvProjections.length - 50} entradas</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* A.R. Projetado Tab */}
        {activeTab === 'ar' && (
          <div className="space-y-2">
            <p className="text-sm text-neutral-600">
              Contas a receber projetadas com base nas metas e mix de vendas.
            </p>
            {!projectedAR || projectedAR.length === 0 ? (
              <p className="text-sm text-neutral-500">Nenhuma AR projetada configurada.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-neutral-50 text-neutral-600">
                    <tr>
                      <th className="px-3 py-2 font-medium">Data Vencimento</th>
                      <th className="px-3 py-2 text-right font-medium">Valor Total</th>
                      <th className="px-3 py-2 text-right font-medium">Modalidades</th>
                      <th className="px-3 py-2 text-right font-medium">Parcelas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectedAR
                      .slice(0, 50)
                      .map((row, idx) => (
                        <tr key={idx} className="border-b last:border-0">
                          <td className="px-3 py-2">{row.data_vencimento}</td>
                          <td className="px-3 py-2 text-right font-mono font-semibold">
                            {formatBRL(row.valor_total)}
                          </td>
                          <td className="px-3 py-2 text-right">{row.modalidades}</td>
                          <td className="px-3 py-2 text-right">{row.parcelas_max}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {projectedAR.length > 50 && (
                  <p className="mt-2 text-xs text-neutral-500">... e mais {projectedAR.length - 50} entradas</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
