"use server";

import { revalidatePath } from "next/cache";
import { assertCan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/validation";

export type RetailItem = { id: string; name: string; category: string | null; brand: string | null; sale_price: number; unit: string; track_stock: boolean; stock: number | null; barcode: string | null; sku: string | null };

export async function searchRetail(q: string): Promise<RetailItem[]> {
  await assertCan("pos.use");
  const term = q.replace(/[^\p{L}\p{N} .\-]/gu, "").trim();
  const supabase = await createClient();
  let query = supabase.from("catalog_items").select("id, name, category, brand, sale_price, unit, track_stock, barcode, sku")
    .eq("is_active", true).eq("is_retail", true).order("name").limit(40);
  if (term) query = query.or(`name.ilike.%${term}%,brand.ilike.%${term}%,category.ilike.%${term}%,barcode.eq.${term},sku.eq.${term}`);
  const { data } = await query;
  const ids = (data ?? []).filter((i) => i.track_stock).map((i) => i.id);
  const { data: levels } = ids.length ? await supabase.from("stock_levels").select("item_id, usable_qty").in("item_id", ids) : { data: [] };
  const stock = new Map((levels ?? []).map((l) => [l.item_id, Number(l.usable_qty)]));
  return (data ?? []).map((i) => ({ ...i, sale_price: Number(i.sale_price), stock: i.track_stock ? stock.get(i.id) ?? 0 : null }));
}

/** Exact barcode / SKU match for scanners. */
export async function findByCode(code: string): Promise<RetailItem | null> {
  const hits = await searchRetail(code);
  return hits.find((h) => h.barcode === code.trim() || h.sku === code.trim()) ?? null;
}

export async function posCheckout(input: {
  key: string; customer_id: string | null; pet_id: string | null;
  lines: { item_id: string; quantity: number; discount_amount?: number }[];
  payments: { method: string; amount: number; reference?: string }[];
  invoice_discount?: number; discount_reason?: string;
  pay_later?: { promised_date: string; reason: string } | null;
}): Promise<FormState & { invoiceId?: string }> {
  await assertCan("pos.use");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pos_checkout", {
    p_key: input.key, p_customer: input.customer_id, p_pet: input.pet_id, p_lines: input.lines,
    p_payments: input.payments.filter((p) => p.amount > 0), p_invoice_discount: input.invoice_discount ?? 0,
    p_discount_reason: input.discount_reason ?? null, p_pay_later: input.pay_later ?? null,
  });
  if (error) return { message: error.message };
  revalidatePath("/pos");
  revalidatePath("/billing");
  return { ok: true, invoiceId: data as string };
}
