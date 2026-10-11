import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { SpeciesOption } from "@/components/app/pet-fields";

export const getSpeciesOptions = cache(async (): Promise<SpeciesOption[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("species")
    .select("id, name, breeds(id, name, is_active)")
    .eq("is_active", true)
    .order("sort_order")
    .order("name", { referencedTable: "breeds" });
  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    breeds: (s.breeds ?? []).filter((b) => b.is_active).map(({ id, name }) => ({ id, name })),
  }));
});

export const getSetting = cache(async <T = Record<string, unknown>>(key: string): Promise<T | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from("system_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? null;
});

export async function getReferralSources(): Promise<string[]> {
  const cfg = await getSetting<{ referral_sources?: string[] }>("customers.fields");
  return cfg?.referral_sources ?? ["Walk-in", "Referral", "Google", "Instagram", "Facebook", "Other"];
}

/** Turn a search box value into an ilike pattern on search_text (digits-only for phone-ish input). */
export function searchPattern(q: string): string | null {
  const t = q.trim().toLowerCase();
  if (t.length < 2) return null;
  const digits = t.replace(/\D/g, "");
  const term = digits.length >= 4 && digits.length >= t.replace(/[\s-]/g, "").length - 1 ? digits : t;
  return `%${term.replace(/[%_]/g, "")}%`;
}

export type DoctorOption = { id: string; full_name: string };

/** Active doctors, for "assign doctor" pickers. */
export const getDoctors = cache(async (): Promise<DoctorOption[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("staff").select("id, full_name").eq("is_doctor", true).eq("is_active", true)
    .order("full_name");
  return data ?? [];
});

export type AppointmentTypeOption = { id: string; name: string; default_minutes: number; tone: string };

export const getAppointmentTypes = cache(async (): Promise<AppointmentTypeOption[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("appointment_types").select("id, name, default_minutes, tone")
    .eq("is_active", true).order("sort_order");
  return data ?? [];
});
