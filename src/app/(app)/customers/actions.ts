"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertCan } from "@/lib/auth";
import { prettifyPhones, toE164 } from "@/lib/phone";
import { addressLine } from "@/lib/clinic";
import {
  contactRow, contactSchema, customerSchema, dbErrorMessage, fieldErrors, formObject, petSchema, type FormState,
} from "@/lib/validation";

/**
 * Phone numbers and email are saved only for staff allowed to see them (customers.contact);
 * for everyone else those fields are not on the form and are ignored here. The database's own
 * rules refuse them anyway.
 */
async function saveContacts(customerId: string, fd: FormData, canContact: boolean): Promise<FormState | null> {
  if (!canContact) return null;
  const parsed = contactSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: fieldErrors(parsed.error), message: "Please fix the highlighted fields." };
  const supabase = await createClient();
  const { error } = await supabase.from("customer_contacts").upsert({ customer_id: customerId, ...contactRow(parsed.data) });
  return error ? { message: dbErrorMessage(error) } : null;
}

export async function createCustomer(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await assertCan("customers.create");
  const canContact = me.can("customers.contact");
  const parsed = customerSchema.safeParse(formObject(fd));
  const contact = canContact ? contactSchema.safeParse(formObject(fd)) : null;
  const petFields = formObject(fd, "pet.");
  const withPet = Boolean(petFields.name?.trim());
  const pet = withPet ? petSchema.safeParse(petFields) : null;

  // Balance owed from before the CRM (optional, needs billing.create).
  const prevAmount = Number(String(fd.get("prev_amount") ?? "").replace(/[^\d.]/g, "")) || 0;
  const prevDate = String(fd.get("prev_date") ?? "");
  const prevErrors: Record<string, string> = {};
  if (prevAmount > 0 && me.can("billing.create")) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(prevDate)) prevErrors.prev_date = "Enter the date of the old bill";
    else if (prevDate > new Date().toISOString().slice(0, 10)) prevErrors.prev_date = "The date can't be in the future";
  }

  if (!parsed.success || (pet && !pet.success) || (contact && !contact.success) || Object.keys(prevErrors).length) {
    const errors = {
      ...prevErrors,
      ...(parsed.success ? {} : fieldErrors(parsed.error)),
      ...(contact && !contact.success ? fieldErrors(contact.error) : {}),
      ...(pet && !pet.success ? Object.fromEntries(Object.entries(fieldErrors(pet.error)).map(([k, v]) => [`pet.${k}`, v])) : {}),
    };
    return { errors, message: "Please fix the highlighted fields." };
  }

  const supabase = await createClient();
  const { data: customer, error } = await supabase
    .from("customers").insert(parsed.data).select("id").single();
  if (error) return { message: dbErrorMessage(error) };
  const contactErr = await saveContacts(customer.id, fd, canContact);
  if (contactErr) redirect(`/customers/${customer.id}?notice=contact-failed`);

  if (pet?.success) {
    const { data: newPet, error: petErr } = await supabase.from("pets").insert(pet.data).select("id").single();
    if (petErr) redirect(`/customers/${customer.id}?notice=pet-failed`);
    await supabase.from("pet_owners").insert({ pet_id: newPet.id, customer_id: customer.id, is_primary: true });
  }
  if (prevAmount > 0 && me.can("billing.create")) {
    const { error: prevErr } = await supabase.rpc("add_previous_balance", {
      p_customer: customer.id, p_amount: prevAmount, p_date: prevDate, p_ref: String(fd.get("prev_ref") ?? "").trim() || null,
      p_note: null, p_key: `new-customer-prev:${customer.id}`,
    });
    if (prevErr) redirect(`/customers/${customer.id}?notice=previous-balance-failed`);
  }

  revalidatePath("/customers");
  redirect(`/customers/${customer.id}?notice=created`);
}

export async function updateCustomer(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const me = await assertCan("customers.edit");
  const parsed = customerSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: fieldErrors(parsed.error), message: "Please fix the highlighted fields." };

  const supabase = await createClient();
  const { error } = await supabase.from("customers").update(parsed.data).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  const contactErr = await saveContacts(id, fd, me.can("customers.contact"));
  if (contactErr) return contactErr;

  revalidatePath(`/customers/${id}`);
  redirect(`/customers/${id}?notice=saved`);
}

export type DuplicateHit = { id: string; code: string; full_name: string; phone: string | null; area: string | null; reason: string };

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
  const { data } = await supabase.rpc("smart_search", { q, p_scope: "owner", max_results: 8 });
  return ((data ?? []) as (CustomerOption & { kind: string })[]).filter((h) => h.kind === "customer").slice(0, 8)
    .map((h) => ({ ...h, subtitle: prettifyPhones(h.subtitle) }));
}

/** The customer's saved address as one line (house, block, full address, area, city) — for deliveries & home visits. */
export async function customerAddress(customerId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("customers").select("house_no, block, address, area, city").eq("id", customerId).maybeSingle();
  return addressLine(data);
}

export async function mergeCustomers(sourceId: string, targetId: string, reason: string): Promise<FormState> {
  await assertCan("customers.merge");
  const supabase = await createClient();
  const { error } = await supabase.rpc("merge_customers", { p_source: sourceId, p_target: targetId, p_reason: reason });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/customers");
  redirect(`/customers/${targetId}?notice=merged`);
}
