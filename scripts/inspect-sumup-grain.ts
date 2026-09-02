import 'dotenv/config'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/reconciliation/run'
const orgId = process.argv[2]!
async function main() {
  const admin = createAdminSupabaseClient()
  const rows = await fetchAllPages<any>((from,to)=>admin.from('sumup_transaction_events').select('id,transaction_id,event_type,status,due_date,event_date,installment_number,sumup_transactions(amount,payment_type,installments_count,status,timestamp_utc)').eq('org_id',orgId).range(from,to),'rows')
  const count = (fn:(r:any)=>boolean) => rows.filter(fn).length
  const key = (r:any) => `${r.event_type}|${r.status}|${r.sumup_transactions?.payment_type}|${r.sumup_transactions?.status}`
  const by = new Map<string,number>()
  for (const r of rows) by.set(key(r),(by.get(key(r))??0)+1)
  const transactions = new Map<string, any>()
  for (const r of rows) if (r.sumup_transactions?.id) transactions.set(r.sumup_transactions.id, r.sumup_transactions)
  const sample = rows.slice(0,1).map(r=>({id:r.id,transaction_id:r.transaction_id,event_type:r.event_type,status:r.status,tx:r.sumup_transactions}))
  console.log(JSON.stringify({total:rows.length, uniqueTransactions:new Set(rows.map(r=>r.transaction_id)).size, by:[...by.entries()].sort((a,b)=>b[1]-a[1]), payoutSuccess:rows.filter(r=>r.event_type==='PAYOUT' && ['SUCCESSFUL','SUCCESS','RECONCILED','SETTLED','PAID_OUT','SCHEDULED','PENDING'].includes(String(r.sumup_transactions?.status||r.status).toUpperCase())).length, payoutEventTypes:[...new Set(rows.map(r=>r.event_type))], transactionsByPaymentType:[...transactions.values()].reduce((m,r)=>{m[r.payment_type]=(m[r.payment_type]??0)+1;return m},{}), transactionsByStatus:[...transactions.values()].reduce((m,r)=>{m[r.status]=(m[r.status]??0)+1;return m},{}),sample},null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1})
