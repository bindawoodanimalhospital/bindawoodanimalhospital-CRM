"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertCan, getCurrentStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, type FormState } from "@/lib/validation";

const refresh = (id?: string) => { revalidatePath("/billing"); if (id) revalidatePath(`/billing/${id}`); };

/** Friendlier text for money errors raised by the database functions. */
function moneyError(err: { code?: string; message: string } | null) {
  if (!err) return "Something went wrong.";
  if (err.code === "P0001" || err.code === "P0002" || !err.code || err.code.startsWith("P")) return err.message;
  return dbErrorMessage(err);
}

export async function createInvoice(customerId: string, petId?: string | null, visitId?: string | null): Promise<FormState> {
  await assertCan("billing.create");
  const supabase = await createClient();
  if (visitId) {
    // Re-use the open draft for this visit instead of creating duplicates.
    const { data: existing } = await supabase.from("invoices").select("id").eq("visit_id", visitId).eq("status", "draft").maybeSingle();
    if (existing) redirect(`/billing/${existing.id}`);
  }
  const { data, error } = await supabase.from("invoices")
    .insert({ customer_id: customerId, pet_id: petId ?? null, visit_id: visitId ?? null, kind: "clinic" }).select("id").single();
  if (error) return { message: dbErrorMessage(error) };
  refresh();
  redirect(`/billing/${data.id}`);
}

export async function billVisit(visitId: string): Promise<FormState> {
  await assertCan("billing.create");
  const supabase = await createClient();
  const { data: v } = await supabase.from("visits").select("customer_id, pet_id").eq("id", visitId).single();
  if (!v) return { message: "Visit not found." };
  return createInvoice(v.customer_id, v.pet_id, visitId);
}

export type CatalogHit = { id: string; name: string; kind: "service" | "product"; sale_price: number; unit: string; price_is_editable: boolean; track_stock: boolean; category: string | null };

export async function searchCatalog(q: string, retailOnly = false): Promise<CatalogHit[]> {
  const term = q.replace(/[^\p{L}\p{N} .\-/]/gu, "").trim();
  const supabase = await createClient();
  let query = supabase.from("catalog_items").select("id, name, kind, sale_price, unit, price_is_editable, track_stock, category")
    .eq("is_active", true).order("name").limit(12);
  if (term) query = query.or(`name.ilike.%${term}%,sku.eq.${term},barcode.eq.${term},category.ilike.%${term}%`);
  if (retailOnly) query = query.eq("is_retail", true);
  const { data } = await query;
  return (data ?? []) as CatalogHit[];
}

export async function addLine(invoiceId: string, line: { item_id: string; quantity: number; unit_price?: number; source_table?: string; source_id?: string; description?: string }): Promise<FormState> {
  const supabase = await createClient();
  const { count } = await supabase.from("invoice_items").select("id", { count: "exact", head: true }).eq("invoice_id", invoiceId);
  const { error } = await supabase.from("invoice_items").insert({
    invoice_id: invoiceId, item_id: line.item_id, quantity: line.quantity, unit_price: line.unit_price ?? 0,
    sort_order: count ?? 0, source_table: line.source_table ?? null, source_id: line.source_id ?? null, description: line.description ?? "",
  });
  if (error) return { message: dbErrorMessage(error) };
  refresh(invoiceId);
  return { ok: true };
}

export async function addLines(invoiceId: string, lines: Parameters<typeof addLine>[1][]): Promise<FormState> {
  for (const l of lines) {
    const r = await addLine(invoiceId, l);
    if (!r.ok) return r;
  }
  return { ok: true, message: `${lines.length} item${lines.length === 1 ? "" : "s"} added.` };
}

const lineSchema = z.object({
  quantity: z.coerce.number().positive("Quantity must be more than 0").max(100000).optional(),
  unit_price: z.coerce.number().min(0).optional(),
  discount_amount: z.coerce.number().min(0).optional(),
  batch_id: z.string().nullable().optional(),
  batch_override_reason: z.string().nullable().optional(),
});

export async function updateLine(invoiceId: string, lineId: string, patch: z.input<typeof lineSchema>): Promise<FormState> {
  const parsed = lineSchema.safeParse(patch);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { error } = await supabase.from("invoice_items").update(parsed.data).eq("id", lineId);
  if (error) return { message: dbErrorMessage(error) };
  refresh(invoiceId);
  return { ok: true };
}

