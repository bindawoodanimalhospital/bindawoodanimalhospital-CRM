"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertCan, getCurrentStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, type FormState } from "@/lib/validation";

const refresh = (id?: string) => { revalidatePath("/inventory"); if (id) revalidatePath(`/inventory/${id}`); };
const opt = z.string().trim().optional().transform((v) => v || null);

const itemSchema = z.object({
  kind: z.enum(["service", "product"]),
  name: z.string().trim().min(2, "Name is required"),
  category: opt, brand: opt, sku: opt, barcode: opt,
  unit: z.string().trim().default("pcs").transform((v) => v || "pcs"),
  sale_price: z.coerce.number().min(0, "Price can't be negative"),
  price_is_editable: z.preprocess((v) => v === "on" || v === true, z.boolean()),
  tax_rate: z.coerce.number().min(0).max(100).default(0),
  track_stock: z.preprocess((v) => v === "on" || v === true, z.boolean()),
  reorder_level: z.union([z.literal(""), z.coerce.number().min(0)]).optional().transform((v) => (v === "" || v == null ? null : v)),
  is_retail: z.preprocess((v) => v === "on" || v === true, z.boolean()),
  is_active: z.preprocess((v) => v !== "off" && v !== false, z.boolean()).default(true),
  vaccine_id: opt, medicine_id: opt, notes: opt,
});

export async function saveItem(id: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const me = await getCurrentStaff();
  if (!me?.can("inventory.manage") && !me?.can("settings.manage")) return { message: "You don't have permission." };
  const raw = Object.fromEntries(fd) as Record<string, string>;
  // Unticked checkboxes send nothing; the hidden marker tells us the "active" box was on the form.
  const is_active = raw.is_active_present ? (raw.is_active === "on" ? "on" : "off") : "on";
  const clean = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v === "none" ? "" : v]));
  const parsed = itemSchema.safeParse({ ...clean, is_active });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[i.path.join(".")] ??= i.message;
    return { errors, message: "Please fix the highlighted fields." };
  }
  const row = { ...parsed.data, track_stock: parsed.data.kind === "product" && parsed.data.track_stock };
  const supabase = await createClient();
  if (id) {
    // Turning stock tracking on only makes sense once the opening count is entered.
    const { error } = await supabase.from("catalog_items").update(row).eq("id", id);
    if (error) return { message: error.code === "23505" ? "Another item already uses this SKU or barcode." : dbErrorMessage(error) };
    refresh(id);
    return { ok: true, message: "Saved." };
  }
  const { data, error } = await supabase.from("catalog_items").insert(row).select("id").single();
  if (error) return { message: error.code === "23505" ? "Another item already uses this SKU or barcode." : dbErrorMessage(error) };
  // "How many do you have now?" on the new-item form → opening stock in the same step.
  const opening = Number(String(raw.opening_qty ?? "").replace(/[^\d.]/g, ""));
  if (parsed.data.kind === "product" && opening > 0 && me.can("inventory.adjust")) {
    await supabase.rpc("add_stock", { p_item: data.id, p_qty: opening, p_note: "Opening stock" });
  }
  refresh();
  redirect(`/inventory/${data.id}?notice=created`);
}

