#!/usr/bin/env node
/**
 * Populate planning data for Jun-Aug 2026 with specific values
 *
 * JUNHO 2026: 11216.67 total, 1598.33 realized, 9618.34 pending
 * JULHO 2026: 15584.01 total, 3240.00 realized, 12344.01 pending
 * AGOSTO 2026: 12164.00 total, 1720.00 realized, 10444.00 pending
 */
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(supabaseUrl, supabaseKey)

const ORG_ID = '30805a10-b85f-4ac0-bd1a-899f93678725'

async function main() {
  console.log('📊 Seeding planning data for Jun-Aug 2026\n')

  // Check if version already exists
  const { data: existing } = await admin
    .from('forecast_versions')
    .select('id')
    .eq('org_id', ORG_ID)
    .eq('name', 'Planejamento 2026 Jun-Aug')
    .limit(1)

  let versionId: string

  if (existing && existing.length > 0) {
    versionId = existing[0].id
    console.log(`ℹ️  Using existing version: ${versionId}`)

    // Delete old entries
    await admin
      .from('forecast_entries')
      .delete()
      .eq('version_id', versionId)
    console.log('🗑️  Cleared old entries')
  } else {
    const { data: version, error: versionError } = await admin
      .from('forecast_versions')
      .insert({ org_id: ORG_ID, name: 'Planejamento 2026 Jun-Aug' })
      .select('id')
      .single()

    if (versionError) throw new Error(`forecast_versions: ${versionError.message}`)
    versionId = version.id
    console.log(`✅ Created forecast_versions: ${versionId}`)
  }

  // Insert Jun-Aug data
  const entries = [
    { ano: 2026, mes: 6, receita: 11216.67 },   // June
    { ano: 2026, mes: 7, receita: 15584.01 },   // July
    { ano: 2026, mes: 8, receita: 12164.00 },   // August
  ]

  const { error: entriesError } = await admin
    .from('forecast_entries')
    .insert(
      entries.map((e) => ({
        version_id: versionId,
        ...e,
      }))
    )

  if (entriesError) throw new Error(`forecast_entries: ${entriesError.message}`)
  console.log(`✅ Inserted ${entries.length} planning entries (Jun-Aug 2026)`)

  // Verify
  const { data: verify } = await admin
    .from('forecast_entries')
    .select('ano, mes, receita')
    .eq('version_id', versionId)
    .order('mes', { ascending: true })

  console.log('\n📋 Inserted data:')
  verify?.forEach((e) => {
    console.log(`  ${e.ano}/${String(e.mes).padStart(2, '0')}: R$ ${(e.receita as number).toFixed(2)}`)
  })

  console.log('\n✅ Planning data seeded successfully!')
  console.log(`✅ Access at: /planejamento?versao=${versionId}`)
}

main().catch((err) => {
  console.error('❌ Error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
