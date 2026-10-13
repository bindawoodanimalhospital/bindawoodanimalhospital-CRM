"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/validation";

export type RecordKind = "customer" | "pet";
const base = (kind: RecordKind) => (kind === "customer" ? "/customers" : "/pets");

/** Anyone: ask the hospital owner to remove a record added by mistake (he is reminded until it's handled). */
export async function requestRemoval(kind: RecordKind, id: string, reason: string): Promise<FormState> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_removal", { p_kind: kind, p_id: id, p_reason: reason.trim() || null });
  if (error) return { message: error.message };
  revalidatePath(`${base(kind)}/${id}`);
  revalidatePath("/removals");
  return { ok: true, message: "Mr. Musab Bin Dawood has been asked to remove it — he'll be reminded until it's done." };
}

/** Owner only (enforced by the database): delete a pet owner / pet that was never used. */
export async function deleteRecord(kind: RecordKind, id: string, reason: string): Promise<FormState> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = kind === "customer"
    ? await supabase.rpc("delete_customer", { p_customer: id, p_reason: reason.trim() || null })
    : await supabase.rpc("delete_pet", { p_pet: id, p_reason: reason.trim() || null });
  if (error) return { message: error.message };
  revalidatePath(base(kind));
  revalidatePath("/removals");
  revalidatePath("/dashboard");
  const pets = kind === "customer" ? Number(data ?? 0) : 0;
  return { ok: true, message: kind === "customer" ? `Pet owner deleted${pets ? ` with ${pets} pet${pets === 1 ? "" : "s"}` : ""}.` : "Pet deleted." };
}

/** Owner only: keep the record and close the request. */
export async function declineRemoval(requestId: string, note: string): Promise<FormState> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_removal", { p_request: requestId, p_note: note.trim() || null });
  if (error) return { message: error.message };
  revalidatePath("/removals");
  revalidatePath("/dashboard");
  return { ok: true, message: "Request declined — the record stays." };
}
