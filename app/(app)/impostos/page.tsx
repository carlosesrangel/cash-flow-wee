'use client'

import { useState } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatBRL } from '@/lib/format/currency'

const TAX_REGIMES = [
  {
    id: 'simples',
    name: 'Simples Nacional',
    description: 'Regime para pequenas empresas com receita até R$ 4,8 mi',
    rate: '6-33%',
    advantages: ['Cálculo simplificado', 'Alíquota única', 'Menos documentação'],
    suitable: true,
  },
  {
    id: 'presumido',
    name: 'Lucro Presumido',
    description: 'Regime para empresas com receita até R$ 78 mi',
    rate: '15%',
    advantages: ['Base de cálculo simplificada', 'Sem escrituração completa'],
    suitable: false,
  },
  {
    id: 'real',
    name: 'Lucro Real',
    description: 'Regime obrigatório para grandes empresas',
    rate: '25%',
    advantages: ['Deduz despesas reais', 'Ideal para empresas maiores'],
    suitable: false,
  },
]

const MONTHLY_TAXES = [
  { month: 'Agosto', irpj: 1200, csll: 400, pis: 300, cofins: 1500 },
  { month: 'Setembro', irpj: 1350, csll: 450, pis: 320, cofins: 1650 },
  { month: 'Outubro', irpj: 1100, csll: 380, pis: 280, cofins: 1450 },
]

export default function ImpostosPage() {
  const [selectedRegime, setSelectedRegime] = useState('simples')

  const totalMonthly = MONTHLY_TAXES.reduce(
    (sum, t) => sum + t.irpj + t.csll + t.pis + t.cofins,
    0
  )
  const averageMonthly = totalMonthly / MONTHLY_TAXES.length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Impostos"
        subtitle="Gestão tributária"
        description="Configure seu regime tributário e acompanhe obrigações fiscais"
      />

      {/* Regime Atual */}
      <div className="grid gap-6 lg:grid-cols-3">
        {TAX_REGIMES.map((regime) => (
          <Card
            key={regime.id}
            className={`cursor-pointer transition-all ${
              selectedRegime === regime.id ? 'ring-2 ring-primary' : ''
            }`}
            onClick={() => setSelectedRegime(regime.id)}
          >
            <CardContent className="pt-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-foreground">{regime.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{regime.description}</p>
                </div>
                {regime.suitable && (
                  <Badge className="shrink-0 bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-200">
                    Recomendado
                  </Badge>
                )}
              </div>
              <div className="text-2xl font-bold text-primary mb-4">{regime.rate}</div>
              <div className="space-y-2">
                {regime.advantages.map((adv, idx) => (
                  <div key={idx} className="text-xs flex items-center gap-2">
                    <span className="text-green-600">✓</span>
                    <span className="text-muted-foreground">{adv}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Resumo de Impostos */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Imposto Mensal Médio</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-primary mb-2">
              {formatBRL(averageMonthly)}
            </div>
            <p className="text-sm text-muted-foreground">
              Baseado nos últimos 3 meses
            </p>
            <div className="mt-6 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">IRPJ</span>
                <span className="font-mono font-semibold">
                  {formatBRL(MONTHLY_TAXES.reduce((s, t) => s + t.irpj, 0) / MONTHLY_TAXES.length)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">CSLL</span>
                <span className="font-mono font-semibold">
                  {formatBRL(MONTHLY_TAXES.reduce((s, t) => s + t.csll, 0) / MONTHLY_TAXES.length)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Próximas Obrigações</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { date: '20/11/2026', type: 'Simples Nacional', status: 'Pendente' },
                { date: '30/11/2026', type: 'DCTF', status: 'Pendente' },
                { date: '15/12/2026', type: 'Imposto de Renda', status: 'Pendente' },
              ].map((item, idx) => (
                <div key={idx} className="flex items-center justify-between pb-3 border-b last:border-0">
                  <div>
                    <p className="font-medium text-foreground">{item.type}</p>
                    <p className="text-xs text-muted-foreground">{item.date}</p>
                  </div>
                  <Badge variant="outline" className="text-yellow-700">
                    {item.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Histórico de Impostos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Histórico de Impostos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Período</th>
                  <th className="px-4 py-3 text-right font-medium">IRPJ</th>
                  <th className="px-4 py-3 text-right font-medium">CSLL</th>
                  <th className="px-4 py-3 text-right font-medium">PIS</th>
                  <th className="px-4 py-3 text-right font-medium">COFINS</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {MONTHLY_TAXES.map((tax) => (
                  <tr key={tax.month} className="border-b hover:bg-muted/50">
                    <td className="px-4 py-3 font-medium">{tax.month}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatBRL(tax.irpj)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatBRL(tax.csll)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatBRL(tax.pis)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatBRL(tax.cofins)}</td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {formatBRL(tax.irpj + tax.csll + tax.pis + tax.cofins)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
