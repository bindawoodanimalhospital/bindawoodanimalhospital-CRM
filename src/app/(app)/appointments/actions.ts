"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, type FormState } from "@/lib/validation";

export async function getCustomerPets(customerId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("pet_owners")
    .select("pets(id, name, status, species(name))").eq("customer_id", customerId);
  return (data ?? [])
    .map((r) => r.pets as unknown as { id: string; name: string; status: string; species: { name: string } | null })
    .filter((p) => p && p.status === "active")
    .map((p) => ({ id: p.id, name: p.name, species: p.species?.name ?? null }));
}

/** Local Lahore date + time → UTC ISO. Pakistan has no daylight saving (UTC+5 all year). */
function pkToIso(date: string, time: string) {
  return new Date(`${date}T${time}:00+05:00`).toISOString();
}

const bookingSchema = z.object({
  id: z.uuid().optional(),
  customer_id: z.uuid("Choose the owner"),
  pet_id: z.string().optional().transform((v) => (v && v !== "none" ? v : null)).pipe(z.uuid().nullable()),
  appointment_type_id: z.uuid("Choose the visit type"),
  doctor_id: z.string().optional().transform((v) => (v && v !== "any" ? v : null)).pipe(z.uuid().nullable()),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Choose a time"),
  minutes: z.coerce.number().int().min(5).max(480),
  source: z.enum(["phone", "whatsapp", "in_person", "online"]).default("phone"),
  is_urgent: z.boolean().default(false),
  reason: z.string().trim().max(500).optional().transform((v) => v || null),
  pre_visit_instructions: z.string().trim().max(1000).optional().transform((v) => v || null),
  service_location: z.enum(["clinic", "home_visit"]).default("clinic"),
  service_address: z.string().trim().max(500).optional().transform((v) => v || null),
}).refine((v) => v.service_location === "clinic" || !!v.service_address, { message: "Enter the home visit address", path: ["service_address"] })
  .transform((v) => ({ ...v, service_address: v.service_location === "home_visit" ? v.service_address : null }));
export type BookingInput = z.input<typeof bookingSchema>;

export async function findConflicts(doctorId: string | null, date: string, time: string, minutes: number, excludeId?: string) {
  if (!doctorId || doctorId === "any" || !date || !time) return [];
  const starts = pkToIso(date, time);
  const ends = new Date(new Date(starts).getTime() + minutes * 60000).toISOString();
  const supabase = await createClient();
  const { data } = await supabase.rpc("appointment_conflicts", { p_doctor: doctorId, p_starts: starts, p_ends: ends, p_exclude: excludeId ?? null });
  return (data ?? []) as { id: string; starts_at: string; customer_name: string; pet_name: string | null }[];
}

export async function saveAppointment(input: BookingInput): Promise<FormState> {
  await assertCan("appointments.manage");
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message };
  const { id, date, time, minutes, ...rest } = parsed.data;
  const starts_at = pkToIso(date, time);
  const ends_at = new Date(new Date(starts_at).getTime() + minutes * 60000).toISOString();
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("appointments").update({ ...rest, starts_at, ends_at }).eq("id", id).in("status", ["booked", "confirmed"])
    : await supabase.from("appointments").insert({ ...rest, starts_at, ends_at });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/appointments");
  return { ok: true, message: id ? "Appointment updated." : "Appointment booked." };
}

export async function setAppointmentStatus(id: string, status: "confirmed" | "no_show" | "booked"): Promise<FormState> {
  await assertCan("appointments.manage");
  const supabase = await createClient();
  const { error } = await supabase.from("appointments").update({ status }).eq("id", id).in("status", ["booked", "confirmed", "no_show"]);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/appointments");
  return { ok: true };
}

export async function cancelAppointment(id: string, reason: string): Promise<FormState> {
  await assertCan("appointments.manage");
  if (reason.trim().length < 3) return { message: "Please give a reason." };
  const supabase = await createClient();
  const { error } = await supabase.from("appointments").update({ status: "cancelled", cancel_reason: reason.trim() }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/appointments");
  return { ok: true, message: "Appointment cancelled." };
}

export async function checkInAppointment(id: string, petId?: string): Promise<FormState & { visitId?: string }> {
  await assertCan("queue.manage");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_in_appointment", { p_appointment_id: id, p_pet_id: petId ?? null });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/appointments");
  revalidatePath("/queue");
  return { ok: true, message: "Checked in — now in today's queue.", visitId: data as string };
}

/** Species for the quick "new / stray animal" form (Dog, Cat, … in the clinic's order). */
export async function speciesChoices(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("species").select("id, name").eq("is_active", true).order("sort_order");
  return data ?? [];
}

/**
 * Register a pet in one step for an appointment — a new pet or a stray someone brought in.
 * The name is optional ("Stray dog" / "Stray cat" when left empty); details can be added later on the pet page.
 */
export async function quickAddPet(customerId: string, name: string, speciesId: string): Promise<FormState & { petId?: string; petName?: string }> {
  await assertCan("pets.create");
  if (!speciesId) return { message: "Choose dog, cat or other." };
  const supabase = await createClient();
  const { data: sp } = await supabase.from("species").select("name").eq("id", speciesId).maybeSingle();
  const petName = name.trim() || `Stray ${(sp?.name ?? "animal").toLowerCase()}`;
  const { data: pet, error } = await supabase.from("pets").insert({ name: petName, species_id: speciesId }).select("id").single();
  if (error) return { message: dbErrorMessage(error) };
  const { error: linkErr } = await supabase.from("pet_owners").insert({ pet_id: pet.id, customer_id: customerId, is_primary: true });
  if (linkErr) return { message: dbErrorMessage(linkErr) };
  revalidatePath(`/customers/${customerId}`);
  return { ok: true, petId: pet.id, petName, message: `${petName} registered.` };
}

/** Attach / change the pet on an appointment (e.g. it was booked before the pet was registered). */
export async function setAppointmentPet(appointmentId: string, petId: string): Promise<FormState> {
  await assertCan("appointments.manage");
  const supabase = await createClient();
  const { error } = await supabase.from("appointments").update({ pet_id: petId }).eq("id", appointmentId);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/appointments");
  return { ok: true };
}