export async function quickPrice(id: string, price: number): Promise<FormState> {
  const me = await getCurrentStaff();
  if (!me?.can("inventory.manage") && !me?.can("settings.manage")) return { message: "You don't have permission." };
  if (!(price >= 0)) return { message: "Enter a valid price." };
  const supabase = await createClient();
  const { error } = await supabase.from("catalog_items").update({ sale_price: price }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  refresh();
  return { ok: true, message: "Price updated." };
}

/** Opening stock / found stock: a new batch plus a positive adjustment (needs inventory.adjust). */
export async function addStockCount(itemId: string, input: { location_id: string; batch_no: string; expiry_date: string; qty: number; reason: string }): Promise<FormState> {
  await assertCan("inventory.adjust");
  if (!(input.qty > 0)) return { message: "Enter the quantity counted." };
  const supabase = await createClient();
  const batch = input.batch_no.trim();
  const expiry = input.expiry_date || null;
  let q = supabase.from("product_batches").select("id").eq("item_id", itemId).eq("location_id", input.location_id).eq("batch_no", batch);
  q = expiry ? q.eq("expiry_date", expiry) : q.is("expiry_date", null);
  let { data: b } = await q.maybeSingle();
  if (!b) {
    const ins = await supabase.from("product_batches").insert({ item_id: itemId, location_id: input.location_id, batch_no: batch, expiry_date: expiry }).select("id").single();
    if (ins.error) return { message: dbErrorMessage(ins.error) };
    b = ins.data;
  }
  const { error } = await supabase.rpc("adjust_stock", { p_batch: b.id, p_qty_change: input.qty, p_kind: "adjust", p_reason: input.reason.trim() || "Opening stock count" });
  if (error) return { message: error.message };
  refresh(itemId);
  return { ok: true, message: "Stock added." };
}

export async function adjustBatch(itemId: string, batchId: string, change: number, kind: "adjust" | "wastage" | "expired" | "return_to_supplier", reason: string): Promise<FormState> {
  await assertCan("inventory.adjust");
  if (!change) return { message: "Enter the change in quantity." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("adjust_stock", { p_batch: batchId, p_qty_change: change, p_kind: kind, p_reason: reason });
  if (error) return { message: error.message };
  refresh(itemId);
  return { ok: true, message: "Stock updated." };
}

export async function transferBatch(itemId: string, batchId: string, qty: number, toLocation: string): Promise<FormState> {
  await assertCan("inventory.manage");
  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_stock", { p_batch: batchId, p_qty: qty, p_to_location: toLocation, p_reason: null });
  if (error) return { message: error.message };
  refresh(itemId);
  return { ok: true, message: "Moved." };
}

/** "I'm adding N pieces" — one step; switches stock tracking on. Batch and expiry are optional. */
export async function addStock(itemId: string, input: { qty: number; location_id?: string; batch_no?: string; expiry_date?: string; note?: string }): Promise<FormState> {
  await assertCan("inventory.adjust");
  if (!(input.qty > 0)) return { message: "Enter how many you are adding." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_stock", {
    p_item: itemId, p_qty: input.qty, p_location: input.location_id || null,
    p_batch_no: input.batch_no?.trim() || null, p_expiry: input.expiry_date || null, p_note: input.note?.trim() || null,
  });
  if (error) return { message: error.message };
  refresh(itemId);
  revalidatePath("/pos");
  return { ok: true, message: `${input.qty} added to stock.` };
}

/** Shelf count: "there are N on the shelf now" for one or many items. */
export async function saveCounts(counts: { item_id: string; count: number }[], note?: string): Promise<FormState> {
  await assertCan("inventory.adjust");
  const clean = counts.filter((c) => Number.isFinite(c.count) && c.count >= 0);
  if (!clean.length) return { message: "Type at least one count." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_stock_counts", { p_counts: clean, p_note: note?.trim() || null });
  if (error) return { message: error.message };
  refresh();
  revalidatePath("/inventory/count");
  revalidatePath("/pos");
  for (const c of clean) revalidatePath(`/inventory/${c.item_id}`);
  const n = Number(data ?? 0);
  return { ok: true, message: n ? `Saved — ${n} item${n === 1 ? "" : "s"} updated.` : "Saved — nothing changed." };
}

/** Delete an item that was never used (no bills, stock or history). Used items can only be hidden. */
export async function deleteItem(id: string, reason: string): Promise<FormState> {
  const me = await getCurrentStaff();
  if (!me?.can("inventory.manage") && !me?.can("settings.manage")) return { message: "You don't have permission." };
  const supabase = await createClient();
  const { data: item } = await supabase.from("catalog_items").select("name").eq("id", id).maybeSingle();
  const { error } = await supabase.rpc("delete_unused_item", { p_item: id, p_reason: reason.trim() || null });
  if (error) return { message: error.message };
  refresh();
  revalidatePath("/pos");
  return { ok: true, message: `${item?.name ?? "Item"} deleted.` };
}

/** Correct a batch's expiry date / batch no., or split its quantity across several expiry dates. */
export async function setBatchDetails(itemId: string, batchId: string, parts: { qty: number; expiry: string; batch_no: string }[], reason: string): Promise<FormState> {
  await assertCan("inventory.adjust");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_batch_details", {
    p_batch: batchId, p_parts: parts.map((p) => ({ qty: p.qty, expiry: p.expiry || null, batch_no: p.batch_no.trim() })), p_reason: reason.trim() || null,
  });
  if (error) return { message: error.message };
  refresh(itemId);
  revalidatePath("/inventory/expiry");
  revalidatePath("/pos");
  return { ok: true, message: parts.length > 1 ? `Split into ${parts.length} expiry dates.` : "Saved." };
}
