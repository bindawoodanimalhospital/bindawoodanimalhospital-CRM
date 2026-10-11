-- =============================================================================
-- Stock borrowed from / lent to nearby businesses (POS enhancement §7) — movement types.
-- Kept in their own migration: a new enum value can't be used in the transaction that adds it.
--
--  borrow_in      + stock received on loan from another business
--  borrow_return  − our stock given back to the business we borrowed from
--  lend_out       − stock lent to another business
--  lend_return    + lent stock given back to us
--
-- None of these are sales or purchases: reports never count them as usage, revenue or cost.
-- =============================================================================
alter type public.movement_kind add value if not exists 'borrow_in';
alter type public.movement_kind add value if not exists 'borrow_return';
alter type public.movement_kind add value if not exists 'lend_out';
alter type public.movement_kind add value if not exists 'lend_return';
