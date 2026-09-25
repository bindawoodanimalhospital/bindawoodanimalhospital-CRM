"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertCan } from "@/lib/auth";
import { dbErrorMessage, fieldErrors, formObject, petSchema, type FormState } from "@/lib/validation";

export async function createPet(customerId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  await assertCan("pets.create");
  const parsed = petSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: fieldErrors(parsed.error), message: "Please fix the highlighted fields." };

  const supabase = await createClient();
  const { data: pet, error } = await supabase.from("pets").insert(parsed.data).select("id").single();
  if (error) return { message: dbErrorMessage(error) };

  const weight = Number(fd.get("weight_kg"));
  const [{ error: ownerErr }] = await Promise.all([
    supabase.from("pet_owners").insert({ pet_id: pet.id, customer_id: customerId, is_primary: true }),
    weight > 0 ? supabase.from("pet_weights").insert({ pet_id: pet.id, weight_kg: weight }) : Promise.resolve(null),
  ]);
  if (ownerErr) return { message: dbErrorMessage(ownerErr) };

  revalidatePath(`/customers/${customerId}`);
  redirect(`/pets/${pet.id}?notice=created`);
}

export async function updatePet(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  await assertCan("pets.edit");
  const parsed = petSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: fieldErrors(parsed.error), message: "Please fix the highlighted fields." };

  const status = z.enum(["active", "deceased", "transferred", "inactive"]).catch("active").parse(fd.get("status"));
  const supabase = await createClient();
  const { error } = await supabase.from("pets").update({ ...parsed.data, status }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };

  revalidatePath(`/pets/${id}`);
  redirect(`/pets/${id}?notice=saved`);
}

export async function addWeight(petId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const kg = Number(fd.get("weight_kg"));
  if (!(kg > 0 && kg < 2000)) return { errors: { weight_kg: "Enter a weight in kg" } };
  const supabase = await createClient();
  const { error } = await supabase.from("pet_weights").insert({ pet_id: petId, weight_kg: kg, note: fd.get("note") || null });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/pets/${petId}`);
  return { ok: true, message: "Weight recorded." };
}

const alertSchema = z.object({
  kind: z.enum(["allergy", "condition", "behaviour", "other"]),
  label: z.string().trim().min(2, "Describe the alert"),
  severity: z.enum(["info", "warning", "critical"]).default("warning"),
  notes: z.string().trim().optional().transform((v) => v || null),
});

export async function addAlert(petId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  await assertCan("pets.edit");
  const parsed = alertSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("pet_alerts").insert({ ...parsed.data, pet_id: petId });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/pets/${petId}`);
  return { ok: true, message: "Alert added." };
}

export async function resolveAlert(petId: string, alertId: string) {
  await assertCan("pets.edit");
  const supabase = await createClient();
  await supabase.from("pet_alerts").update({ is_active: false }).eq("id", alertId);
  revalidatePath(`/pets/${petId}`);
}

export async function addOwner(petId: string, customerId: string, relationship: string | null): Promise<FormState> {
  await assertCan("pets.edit");
  const supabase = await createClient();
  const { error } = await supabase.from("pet_owners").insert({ pet_id: petId, customer_id: customerId, relationship });
  if (error) return { message: error.code === "23505" ? "Already an owner of this pet." : dbErrorMessage(error) };
  revalidatePath(`/pets/${petId}`);
  return { ok: true, message: "Owner added." };
}

export async function makePrimaryOwner(petId: string, customerId: string) {
  await assertCan("pets.edit");
  const supabase = await createClient();
  await supabase.from("pet_owners").update({ is_primary: false }).eq("pet_id", petId);
  await supabase.from("pet_owners").update({ is_primary: true }).eq("pet_id", petId).eq("customer_id", customerId);
  revalidatePath(`/pets/${petId}`);
}
