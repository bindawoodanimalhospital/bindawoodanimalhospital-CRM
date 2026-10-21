-- =============================================================================
-- 1) A visit finishes by itself once its bill is issued. Staff issued the bill but often didn't press
--    "Paid — finish" on the queue card, so visits stayed in "Ready to pay" for days. Issuing the bill
--    (paid, or the rest as pay-later) now moves a visit that is "Ready to pay" to "Done".
-- 2) Empty draft bills (New bill pressed, nothing added) are removed every night and now.
-- =============================================================================

create or replace function private.bill_finishes_visit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.visit_id is not null and new.status = 'issued' and old.status = 'draft' then
    update public.visits set status = 'completed' where id = new.visit_id and status = 'ready_for_billing';
  end if;
  return null;
end $$;
create trigger invoices_finish_visit after update of status on public.invoices
  for each row execute function private.bill_finishes_visit();

-- The visits already stuck that way.
update public.visits v set status = 'completed'
 where v.status = 'ready_for_billing' and v.visit_date < private.clinic_today()
   and exists (select 1 from public.invoices i where i.visit_id = v.id and i.status = 'issued');

create or replace function private.remove_empty_drafts() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.invoices i
   where i.status = 'draft' and i.created_at < now() - interval '12 hours'
     and not exists (select 1 from public.invoice_items where invoice_id = i.id)
     and not exists (select 1 from public.payment_allocations where invoice_id = i.id)
     and not exists (select 1 from public.dues where invoice_id = i.id)
     and not exists (select 1 from public.tasks where invoice_id = i.id)
     and not exists (select 1 from public.invoice_returns where invoice_id = i.id);
  get diagnostics n = row_count;
  return n;
end $$;
select private.remove_empty_drafts();
select cron.schedule('bdah-empty-drafts', '30 21 * * *', 'select private.remove_empty_drafts()');   -- 2:30am Pakistan
