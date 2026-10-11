-- Resets ID counters of tables that are still empty (test runs advance sequences even when rolled back).
-- Safe to run anytime: it never touches a sequence whose table has rows.
do $$
declare r record; n bigint;
begin
  for r in select * from (values
    ('customers', 'customer_code_seq'), ('pets', 'pet_code_seq'), ('prescriptions', 'prescription_code_seq'),
    ('diagnostic_orders', 'diagnostic_code_seq'), ('surgeries', 'surgery_code_seq'), ('admissions', 'admission_code_seq'), ('purchases', 'purchase_code_seq'), ('payments', 'receipt_code_seq'), ('stock_loans', 'stock_loan_code_seq')) as t(tbl, seq)
  loop
    execute format('select count(*) from public.%I', r.tbl) into n;
    if n = 0 then
      execute format('select setval(%L, 1, false)', 'public.' || r.seq);
      raise notice 'reset %', r.seq;
    end if;
  end loop;
end $$;

-- Bill numbers and queue tokens are kept in counter tables, not sequences: clear any counter
-- that no real row uses (otherwise the first real bill could be BD-26-000004, or the first
-- patient of the day token #7, after test or demo data was removed).
do $$
declare n int;
begin
  delete from public.invoice_counters ic
   where not exists (select 1 from public.invoices i where i.number like ic.prefix || '-%');
  get diagnostics n = row_count;
  if n > 0 then raise notice 'reset % bill-number counter(s)', n; end if;
  delete from public.visit_token_counters tc
   where not exists (select 1 from public.visits v where v.visit_date = tc.visit_date);
  get diagnostics n = row_count;
  if n > 0 then raise notice 'reset % queue-token counter(s)', n; end if;
end $$;
