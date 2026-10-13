"use server";

import { revalidatePath } from "next/cache";
import { assertCan, getCurrentStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/validation";

export type RetailItem = {
  id: string; name: string; category: string | null; brand: string | null; sale_price: number; unit: string; track_stock: boolean;
  stock: number | null; barcode: string | null; sku: string | null;
  /** Sizes of one product share a family ("Petline Kitten" → 400 g / 1.5 kg). */
  family_id: string | null; family_name: string | null; size_label: string | null; size_grams: number | null;
  /** "In the shop right now" — staff untick it when a size isn't available. */
  is_available: boolean;
  /** Price can be changed at the till (the list price is the starting point). */
  price_is_editable: boolean;
};

const RETAIL = "id, name, category, brand, sale_price, price_is_editable, unit, track_stock, barcode, sku, family_id, size_label, size_grams, is_available, product_families(name)";

export async function searchRetail(q: string): Promise<RetailItem[]> {
  await assertCan("pos.use");
  const term = q.replace(/[^\p{L}\p{N} .\-]/gu, "").trim();
  const supabase = await createClient();
  let query = supabase.from("catalog_items").select(RETAIL).eq("is_active", true).eq("is_retail", true).order("name").limit(60);
  if (term) query = query.or(`name.ilike.%${term}%,brand.ilike.%${term}%,category.ilike.%${term}%,barcode.eq.${term},sku.eq.${term}`);
  const { data: hits } = await query;
  // Show every size of a product that matched, so the size buttons are complete.
  const famIds = [...new Set((hits ?? []).map((i) => i.family_id).filter((f): f is string => !!f))];
  const { data: siblings } = famIds.length
    ? await supabase.from("catalog_items").select(RETAIL).eq("is_active", true).eq("is_retail", true).in("family_id", famIds)
    : { data: [] };
  const data = [...new Map([...(hits ?? []), ...(siblings ?? [])].map((i) => [i.id, i])).values()];
  const ids = data.filter((i) => i.track_stock).map((i) => i.id);
  const { data: levels } = ids.length ? await supabase.from("stock_levels").select("item_id, usable_qty").in("item_id", ids) : { data: [] };
  const stock = new Map((levels ?? []).map((l) => [l.item_id, Number(l.usable_qty)]));
  return data.map(({ product_families, ...i }) => ({
    ...i, sale_price: Number(i.sale_price), size_grams: i.size_grams == null ? null : Number(i.size_grams),
    family_name: (product_families as unknown as { name: string } | null)?.name ?? null,
    stock: i.track_stock ? stock.get(i.id) ?? 0 : null,
  }));
}

/** The pet store's best sellers over the last 30 days — one-tap buttons for quick walk-in sales. */
export async function popularRetail(limit = 8): Promise<RetailItem[]> {
  await assertCan("pos.use");
  const supabase = await createClient();
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data } = await supabase.from("invoice_items").select("item_id, quantity, invoices!inner(kind, status, issued_at)")
    .eq("invoices.kind", "store").eq("invoices.status", "issued").gte("invoices.issued_at", since).is("line_role", null).limit(3000);
  const sold = new Map<string, number>();
  for (const l of data ?? []) sold.set(l.item_id, (sold.get(l.item_id) ?? 0) + Number(l.quantity));
  const top = [...sold.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit * 2).map(([id]) => id);
  if (!top.length) return [];
  const { data: items } = await supabase.from("catalog_items").select(RETAIL).in("id", top).eq("is_active", true).eq("is_retail", true);
  const ids = (items ?? []).filter((i) => i.track_stock).map((i) => i.id);
  const { data: levels } = ids.length ? await supabase.from("stock_levels").select("item_id, usable_qty").in("item_id", ids) : { data: [] };
  const stock = new Map((levels ?? []).map((l) => [l.item_id, Number(l.usable_qty)]));
  return (items ?? []).map(({ product_families, ...i }) => ({
    ...i, sale_price: Number(i.sale_price), size_grams: i.size_grams == null ? null : Number(i.size_grams),
    family_name: (product_families as unknown as { name: string } | null)?.name ?? null,
    stock: i.track_stock ? stock.get(i.id) ?? 0 : null,
  })).sort((a, b) => top.indexOf(a.id) - top.indexOf(b.id)).slice(0, limit);
}

/** Exact barcode / SKU match for scanners. */
export async function findByCode(code: string): Promise<RetailItem | null> {
  const hits = await searchRetail(code);
  return hits.find((h) => h.barcode === code.trim() || h.sku === code.trim()) ?? null;
}

