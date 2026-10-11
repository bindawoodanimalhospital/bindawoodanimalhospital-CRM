"use server";

import { revalidatePath } from "next/cache";
import { assertCan, getCurrentStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/validation";

const refresh = () => { revalidatePath("/billing/dues"); revalidatePath("/billing"); };

export async function changePromise(dueId: string, date: string, note: string): Promise<FormState> {
  const me = await getCurrentStaff();
  if (!me?.can("billing.create") && !me?.can("crm.manage")) return { message: "You don't have permission." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_due_promise", { p_due: dueId, p_date: date, p_note: note });
  if (error) return { message: error.message };
  refresh();
  return { ok: true, message: "New promised date saved. The old date is kept in the history." };
}

export async function decideDue(dueId: string, approve: boolean, note: string): Promise<FormState> {
  await assertCan("billing.discount_approve");
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_due", { p_due: dueId, p_approve: approve, p_note: note || null });
  if (error) return { message: error.message };
  refresh();
  return { ok: true, message: approve ? "Approved." : "Marked as not approved — follow up with the customer." };
}

export async function writeOff(dueId: string, reason: string, key: string): Promise<FormState> {
  await assertCan("billing.discount_approve");
  const supabase = await createClient();
  const { error } = await supabase.rpc("write_off_due", { p_due: dueId, p_reason: reason, p_key: key });
  if (error) return { message: error.message };
  refresh();
  return { ok: true, message: "Written off." };
}
