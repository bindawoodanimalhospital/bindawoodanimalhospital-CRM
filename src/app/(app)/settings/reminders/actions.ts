"use server";

import { revalidatePath } from "next/cache";
import { assertCan, getCurrentStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, type FormState } from "@/lib/validation";

function parseDays(s: string): number[] | null {
  const parts = s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < -60 || n > 365)) return null;
  return [...new Set(nums)].sort((a, b) => a - b);
}

export async function saveRule(key: string, input: {
  is_active: boolean; customer_offsets: string; customer_repeat_days: string; staff_offsets: string; staff_repeat_days: string;
  staff_role: string; escalation: { after_days: number; role: string }[];
}): Promise<FormState> {
  await assertCan("settings.manage");
  const co = parseDays(input.customer_offsets);
  const so = parseDays(input.staff_offsets);
  if (!co || !so) return { message: "Days must be whole numbers, e.g. -3, 0, 3, 7" };
  const rep = (v: string) => (v.trim() === "" ? null : Number(v));
  const cr = rep(input.customer_repeat_days), sr = rep(input.staff_repeat_days);
  if ((cr != null && !(cr >= 1 && cr <= 90)) || (sr != null && !(sr >= 1 && sr <= 90))) return { message: "Repeat must be between 1 and 90 days." };
  const esc = input.escalation.filter((e) => e.role && e.after_days >= 0).sort((a, b) => a.after_days - b.after_days);
  const supabase = await createClient();
  const { error } = await supabase.from("reminder_rules").update({
    is_active: input.is_active, customer_offsets: co, customer_repeat_days: cr, staff_offsets: so, staff_repeat_days: sr,
    staff_role: input.staff_role || null, escalation: esc, updated_at: new Date().toISOString(),
  }).eq("key", key);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/settings/reminders");
  return { ok: true, message: "Saved. The next check uses the new timing." };
}

export async function saveTemplate(key: string, language: string, body: string): Promise<FormState> {
  const me = await getCurrentStaff();
  if (!me?.can("settings.manage") && !me?.can("crm.campaigns")) return { message: "You don't have permission." };
  if (body.trim().length < 10) return { message: "The message is too short." };
  const supabase = await createClient();
  const { error } = await supabase.from("message_templates").update({ body: body.trim(), updated_at: new Date().toISOString() }).eq("key", key).eq("language", language);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/settings/reminders");
  return { ok: true, message: "Message saved." };
}
