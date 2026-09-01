-- Migration 0024: Analytical Table Refresh Functions
-- Purpose: Populate fee_rates_12m, seasonality_3bands_12m, receipt_profile_12m
-- These are idempotent functions that recalculate from raw source tables

-- ============================================================
-- 1. REFRESH sumup_fee_rates_12m (Taxas_12M)
-- ============================================================
-- Calculate 12-month historical fee rates by modality
-- Data source: sumup_transactions (last 12 months)

create or replace function refresh_sumup_fee_rates_12m(target_org_id uuid)
returns table(
  rows_inserted integer,
  rows_updated integer,
  rows_deleted integer,
  calculated_at timestamptz,
  calculation_version text
)
language plpgsql
as $$
declare
  v_rows_ins integer := 0;
  v_rows_upd integer := 0;
  v_rows_del integer := 0;
  v_window_start date;
  v_window_end date;
begin
  -- Define 12-month window
  v_window_end := (now() at time zone 'America/Sao_Paulo')::date;
  v_window_start := v_window_end - interval '365 days';

  -- Delete old data for this org (idempotent)
  delete from sumup_fee_rates_12m where org_id = target_org_id;
  get diagnostics v_rows_del = row_count;

  -- Insert fresh calculations
  insert into sumup_fee_rates_12m (
    org_id,
    payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan,
    qtd_transacoes_12m, valor_bruto_12m, qtd_com_fee, valor_base_taxa_12m, fee_total_12m,
    taxa_media_simples, taxa_media_ponderada, pct_valor_12m, pct_transacoes_12m,
    confiabilidade,
    inicio_janela, fim_janela,
    calculado_em, versao
  )
  select
    target_org_id,
    payment_type, coalesce(card_type, 'UNKNOWN') as card_type, installments_count, coalesce(entry_mode, 'UNKNOWN') as entry_mode, coalesce(payout_plan, 'UNKNOWN') as payout_plan,
    count(distinct id) as qtd_transacoes_12m,
    sum(amount) as valor_bruto_12m,
    count(distinct case when fee_amount > 0 then id end) as qtd_com_fee,
    sum(case when fee_amount > 0 then amount else 0 end) as valor_base_taxa_12m,
    coalesce(sum(fee_amount), 0) as fee_total_12m,
    case when sum(case when fee_amount > 0 then amount else 0 end) > 0
      then coalesce(sum(fee_amount), 0) / sum(case when fee_amount > 0 then amount else 0 end)
      else 0
    end as taxa_media_simples,
    case when sum(amount) > 0
      then coalesce(sum(fee_amount), 0) / sum(amount)
      else 0
    end as taxa_media_ponderada,
    null::numeric as pct_valor_12m,  -- Will be updated in second pass
    null::numeric as pct_transacoes_12m,  -- Will be updated in second pass
    case
      when count(distinct id) >= 30 then 'ALTA'
      when count(distinct id) >= 10 then 'MEDIA'
      else 'BAIXA'
    end as confiabilidade,
    v_window_start, v_window_end,
    now(), 'FINANCIAL_MODEL_V2_EXCEL_PARITY'
  from sumup_transactions
  where org_id = target_org_id
    and timestamp_utc >= v_window_start::timestamp
    and timestamp_utc < (v_window_end + 1)::timestamp
  group by payment_type, card_type, installments_count, entry_mode, payout_plan
  on conflict (org_id, payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan)
  do update set
    qtd_transacoes_12m = excluded.qtd_transacoes_12m,
    valor_bruto_12m = excluded.valor_bruto_12m,
    taxa_media_ponderada = excluded.taxa_media_ponderada,
    confiabilidade = excluded.confiabilidade,
    atualizado_em = now();

  get diagnostics v_rows_ins = row_count;

  -- Update percentage columns in second pass
  update sumup_fee_rates_12m
  set
    pct_valor_12m = valor_bruto_12m / (select sum(valor_bruto_12m) from sumup_fee_rates_12m where org_id = target_org_id),
    pct_transacoes_12m = qtd_transacoes_12m / (select sum(qtd_transacoes_12m) from sumup_fee_rates_12m where org_id = target_org_id)
  where org_id = target_org_id;

  return query select v_rows_ins::integer, v_rows_upd::integer, v_rows_del::integer, now(), 'FINANCIAL_MODEL_V2_EXCEL_PARITY'::text;
end;
$$;

