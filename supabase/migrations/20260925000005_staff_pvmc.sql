-- Vets in Pakistan register with the Pakistan Veterinary Medical Council (PVMC), not PMDC.
alter table public.staff rename column pmdc_number to pvmc_number;
comment on column public.staff.pvmc_number is 'PVMC registration number, printed on prescriptions';
