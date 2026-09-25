"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertCan } from "@/lib/auth";
import { toE164 } from "@/lib/phone";
import {
  customerRow, customerSchema, dbErrorMessage, fieldErrors, formObject, petSchema, type FormState,
} from "@/lib/validation";

export async function createCustomer(_prev: FormState, fd: FormData): Promise<FormState> {
  await assertCan("customers.create");
  const parsed = customerSchema.safeParse(formObject(fd));
  const petFields = formObject(fd, "pet.");
  const withPet = Boolean(petFields.name?.trim());
  const pet = withPet ? petSchema.safeParse(petFields) : null;

  if (!parsed.success || (pet && !pet.success)) {
    const errors = {
      ...(parsed.success ? {} : fieldErrors(parsed.error)),
      ...(pet && !pet.success ? Object.fromEntries(Object.entries(fieldErrors(pet.error)).map(([k, v]) => [`pet.${k}`, v])) : {}),
    };
    return { errors, message: "Please fix the highlighted fields." };
  }

  const supabase = await createClient();
  const { data: customer, error } = await supabase
    .from("customers").insert(customerRow(parsed.data)).select("id").single();
  if (error) return { message: dbErrorMessage(error) };

  if (pet?.success) {
    const { data: newPet, error: petErr } = await supabase.from("pets").insert(pet.data).select("id").single();
    if (petErr) redirect(`/customers/${customer.id}?notice=pet-failed`);
    await supabase.from("pet_owners").insert({ pet_id: newPet.id, customer_id: customer.id, is_primary: true });
  }

  revalidatePath("/customers");
  redirect(`/customers/${customer.id}?notice=created`);
}

export async function updateCustomer(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  await assertCan("customers.edit");
  const parsed = customerSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: fieldErrors(parsed.error), message: "Please fix the highlighted fields." };

  const supabase = await createClient();
  const { error } = await supabase.from("customers").update(customerRow(parsed.data)).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };

  revalidatePath(`/customers/${id}`);
  redirect(`/customers/${id}?notice=saved`);
}

export type DuplicateHit = { id: string; code: string; full_name: string; phone: string; area: string | null; reason: string };

/** Called while typing on the new-customer form (spec §6 duplicate prevention). */
export async function findDuplicates(phone: string, name: string, excludeId?: string): Promise<DuplicateHit[]> {
  const e164 = toE164(phone);
  const cleanName = name.trim();
  if (!e164 && cleanName.length < 3) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("find_customer_duplicates", {
    p_phone: e164, p_name: cleanName.length >= 3 ? cleanName : null, p_exclude: excludeId ?? null,
  });
  return (data ?? []) as DuplicateHit[];
}

export type CustomerOption = { id: string; code: string; title: string; subtitle: string };

export async function searchCustomers(q: string): Promise<CustomerOption[]> {
  if (q.trim().length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("global_search", { q, max_results: 20 });
  return ((data ?? []) as (CustomerOption & { kind: string })[]).filter((h) => h.kind === "customer").slice(0, 8);
}

export async function mergeCustomers(sourceId: string, targetId: string, reason: string): Promise<FormState> {
  await assertCan("customers.merge");
  const supabase = await createClient();
  const { error } = await supabase.rpc("merge_customers", { p_source: sourceId, p_target: targetId, p_reason: reason });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/customers");
  redirect(`/customers/${targetId}?notice=merged`);
}