-- ============================================================
-- 2. REFRESH sumup_seasonality_3bands_12m (Sazonalidade_3Faixas)
-- ============================================================
-- Calculate 3-band intra-month seasonality from last 12 months
-- Reference month: M-12 (12 months ago from today)

create or replace function refresh_sumup_seasonality_3bands_12m(target_org_id uuid)
returns table(
  rows_inserted integer,
  rows_updated integer,
  rows_deleted integer,
  calculated_at timestamptz,
  calculation_version text
)
language plpgsql
as $$
declare
  v_rows_ins integer := 0;
  v_rows_upd integer := 0;
  v_rows_del integer := 0;
  v_ref_year integer;
  v_ref_month integer;
begin
  -- Use 12-month historical reference (same month previous year)
  v_ref_year := extract(year from (now() at time zone 'America/Sao_Paulo')::date - interval '365 days');
  v_ref_month := extract(month from (now() at time zone 'America/Sao_Paulo')::date - interval '365 days');

  -- Delete old data for this org
  delete from sumup_seasonality_3bands_12m where org_id = target_org_id;
  get diagnostics v_rows_del = row_count;

  -- Insert fresh calculations for all months in last 12 months (3 bands each)
  insert into sumup_seasonality_3bands_12m (
    org_id, ano_historico, mes_historico, faixa,
    receita_historica_faixa, receita_historica_mes,
    peso_faixa, dia_referencia,
    inicio_janela, fim_janela,
    calculado_em, versao
  )
  with monthly_data as (
    select
      extract(year from timestamp_utc at time zone 'America/Sao_Paulo') as txn_year,
      extract(month from timestamp_utc at time zone 'America/Sao_Paulo') as txn_month,
      case
        when extract(day from timestamp_utc at time zone 'America/Sao_Paulo') <= 9 then 1
        when extract(day from timestamp_utc at time zone 'America/Sao_Paulo') <= 19 then 2
        else 3
      end as band,
      sum(amount) as band_revenue
    from sumup_transactions
    where org_id = target_org_id
      and timestamp_utc >= ((now() at time zone 'America/Sao_Paulo')::date - interval '365 days')::timestamp
    group by txn_year, txn_month, band
  ),
  month_totals as (
    select
      extract(year from timestamp_utc at time zone 'America/Sao_Paulo') as txn_year,
      extract(month from timestamp_utc at time zone 'America/Sao_Paulo') as txn_month,
      sum(amount) as month_revenue
    from sumup_transactions
    where org_id = target_org_id
      and timestamp_utc >= ((now() at time zone 'America/Sao_Paulo')::date - interval '365 days')::timestamp
    group by txn_year, txn_month
  )
  select
    target_org_id,
    md.txn_year::integer, md.txn_month::integer, md.band,
    md.band_revenue,
    mt.month_revenue,
    case
      when mt.month_revenue > 0 then md.band_revenue / mt.month_revenue
      else 1.0 / 3  -- uniform fallback
    end as peso_faixa,
    case md.band
      when 1 then 1
      when 2 then 10
      else 20
    end as dia_referencia,
    ((now() at time zone 'America/Sao_Paulo')::date - interval '365 days'),
    (now() at time zone 'America/Sao_Paulo')::date,
    now(),
    'FINANCIAL_MODEL_V2_EXCEL_PARITY'
  from monthly_data md
  join month_totals mt on md.txn_year = mt.txn_year and md.txn_month = mt.txn_month
  on conflict (org_id, ano_historico, mes_historico, faixa)
  do update set
    peso_faixa = excluded.peso_faixa,
    receita_historica_faixa = excluded.receita_historica_faixa,
    calculado_em = now();

  get diagnostics v_rows_ins = row_count;

  return query select v_rows_ins::integer, v_rows_upd::integer, v_rows_del::integer, now(), 'FINANCIAL_MODEL_V2_EXCEL_PARITY'::text;
end;
$$;

-- ============================================================
-- 3. REFRESH sumup_receipt_profile_12m (Perfil_Recebimento_12M)
-- ============================================================
-- Calculate payment timing distribution by modality

create or replace function refresh_sumup_receipt_profile_12m(target_org_id uuid)
returns table(
  rows_inserted integer,
  rows_updated integer,
  rows_deleted integer,
  calculated_at timestamptz,
  calculation_version text
)
language plpgsql
as $$
declare
  v_rows_ins integer := 0;
  v_rows_upd integer := 0;
  v_rows_del integer := 0;
  v_window_start date;
  v_window_end date;
