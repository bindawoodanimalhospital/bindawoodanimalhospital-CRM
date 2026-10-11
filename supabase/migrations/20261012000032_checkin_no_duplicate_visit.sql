-- =============================================================================
-- Checking in an appointment for a pet that is already in today's queue (e.g. it walked in early)
-- created a SECOND open visit — two tokens, two bills. The walk-in path already refused this.
-- Now the appointment is linked to the pet's existing open visit for today instead.
-- (Same function as migration 024 otherwise, including the service location carry-over.)
-- =============================================================================
create or replace function public.check_in_appointment(p_appointment_id uuid, p_pet_id uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  a public.appointments;
  v_id uuid;
begin
  select * into a from public.appointments where id = p_appointment_id for update;
  if not found then raise exception 'appointment not found'; end if;
  if a.status not in ('booked', 'confirmed') then
    raise exception 'this appointment is already %', a.status;
  end if;
  if coalesce(p_pet_id, a.pet_id) is null then
    raise exception 'choose which pet has arrived';
  end if;

  -- Already in today's queue? Use that visit — one pet, one token, one bill.
  select id into v_id from public.visits
   where pet_id = coalesce(p_pet_id, a.pet_id) and visit_date = private.clinic_today()
     and status not in ('completed', 'cancelled')
   order by checked_in_at limit 1;
  if v_id is null then
    insert into public.visits (pet_id, customer_id, appointment_id, doctor_id, visit_type_id, reason, priority, service_location, service_address)
    values (coalesce(p_pet_id, a.pet_id), a.customer_id, a.id, a.doctor_id, a.appointment_type_id, a.reason,
            case when a.is_urgent then 'urgent'::public.visit_priority else 'normal' end,
            a.service_location, a.service_address)
    returning id into v_id;
  else
    update public.visits set appointment_id = coalesce(appointment_id, a.id) where id = v_id;
  end if;

  update public.appointments
     set status = 'arrived', visit_id = v_id, pet_id = coalesce(p_pet_id, a.pet_id)
   where id = a.id;
  return v_id;
end $$;
