-- =============================================================================
-- Bill access rules evaluated once per query instead of once per row.
-- Pressure test (10,000 bills): the bills list, customer ledger and balances took ~2.5 s on the
-- server because every row ran private.can_see_invoice()/can_write_invoice() (security-definer
-- calls). Same rules, written with (select …) so PostgreSQL computes each permission once.
-- Access is unchanged — verified by the 399-check role matrix (scripts/sql/role-matrix-test.sql).
--   see  : billing.view, or pos.use for pet-store sales
--   write: billing.create, or pos.use for pet-store sales
-- =============================================================================

drop policy invoices_select on public.invoices;
drop policy invoices_insert on public.invoices;
drop policy invoices_update on public.invoices;
drop policy invoices_delete on public.invoices;
drop policy invoice_items_select on public.invoice_items;
drop policy invoice_items_write on public.invoice_items;

create policy invoices_select on public.invoices for select to authenticated
  using ((select private.has_permission('billing.view')) or (kind = 'store' and (select private.has_permission('pos.use'))));
create policy invoices_insert on public.invoices for insert to authenticated
  with check (((select private.has_permission('billing.create')) or (kind = 'store' and (select private.has_permission('pos.use'))))
              and status = 'draft' and amount_paid = 0 and number is null);
create policy invoices_update on public.invoices for update to authenticated
  using ((select private.has_permission('billing.create')) or (kind = 'store' and (select private.has_permission('pos.use'))))
  with check ((select private.has_permission('billing.create')) or (kind = 'store' and (select private.has_permission('pos.use'))));
create policy invoices_delete on public.invoices for delete to authenticated
  using (((select private.has_permission('billing.create')) or (kind = 'store' and (select private.has_permission('pos.use'))))
         and status = 'draft');

create policy invoice_items_select on public.invoice_items for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id
                 and ((select private.has_permission('billing.view')) or (i.kind = 'store' and (select private.has_permission('pos.use'))))));
create policy invoice_items_write on public.invoice_items for all to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'draft'
                 and ((select private.has_permission('billing.create')) or (i.kind = 'store' and (select private.has_permission('pos.use'))))))
  with check (exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'draft'
                 and ((select private.has_permission('billing.create')) or (i.kind = 'store' and (select private.has_permission('pos.use'))))));