export async function posCheckout(input: {
  key: string; customer_id: string | null; pet_id: string | null;
  lines: { item_id: string; quantity: number; discount_amount?: number; unit_price?: number }[];
  payments: { method: string; amount: number; reference?: string }[];
  invoice_discount?: number; discount_reason?: string;
  pay_later?: { promised_date: string; reason: string } | null;
  /** Home delivery: address for this order + delivery charge (its own bill line). */
  delivery?: { address: string; charge: number; notes?: string } | null;
  /** A walk-in's name, typed at the counter (kept on the bill, no customer record). */
  walk_in_name?: string | null;
}): Promise<FormState & { invoiceId?: string }> {
  await assertCan("pos.use");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pos_checkout", {
    p_key: input.key, p_customer: input.customer_id, p_pet: input.pet_id, p_lines: input.lines,
    p_payments: input.payments.filter((p) => p.amount > 0), p_invoice_discount: input.invoice_discount ?? 0,
    p_discount_reason: input.discount_reason ?? null, p_pay_later: input.pay_later ?? null,
    p_delivery: input.delivery ?? null, p_walk_in_name: input.customer_id ? null : input.walk_in_name?.trim() || null,
  });
  if (error) return { message: error.message };
  revalidatePath("/pos");
  revalidatePath("/billing");
  if (input.delivery) revalidatePath("/pos/deliveries");
  return { ok: true, invoiceId: data as string };
}

/** Dispatch / deliver / re-price a home delivery order (rules enforced by public.update_delivery). */
export async function updateDelivery(invoiceId: string, patch: {
  status?: "pending" | "dispatched" | "delivered"; charge?: number; address?: string; rider?: string; note?: string;
}): Promise<FormState> {
  const me = await getCurrentStaff();
  if (!me?.can("pos.use") && !me?.can("billing.create")) return { message: "You don't have permission to update deliveries." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_delivery", {
    p_invoice: invoiceId, p_status: patch.status ?? null, p_charge: patch.charge ?? null,
    p_address: patch.address ?? null, p_rider: patch.rider ?? null, p_note: patch.note ?? null,
  });
  if (error) return { message: error.message };
  revalidatePath("/pos/deliveries");
  revalidatePath(`/billing/${invoiceId}`);
  return { ok: true, message: patch.status === "delivered" ? "Marked as delivered." : patch.status === "dispatched" ? "Out for delivery." : "Delivery updated." };
}

/** Rider is back with the cash: record the payment on the order, then mark it delivered (both safe to repeat). */
export async function collectAndDeliver(invoiceId: string, customerId: string, payment: { amount: number; method: string; reference?: string } | null, key: string): Promise<FormState> {
  const me = await getCurrentStaff();
  if (!me?.can("pos.use") && !me?.can("billing.create")) return { message: "You don't have permission to update deliveries." };
  const supabase = await createClient();
  if (payment && payment.amount > 0) {
    const { error } = await supabase.rpc("record_payment", {
      p_customer: customerId, p_amount: payment.amount, p_method: payment.method, p_key: key,
      p_invoice: invoiceId, p_reference: payment.reference ?? null, p_auto: false, p_notes: "Collected on delivery",
    });
    if (error) return { message: error.message };
  }
  const r = await updateDelivery(invoiceId, { status: "delivered" });
  if (!r.ok) return r;
  revalidatePath("/billing/dues");
  revalidatePath(`/customers/${customerId}`);
  return { ok: true, message: payment?.amount ? "Cash recorded — order delivered." : "Marked as delivered." };
}

/** Cancel a pet-store / delivery order: refund what was paid, put the stock back, keep it as Cancelled. Reason optional. */
export async function cancelOrder(invoiceId: string, reason: string, refundMethod: string | null, key: string): Promise<FormState> {
  const me = await getCurrentStaff();
  if (!me?.can("pos.use") && !me?.can("billing.void")) return { message: "You don't have permission to cancel orders." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_order", { p_invoice: invoiceId, p_reason: reason.trim() || null, p_refund_method: refundMethod, p_key: key });
  if (error) return { message: error.message };
  revalidatePath("/pos/deliveries");
  revalidatePath(`/billing/${invoiceId}`);
  revalidatePath("/billing");
  revalidatePath("/pos");
  return { ok: true, message: "Order cancelled — stock is back and any payment was refunded." };
}
