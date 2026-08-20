#!/usr/bin/env node
/**
 * Debug script para diagnosticar problemas de sincronização OLIST
 * Uso: npx ts-node scripts/debug-olist-sync.ts
 */

import 'dotenv/config'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

async function debugOlistSync() {
  console.log('🔍 === Debug OLIST Sync ===\n')

  try {
    const admin = createAdminSupabaseClient()

    // 1. Verificar conexão Supabase
    console.log('1️⃣ Verificando conexão Supabase...')
    try {
      const { data: orgs, error } = await admin.from('organizations').select('id').limit(1)
      if (error) throw error
      console.log('   ✅ Supabase conectado\n')
    } catch (err) {
      console.error('   ❌ Erro ao conectar Supabase:')
      console.error('   ', err instanceof Error ? err.message : err)
      return
    }

    // 2. Listar organizações com OLIST conectada
    console.log('2️⃣ Organizações com OLIST conectada...')
    const { data: connections, error: connError } = await admin
      .from('integration_connections')
      .select('org_id, status, expires_at, updated_at')
      .eq('provider', 'olist')

    if (connError) {
      console.error('   ❌ Erro:', connError.message)
      return
    }

    if (!connections || connections.length === 0) {
      console.log('   ⚠️  Nenhuma organização com OLIST conectada')
      return
    }

    console.log(`   ✅ Encontradas ${connections.length} organização(ões)\n`)

    for (const conn of connections) {
      console.log(`   📌 Org ID: ${conn.org_id}`)
      console.log(`      Status: ${conn.status}`)
      console.log(`      Token expires: ${conn.expires_at}`)

      const expiresAt = new Date(conn.expires_at as string)
      const now = new Date()
      if (expiresAt < now) {
        console.log('      ⚠️  ⚠️  TOKEN EXPIRADO! Precisa reconectar OLIST')
      } else {
        const hoursLeft = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)
        console.log(`      ✅ Token válido por ${Math.round(hoursLeft)} horas`)
      }
      console.log()
    }

    // 3. Verificar últimos syncs
    console.log('3️⃣ Últimos syncs...')
    const { data: syncs, error: syncError } = await admin
      .from('sync_runs')
      .select('org_id, status, started_at, completed_at, error_message')
      .eq('integration', 'olist')
      .order('started_at', { ascending: false })
      .limit(5)

    if (syncError) {
      console.error('   ❌ Erro:', syncError.message)
      return
    }

    if (!syncs || syncs.length === 0) {
      console.log('   ℹ️  Nenhum sync anterior encontrado\n')
    } else {
      for (const sync of syncs) {
        const icon = sync.status === 'success' ? '✅' : sync.status === 'running' ? '⏳' : '❌'
        console.log(`   ${icon} ${sync.org_id.substring(0, 8)}... [${sync.status}]`)
        console.log(`      Iniciado: ${sync.started_at}`)
        if (sync.completed_at) console.log(`      Concluído: ${sync.completed_at}`)
        if (sync.error_message) {
          console.log(`      ❌ Erro: ${sync.error_message}`)
        }
      }
      console.log()
    }

    // 4. Verificar variáveis de ambiente
    console.log('4️⃣ Variáveis de ambiente...')
    const envVars = [
      'OLIST_CLIENT_ID',
      'OLIST_CLIENT_SECRET',
      'OLIST_REDIRECT_URI',
      'OLIST_STATE_SECRET',
      'SUPABASE_SERVICE_ROLE_KEY'
    ]

    for (const varName of envVars) {
      const value = process.env[varName]
      if (!value) {
        console.log(`   ❌ ${varName}: NÃO DEFINIDA`)
      } else if (varName.includes('SECRET') || varName.includes('KEY') || varName.includes('TOKEN')) {
        console.log(`   ✅ ${varName}: ${value.substring(0, 20)}...`)
      } else {
        console.log(`   ✅ ${varName}: ${value}`)
      }
    }
    console.log()

    // 5. Contar registros importados
    console.log('5️⃣ Registros importados...')
    try {
      const firstOrg = connections[0]?.org_id

      if (firstOrg) {
        const { count: contactsCount } = await admin
          .from('olist_contacts')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', firstOrg)

        const { count: ordersCount } = await admin
          .from('olist_orders')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', firstOrg)

        const { count: sellersCount } = await admin
          .from('olist_sellers')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', firstOrg)

        console.log(`   📊 (para org ${firstOrg.substring(0, 8)}...)`)
        console.log(`      Contatos: ${contactsCount || 0}`)
        console.log(`      Pedidos: ${ordersCount || 0}`)
        console.log(`      Vendedores: ${sellersCount || 0}`)
      }
    } catch (err) {
      console.log('   ⚠️  Não foi possível contar registros')
    }
    console.log()

    console.log('✅ === Debug Completo ===')
  } catch (err) {
    console.error('❌ Erro fatal:', err instanceof Error ? err.message : err)
  }
}

debugOlistSync().catch(console.error)