export async function removeLine(invoiceId: string, lineId: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.from("invoice_items").delete().eq("id", lineId);
  if (error) return { message: dbErrorMessage(error) };
  refresh(invoiceId);
  return { ok: true };
}

export async function setInvoiceDiscount(invoiceId: string, amount: number, reason: string): Promise<FormState> {
  if (amount > 0 && reason.trim().length < 3) return { message: "Give a reason for the discount." };
  const supabase = await createClient();
  const { error } = await supabase.from("invoices")
    .update({ invoice_discount: Math.max(0, amount || 0), discount_reason: amount > 0 ? reason.trim() : null }).eq("id", invoiceId);
  if (error) return { message: dbErrorMessage(error) };
  refresh(invoiceId);
  return { ok: true, message: amount > 0 ? "Discount applied." : "Discount removed." };
}

export async function setInvoiceNotes(invoiceId: string, notes: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.from("invoices").update({ notes: notes.trim() || null }).eq("id", invoiceId);
  if (error) return { message: dbErrorMessage(error) };
  return { ok: true };
}

export async function deleteDraft(invoiceId: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.from("invoices").delete().eq("id", invoiceId).eq("status", "draft");
  if (error) return { message: dbErrorMessage(error) };
  refresh();
  redirect("/billing?notice=deleted");
}

export type PaymentLine = { method: string; amount: number; reference?: string };

export async function checkout(invoiceId: string, payments: PaymentLine[], payLater: { promised_date: string; reason: string; priority?: string } | null, key: string): Promise<FormState & { number?: string }> {
  const me = await getCurrentStaff();
  if (!me?.can("billing.create")) return { message: "You don't have permission to take payments." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checkout_invoice", {
    p_id: invoiceId, p_payments: payments.filter((p) => p.amount > 0), p_pay_later: payLater, p_key: key,
  });
  if (error) return { message: moneyError(error) };
  refresh(invoiceId);
  revalidatePath("/billing/dues");
  return { ok: true, message: `Bill ${data} issued.`, number: data as string };
}

export async function recordPayment(input: { customer_id: string; amount: number; method: string; reference?: string; invoice_id?: string; key: string; notes?: string }): Promise<FormState> {
  await assertCan("billing.create");
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_payment", {
    p_customer: input.customer_id, p_amount: input.amount, p_method: input.method, p_key: input.key,
    p_invoice: input.invoice_id ?? null, p_reference: input.reference ?? null, p_auto: true, p_notes: input.notes ?? null,
  });
  if (error) return { message: moneyError(error) };
  if (input.invoice_id) refresh(input.invoice_id);
  revalidatePath(`/customers/${input.customer_id}`);
  revalidatePath("/billing/dues");
  return { ok: true, message: "Payment recorded." };
}

export async function applyCredit(invoiceId: string): Promise<FormState> {
  await assertCan("billing.create");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_credit", { p_invoice: invoiceId });
  if (error) return { message: moneyError(error) };
  refresh(invoiceId);
  return { ok: true, message: Number(data) > 0 ? `Rs. ${Number(data).toLocaleString("en-PK")} of advance used.` : "No advance available." };
}

export async function refundInvoice(invoiceId: string, amount: number, method: string, reason: string, key: string): Promise<FormState> {
  await assertCan("billing.refund");
  const supabase = await createClient();
  const { error } = await supabase.rpc("refund_payment", { p_invoice: invoiceId, p_amount: amount, p_method: method, p_reason: reason, p_key: key });
  if (error) return { message: moneyError(error) };
  refresh(invoiceId);
  return { ok: true, message: "Refund recorded." };
}

export async function voidInvoice(invoiceId: string, reason: string): Promise<FormState> {
  await assertCan("billing.void");
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_invoice", { p_id: invoiceId, p_reason: reason });
  if (error) return { message: moneyError(error) };
  refresh(invoiceId);
  return { ok: true, message: "Invoice voided. Stock returned." };
}

export async function returnItems(invoiceId: string, lines: { invoice_item_id: string; qty: number }[], reason: string, method: string | null, key: string): Promise<FormState> {
  const me = await getCurrentStaff();
  if (!me?.can("billing.refund") && !me?.can("pos.return")) return { message: "You don't have permission for returns." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("return_items", { p_invoice: invoiceId, p_lines: lines, p_reason: reason, p_refund_method: method, p_key: key });
  if (error) return { message: moneyError(error) };
  refresh(invoiceId);
  return { ok: true, message: "Return recorded." };
}
