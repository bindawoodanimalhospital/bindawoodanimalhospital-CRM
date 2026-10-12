"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, type FormState } from "@/lib/validation";

async function canManage() {
  const me = await getCurrentStaff();
  return !!(me?.can("inventory.manage") || me?.can("settings.manage"));
}
const refresh = (...paths: string[]) => { for (const p of ["/inventory", "/pos", ...paths]) revalidatePath(p); };

/** Group existing products as the sizes of one product (new family, or add to an existing one). */
export async function groupSizes(name: string, items: { id: string; size_label: string }[], familyId?: string): Promise<FormState> {
  if (!(await canManage())) return { message: "You don't have permission." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("group_sizes", { p_name: name, p_items: items, p_family: familyId ?? null });
  if (error) return { message: error.message };
  refresh("/inventory/sizes", ...items.map((i) => `/inventory/${i.id}`));
  return { ok: true, message: `${items.length} sizes grouped as “${name}”.` };
}

/** "In the shop right now" — untick when a size runs out or isn't stocked this month. */
export async function setAvailable(id: string, available: boolean): Promise<FormState> {
  if (!(await canManage())) return { message: "You don't have permission." };
  const supabase = await createClient();
  const { error } = await supabase.from("catalog_items").update({ is_available: available }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  refresh(`/inventory/${id}`);
  return { ok: true, message: available ? "Marked available." : "Marked not available — hidden from sale." };
}

/** Take one item out of its size group (the item itself stays on the price list). */
export async function removeFromFamily(id: string): Promise<FormState> {
  if (!(await canManage())) return { message: "You don't have permission." };
  const supabase = await createClient();
  const { error } = await supabase.from("catalog_items").update({ family_id: null, size_label: null }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  refresh(`/inventory/${id}`);
  return { ok: true, message: "Removed from the size group." };
}

/** Rename a size or change its label ("1.5 kg"). */
export async function setSizeLabel(id: string, label: string): Promise<FormState> {
  if (!(await canManage())) return { message: "You don't have permission." };
  if (!label.trim()) return { message: "Enter the size, e.g. 1.5 kg." };
  const supabase = await createClient();
  const { error } = await supabase.from("catalog_items").update({ size_label: label.trim() }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  refresh(`/inventory/${id}`);
  return { ok: true, message: "Size updated." };
}

export type NewSize = { size_label: string; sale_price: number; barcode?: string; stock?: number };

/** Add one more size to a product: copies the family's details from an existing size. */
export async function addSize(familyId: string, size: NewSize): Promise<FormState & { id?: string }> {
  if (!(await canManage())) return { message: "You don't have permission." };
  if (!size.size_label.trim()) return { message: "Enter the size, e.g. 4 kg." };
  if (!(size.sale_price >= 0)) return { message: "Enter the price." };
  const supabase = await createClient();
  const [{ data: fam }, { data: sib }] = await Promise.all([
    supabase.from("product_families").select("id, name").eq("id", familyId).maybeSingle(),
    supabase.from("catalog_items").select("kind, category, brand, unit, is_retail, tax_rate").eq("family_id", familyId).limit(1).maybeSingle(),
  ]);
  if (!fam) return { message: "Product not found." };
  const { data, error } = await supabase.from("catalog_items").insert({
    kind: sib?.kind ?? "product", category: sib?.category ?? null, brand: sib?.brand ?? null, unit: sib?.unit ?? "pcs",
    is_retail: sib?.is_retail ?? true, tax_rate: sib?.tax_rate ?? 0,
    name: `${fam.name} ${size.size_label.trim()}`, size_label: size.size_label.trim(), family_id: familyId,
    sale_price: size.sale_price, barcode: size.barcode?.trim() || null,
  }).select("id").single();
  if (error) return { message: error.code === "23505" ? "Another item already uses this barcode." : dbErrorMessage(error) };
  refresh();
  return { ok: true, message: `${size.size_label} added.`, id: data.id };
}

/** New product that comes in several sizes, created in one go. */
export async function createSizedProduct(input: {
  name: string; category: string; brand: string; unit: string; is_retail: boolean; sizes: NewSize[];
}): Promise<FormState & { id?: string }> {
  if (!(await canManage())) return { message: "You don't have permission." };
  const name = input.name.trim();
  const sizes = input.sizes.filter((s) => s.size_label.trim());
  if (name.length < 2) return { message: "Give the product a name." };
  if (sizes.length < 1) return { message: "Add at least one size." };
  if (sizes.some((s) => !(s.sale_price >= 0))) return { message: "Every size needs a price." };
  if (new Set(sizes.map((s) => s.size_label.trim().toLowerCase())).size !== sizes.length) return { message: "Two sizes have the same label." };
  const supabase = await createClient();
  const { data: fam, error: famErr } = await supabase.from("product_families")
    .insert({ name, category: input.category.trim() || null, brand: input.brand.trim() || null }).select("id").single();
  if (famErr) return { message: dbErrorMessage(famErr) };
  const me = await getCurrentStaff();
  const { data: rows, error } = await supabase.from("catalog_items").insert(sizes.map((s) => ({
    kind: "product", name: `${name} ${s.size_label.trim()}`, category: input.category.trim() || null, brand: input.brand.trim() || null,
    unit: input.unit.trim() || "pcs", is_retail: input.is_retail, sale_price: s.sale_price, barcode: s.barcode?.trim() || null,
    family_id: fam.id, size_label: s.size_label.trim(),
  }))).select("id, size_label");
  if (error) {
    await supabase.from("product_families").delete().eq("id", fam.id);
    return { message: error.code === "23505" ? "Another item already uses one of these barcodes." : dbErrorMessage(error) };
  }
  // "In stock now" per size → opening stock (only for staff allowed to change stock).
  if (me?.can("inventory.adjust")) {
    for (const r of rows ?? []) {
      const qty = sizes.find((s) => s.size_label.trim() === r.size_label)?.stock ?? 0;
      if (qty > 0) await supabase.rpc("add_stock", { p_item: r.id, p_qty: qty, p_note: "Opening stock" });
    }
  }
  refresh();
  return { ok: true, message: `${name} added with ${sizes.length} size${sizes.length === 1 ? "" : "s"}.`, id: rows?.[0]?.id };
}
