#!/usr/bin/env node
/** Import the supplied workbook into the one canonical monthly_sales_plan table. */
import 'dotenv/config'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'

const filePath = resolve(process.argv[2] ?? 'planejado wee.xlsx')
const orgId = process.argv[3] ?? process.env.WEE_ORG_ID
if (!existsSync(filePath)) throw new Error(`Arquivo não encontrado: ${filePath}. O importador não cria valores sem a planilha factual.`)
if (!orgId) throw new Error('Informe o org_id como segundo argumento ou WEE_ORG_ID')

const workbook = XLSX.readFile(filePath, { cellDates: true })
const sheetName = workbook.SheetNames[0]
const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: null })

function value(row: Record<string, unknown>, names: string[]) {
  const key = Object.keys(row).find((candidate) => names.includes(candidate.trim().toLowerCase()))
  return key ? row[key] : null
}
function normalizeMonth(raw: unknown): string | null {
  if (raw instanceof Date) return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}-01`
  const text = String(raw ?? '').trim()
  const match = text.match(/^(\d{4})[-/]?(\d{1,2})/) || text.match(/^(\d{1,2})[-/](\d{4})$/)
  if (!match) return null
  const year = match[1].length === 4 ? Number(match[1]) : Number(match[2])
  const month = match[1].length === 4 ? Number(match[2]) : Number(match[1])
  return `${year}-${String(month).padStart(2, '0')}-01`
}
function normalizeAmount(raw: unknown): number {
  if (typeof raw === 'number') return Math.round(raw * 100) / 100
  const text = String(raw ?? '').replace(/R\$\s?/i, '').replace(/\./g, '').replace(',', '.').trim()
  const parsed = Number(text)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Valor inválido: ${String(raw)}`)
  return Math.round(parsed * 100) / 100
}

async function main() {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  const parsed = rows.map((row, index) => {
    const competenceMonth = normalizeMonth(value(row, ['competência', 'competencia', 'mês', 'mes', 'month']))
    if (!competenceMonth) throw new Error(`Linha ${index + 2}: competência não reconhecida`)
    return { org_id: orgId, competence_month: competenceMonth, amount: normalizeAmount(value(row, ['valor', 'planejado', 'receita', 'amount'])), source_file: filePath.split('\\').pop() ?? filePath, source_sheet: sheetName, source_row: index + 2 }
  })
  if (new Set(parsed.map((row) => row.competence_month)).size !== parsed.length) throw new Error('A planilha contém competências duplicadas')
  const client = createAdminSupabaseClient()
  const { error } = await client.from('monthly_sales_plan').upsert(parsed, { onConflict: 'org_id,competence_month' })
  if (error) throw error
  console.log(`PLANNING_IMPORTED=${parsed.length}`)
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