begin
  v_window_end := (now() at time zone 'America/Sao_Paulo')::date;
  v_window_start := v_window_end - interval '365 days';

  -- Delete old data for this org
  delete from sumup_receipt_profile_12m where org_id = target_org_id;
  get diagnostics v_rows_del = row_count;

  -- Insert fresh calculations
  insert into sumup_receipt_profile_12m (
    org_id,
    payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan,
    meses_ate_receber,
    valor_recebido_historico, qtd_recebimentos, total_recebido_modalidade,
    pct_recebimento_modalidade,
    inicio_janela, fim_janela,
    calculado_em, versao
  )
  with event_data as (
    select
      st.payment_type, st.card_type, st.installments_count, st.entry_mode, st.payout_plan,
      date_part('month', age(ste.due_date::date, st.timestamp_utc::date))::integer as months_to_receipt,
      ste.amount as payout_amount,
      st.id as txn_id
    from sumup_transaction_events ste
    join sumup_transactions st on ste.transaction_id = st.id
    where st.org_id = target_org_id
      and ste.status in ('SETTLED', 'PENDING')
      and st.timestamp_utc >= v_window_start::timestamp
      and st.timestamp_utc < (v_window_end + 1)::timestamp
  ),
  modality_totals as (
    select
      payment_type, card_type, installments_count, entry_mode, payout_plan,
      sum(payout_amount) as total_payout
    from event_data
    group by payment_type, card_type, installments_count, entry_mode, payout_plan
  )
  select
    target_org_id,
    ed.payment_type, coalesce(ed.card_type, 'UNKNOWN') as card_type, ed.installments_count as nro_parcelas_modelo, coalesce(ed.entry_mode, 'UNKNOWN') as entry_mode, coalesce(ed.payout_plan, 'UNKNOWN') as payout_plan,
    coalesce(ed.months_to_receipt, 0),  -- NULL months = same month (0)
    sum(ed.payout_amount),
    count(distinct ed.txn_id),
    mt.total_payout,
    case
      when mt.total_payout > 0 then sum(ed.payout_amount) / mt.total_payout
      else 0
    end as pct,
    v_window_start, v_window_end,
    now(),
    'FINANCIAL_MODEL_V2_EXCEL_PARITY'
  from event_data ed
  join modality_totals mt on
    (ed.payment_type is not distinct from mt.payment_type)
    and (ed.card_type is not distinct from mt.card_type)
    and (ed.installments_count is not distinct from mt.installments_count)
    and (ed.entry_mode is not distinct from mt.entry_mode)
    and (ed.payout_plan is not distinct from mt.payout_plan)
  group by
    ed.payment_type, ed.card_type, ed.installments_count, ed.entry_mode, ed.payout_plan,
    coalesce(ed.months_to_receipt, 0),
    mt.total_payout
  on conflict (org_id, payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan, meses_ate_receber)
  do update set
    valor_recebido_historico = excluded.valor_recebido_historico,
    pct_recebimento_modalidade = excluded.pct_recebimento_modalidade,
    calculado_em = now();

  get diagnostics v_rows_ins = row_count;

  return query select v_rows_ins::integer, v_rows_upd::integer, v_rows_del::integer, now(), 'FINANCIAL_MODEL_V2_EXCEL_PARITY'::text;
end;
$$;

-- ============================================================
-- 4. MASTER REFRESH FUNCTION
-- ============================================================

create or replace function refresh_all_analytical_tables(target_org_id uuid)
returns table(
  phase text,
  rows_affected integer,
  status text,
  calculated_at timestamptz
)
language plpgsql
as $$
declare
  v_result record;
begin
  -- Phase 1: Fee rates
  select * into v_result from refresh_sumup_fee_rates_12m(target_org_id);
  return query select 'fee_rates_12m'::text, (v_result.rows_inserted)::integer, 'SUCCESS'::text, (v_result.calculated_at)::timestamptz;

  -- Phase 2: Seasonality
  select * into v_result from refresh_sumup_seasonality_3bands_12m(target_org_id);
  return query select 'seasonality_3bands_12m'::text, (v_result.rows_inserted)::integer, 'SUCCESS'::text, (v_result.calculated_at)::timestamptz;

  -- Phase 3: Receipt profile
  select * into v_result from refresh_sumup_receipt_profile_12m(target_org_id);
  return query select 'receipt_profile_12m'::text, (v_result.rows_inserted)::integer, 'SUCCESS'::text, (v_result.calculated_at)::timestamptz;
end;
$$;

commit;
