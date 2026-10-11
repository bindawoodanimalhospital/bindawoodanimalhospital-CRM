"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, type FormState } from "@/lib/validation";

async function canWork() {
  const me = await getCurrentStaff();
  return me?.isActive && (me.can("crm.manage") || me.can("clinical.create") || me.can("vaccinations.manage")) ? me : null;
}

/** Contacted the owner — stays open until done/booked/skipped (opening an item is never an outcome). */
export async function markContacted(id: string, note: string): Promise<FormState> {
  const me = await canWork();
  if (!me) return { message: "You don't have permission." };
  const supabase = await createClient();
  const stamp = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Karachi" }).format(new Date());
  const { error } = await supabase.from("due_items")
    .update({ outcome: `Contacted ${stamp} by ${me.fullName}${note.trim() ? ` — ${note.trim()}` : ""}` }).eq("id", id).eq("status", "pending");
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/due");
  return { ok: true, message: "Noted. It stays on the list until the visit happens." };
}

export async function rescheduleDue(id: string, newDate: string, reason: string): Promise<FormState> {
  if (!(await canWork())) return { message: "You don't have permission." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return { message: "Choose a date." };
  if (reason.trim().length < 3) return { message: "Give a reason for the new date." };
  const supabase = await createClient();
  const { data: cur } = await supabase.from("due_items").select("due_on").eq("id", id).single();
  if (!cur) return { message: "Not found." };
  // Keeps the previous date + reason (spec §31); the audit log records who changed it.
  const { error } = await supabase.from("due_items")
    .update({ due_on: newDate, previous_due_on: cur.due_on, outcome_reason: reason.trim() }).eq("id", id).eq("status", "pending");
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/due");
  return { ok: true, message: "New date saved." };
}

export async function closeDue(id: string, status: "done" | "skipped" | "cancelled", outcome: string, reason: string): Promise<FormState> {
  const me = await canWork();
  if (!me) return { message: "You don't have permission." };
  if (status !== "done" && reason.trim().length < 3) return { message: "A reason is required." };
  const supabase = await createClient();
  const { error } = await supabase.from("due_items").update({
    status, outcome, outcome_reason: reason.trim() || null, completed_at: new Date().toISOString(), completed_by: me.id,
  }).eq("id", id).eq("status", "pending");
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/due");
  return { ok: true, message: "Closed." };
}
