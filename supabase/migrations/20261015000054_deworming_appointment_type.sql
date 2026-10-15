-- Deworming as an appointment / visit type (many clients come only for deworming).
-- Placed right after Vaccination in the lists; 10 minutes like a vaccination.
update public.appointment_types set sort_order = sort_order + 1 where sort_order >= 3;
insert into public.appointment_types (name, default_minutes, tone, requires_doctor, is_active, sort_order)
select 'Deworming', 10, 'success', true, true, 3
 where not exists (select 1 from public.appointment_types where lower(name) = 'deworming');
