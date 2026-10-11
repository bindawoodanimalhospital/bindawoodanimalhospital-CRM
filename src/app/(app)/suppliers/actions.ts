"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertCan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toE164 } from "@/lib/phone";
import { dbErrorMessage, type FormState } from "@/lib/validation";

const refresh = () => revalidatePath("/suppliers", "layout");

export async function saveSupplier(id: string | null, input: { name: string; contact_name: string; phone: string; address: string; ntn: string; notes: string }): Promise<FormState> {
  await assertCan("suppliers.manage");
  if (input.name.trim().length < 2) return { message: "Enter the supplier's name." };
  const row = {
    name: input.name.trim(), contact_name: input.contact_name.trim() || null, phone: input.phone ? toE164(input.phone) ?? input.phone.trim() : null,
    address: input.address.trim() || null, ntn: input.ntn.trim() || null, notes: input.notes.trim() || null,
  };
  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("suppliers").update(row).eq("id", id).select("id").single()
    : await supabase.from("suppliers").insert(row).select("id").single();
  if (error) return { message: error.code === "23505" ? "A supplier with this name already exists." : dbErrorMessage(error) };
  refresh();
  if (!id) redirect(`/suppliers/${data.id}`);
  return { ok: true, message: "Saved." };
}

export async function startPurchase(supplierId: string): Promise<FormState> {
  await assertCan("suppliers.manage");
  const supabase = await createClient();
  const { data, error } = await supabase.from("purchases").insert({ supplier_id: supplierId }).select("id").single();
  if (error) return { message: dbErrorMessage(error) };
  redirect(`/suppliers/receive/${data.id}`);
}

export async function savePurchaseHeader(id: string, patch: { supplier_invoice_no?: string; invoice_date?: string; notes?: string }): Promise<FormState> {
  await assertCan("suppliers.manage");
  const supabase = await createClient();
  const { error } = await supabase.from("purchases").update({
    supplier_invoice_no: patch.supplier_invoice_no?.trim() || null, invoice_date: patch.invoice_date || null, notes: patch.notes?.trim() || null,
  }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  return { ok: true };
}

const lineSchema = z.object({
  item_id: z.uuid("Choose the item"),
  location_id: z.uuid("Choose where it's stored"),
  batch_no: z.string().trim().default(""),
  expiry_date: z.string().optional().transform((v) => v || null),
  qty: z.coerce.number().positive("Quantity must be more than 0"),
  unit_cost: z.coerce.number().min(0, "Cost can't be negative"),
});

export async function addPurchaseLine(purchaseId: string, input: z.input<typeof lineSchema>): Promise<FormState> {
  await assertCan("suppliers.manage");
  const parsed = lineSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { error } = await supabase.from("purchase_lines").insert({ ...parsed.data, purchase_id: purchaseId });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/suppliers/receive/${purchaseId}`);
  return { ok: true };
}

export async function removePurchaseLine(purchaseId: string, lineId: string): Promise<FormState> {
  await assertCan("suppliers.manage");
  const supabase = await createClient();
  const { error } = await supabase.from("purchase_lines").delete().eq("id", lineId);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/suppliers/receive/${purchaseId}`);
  return { ok: true };
}

export async function receivePurchase(purchaseId: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("receive_purchase", { p_id: purchaseId });
  if (error) return { message: error.message };
  refresh();
  revalidatePath("/inventory");
  return { ok: true, message: "Stock received and added to inventory." };
}

export async function cancelPurchase(purchaseId: string): Promise<FormState> {
  await assertCan("suppliers.manage");
  const supabase = await createClient();
  const { error } = await supabase.from("purchases").update({ status: "cancelled" }).eq("id", purchaseId).eq("status", "draft");
  if (error) return { message: dbErrorMessage(error) };
  refresh();
  return { ok: true, message: "Cancelled." };
}

export async function paySupplier(supplierId: string, input: { amount: number; method: string; paid_on: string; reference: string; purchase_id?: string | null; notes?: string }): Promise<FormState> {
  await assertCan("suppliers.manage");
  await assertCan("finance.view");
  if (!(input.amount > 0)) return { message: "Enter the amount paid." };
  const supabase = await createClient();
  const { error } = await supabase.from("supplier_payments").insert({
    supplier_id: supplierId, amount: input.amount, method: input.method, paid_on: input.paid_on || undefined,
    reference: input.reference.trim() || null, purchase_id: input.purchase_id || null, notes: input.notes?.trim() || null,
  });
  if (error) return { message: dbErrorMessage(error) };
  refresh();
  return { ok: true, message: "Payment to supplier recorded." };
}
