"use server";

import { revalidatePath } from "next/cache";
import { assertCan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, type FormState } from "@/lib/validation";
import { hashShareToken, newShareToken } from "@/lib/record-share";

/** Where owners open shared links: always the live address, so a link made on the clinic computer (localhost) works on the owner's phone. */
const PUBLIC_URL = "https://bdah-crm.bindawoodanimalhospital.workers.dev";

/**
 * Make a private link to the pet's record (or one problem). The link is returned once; only a hash is stored,
 * so it can't be shown again later — make a new one if it's lost. Links last 30 days and can be cancelled.
 */
export async function createRecordShare(petId: string, problemId: string | null): Promise<FormState & { url?: string }> {
  await assertCan("clinical.view");
  const token = newShareToken();
  const supabase = await createClient();
  const { error } = await supabase.from("record_shares").insert({ token_hash: await hashShareToken(token), pet_id: petId, problem_id: problemId });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/pets/${petId}`);
  return { ok: true, message: "Link ready — send it to the owner.", url: `${PUBLIC_URL}/r/${token}` };
}

export async function cancelRecordShare(petId: string, shareId: string): Promise<FormState> {
  await assertCan("clinical.view");
  const supabase = await createClient();
  const { error } = await supabase.from("record_shares").update({ revoked_at: new Date().toISOString() }).eq("id", shareId).is("revoked_at", null);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/pets/${petId}`);
  return { ok: true, message: "Link cancelled — it no longer opens." };
}

export async function setProblemStatus(petId: string, problemId: string, status: "open" | "resolved"): Promise<FormState> {
  await assertCan("clinical.create");
  const supabase = await createClient();
  const { error } = await supabase.from("pet_problems").update({ status }).eq("id", problemId).eq("pet_id", petId);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/pets/${petId}`);
  return { ok: true, message: status === "resolved" ? "Problem marked resolved." : "Problem reopened." };
}
