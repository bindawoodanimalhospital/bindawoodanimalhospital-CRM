"use server";

import { revalidatePath } from "next/cache";
import { assertCan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toE164 } from "@/lib/phone";
import { dbErrorMessage, type FormState } from "@/lib/validation";

const PROFILE_KEYS = ["name", "tagline", "address", "city", "phone", "whatsapp", "email", "website"] as const;

export async function saveClinicProfile(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await assertCan("settings.manage");
  const value = Object.fromEntries(PROFILE_KEYS.map((k) => [k, String(fd.get(k) ?? "").trim()]));
  if (!value.name) return { errors: { name: "Clinic name is required" } };
  for (const k of ["phone", "whatsapp"] as const) {
    if (value[k] && !toE164(value[k])) return { errors: { [k]: "Invalid number" } };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("system_settings")
    .update({ value, updated_by: me.id }).eq("key", "clinic.profile");
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/settings");
  return { ok: true, message: "Clinic profile saved." };
}

export async function addSpecies(name: string): Promise<FormState> {
  await assertCan("settings.manage");
  if (name.trim().length < 2) return { message: "Enter a name." };
  const supabase = await createClient();
  const { error } = await supabase.from("species").insert({ name: name.trim(), sort_order: 50 });
  if (error) return { message: error.code === "23505" ? "Already in the list." : dbErrorMessage(error) };
  revalidatePath("/settings");
  return { ok: true, message: "Species added." };
}

export async function addBreed(speciesId: string, name: string): Promise<FormState> {
  await assertCan("settings.manage");
  if (name.trim().length < 2) return { message: "Enter a breed name." };
  const supabase = await createClient();
  const { error } = await supabase.from("breeds").insert({ species_id: speciesId, name: name.trim() });
  if (error) return { message: error.code === "23505" ? "Already in the list." : dbErrorMessage(error) };
  revalidatePath("/settings");
  return { ok: true, message: "Breed added." };
}

export async function setBreedActive(id: string, active: boolean): Promise<FormState> {
  await assertCan("settings.manage");
  const supabase = await createClient();
  const { error } = await supabase.from("breeds").update({ is_active: active }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/settings");
  return { ok: true };
}

/** Surgery consent wording (English + Urdu). "approve" marks it reviewed — the form then stops printing "Draft wording". */
export async function saveConsentWording(en: string, ur: string, approve: boolean): Promise<FormState> {
  const me = await assertCan("settings.manage");
  if (en.trim().length < 40) return { message: "The English wording is too short." };
  const supabase = await createClient();
  const value = { en: en.trim(), ur: ur.trim(), status: approve ? "approved" : "draft",
    ...(approve ? { approved_by: me.id, approved_at: new Date().toISOString() } : {}) };
  const { error } = await supabase.from("system_settings").update({ value, updated_by: me.id }).eq("key", "surgery.consent_text");
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/settings"); revalidatePath("/dashboard");
  return { ok: true, message: approve ? "Consent wording approved." : "Consent wording saved as a draft." };
}

/** The short line printed at the bottom of bills and receipts (e.g. "Thank you for trusting us with your pet."). */
export async function saveBillFooter(text: string): Promise<FormState> {
  const me = await assertCan("settings.manage");
  const supabase = await createClient();
  const { data } = await supabase.from("system_settings").select("value").eq("key", "billing.config").maybeSingle();
  const value = { ...((data?.value as Record<string, unknown>) ?? {}), invoice_footer: text.trim() };
  const { error } = await supabase.from("system_settings").update({ value, updated_by: me.id }).eq("key", "billing.config");
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/settings");
  return { ok: true, message: "Bill footer saved." };
}
