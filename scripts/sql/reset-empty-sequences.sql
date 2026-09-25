-- Resets ID counters of tables that are still empty (test runs advance sequences even when rolled back).
-- Safe to run anytime: it never touches a sequence whose table has rows.
do $$
declare r record; n bigint;
begin
  for r in select * from (values
    ('customers', 'customer_code_seq'), ('pets', 'pet_code_seq'), ('prescriptions', 'prescription_code_seq'),
    ('diagnostic_orders', 'diagnostic_code_seq'), ('surgeries', 'surgery_code_seq'), ('admissions', 'admission_code_seq')) as t(tbl, seq)
  loop
    execute format('select count(*) from public.%I', r.tbl) into n;
    if n = 0 then
      execute format('select setval(%L, 1, false)', 'public.' || r.seq);
      raise notice 'reset %', r.seq;
    end if;
  end loop;
end $$;
