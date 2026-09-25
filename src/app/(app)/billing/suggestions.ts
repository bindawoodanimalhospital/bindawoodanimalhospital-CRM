import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Suggestion = {
  key: string; item_id: string; name: string; quantity: number; unit_price: number; reason: string;
  source_table: string; source_id: string; kind: "service" | "product";
};

/**
 * What happened in this visit that isn't billed yet, matched to price-list items.
 * Suggestions only — reception ticks what to charge. Items with price 0 are still shown so nothing is forgotten.
 */
export async function visitSuggestions(visitId: string): Promise<{ suggestions: Suggestion[]; unmatched: string[] }> {
  const supabase = await createClient();
  const [{ data: visit }, { data: catalog }, { data: billed }] = await Promise.all([
    supabase.from("visits").select("id, visit_type_id, pet_id").eq("id", visitId).single(),
    supabase.from("catalog_items").select("id, name, kind, sale_price, appointment_type_id, vaccine_id, medicine_id, diagnostic_type_id, procedure_id, is_ward_daily_fee").eq("is_active", true),
    supabase.from("invoice_items").select("source_table, source_id, invoices!inner(status, visit_id)").eq("invoices.visit_id", visitId).neq("invoices.status", "void"),
  ]);
  if (!visit) return { suggestions: [], unmatched: [] };
  const already = new Set((billed ?? []).map((b) => `${b.source_table}:${b.source_id}`));
  const items = catalog ?? [];
  const find = (pred: (c: (typeof items)[number]) => boolean) => items.find(pred);
  const out: Suggestion[] = [];
  const unmatched: string[] = [];
  const push = (source_table: string, source_id: string, item: (typeof items)[number] | undefined, quantity: number, reason: string, label: string) => {
    if (already.has(`${source_table}:${source_id}`)) return;
    if (!item) { unmatched.push(label); return; }
    out.push({ key: `${source_table}:${source_id}`, item_id: item.id, name: item.name, quantity, unit_price: Number(item.sale_price),
      reason, source_table, source_id, kind: item.kind });
  };

  const [vacc, dx, rx, sx, adm] = await Promise.all([
    supabase.from("vaccinations").select("id, vaccine_id, vaccine_name").eq("visit_id", visitId).is("voided_at", null),
    supabase.from("diagnostic_orders").select("id, type_id, diagnostic_types(name)").eq("visit_id", visitId).neq("status", "cancelled"),
    supabase.from("prescription_items").select("id, medicine_id, medicine_name, quantity, prescriptions!inner(visit_id, status)")
      .eq("prescriptions.visit_id", visitId).eq("prescriptions.status", "issued"),
    supabase.from("surgeries").select("id, procedure_id, procedure_name, surgery_consumables(id, product_id, item_name, quantity)").eq("visit_id", visitId).neq("status", "cancelled"),
    supabase.from("admissions").select("id, admitted_at, discharged_at, status").eq("visit_id", visitId).neq("status", "cancelled"),
  ]);

  if (visit.visit_type_id) {
    push("visits", visit.id, find((c) => c.appointment_type_id === visit.visit_type_id), 1, "Visit fee", "Visit fee (no price set for this visit type)");
  }
  for (const v of vacc.data ?? []) push("vaccinations", v.id, find((c) => c.vaccine_id === v.vaccine_id), 1, "Vaccine given", v.vaccine_name);
  for (const d of dx.data ?? []) push("diagnostic_orders", d.id, find((c) => c.diagnostic_type_id === d.type_id), 1, "Test",
    (d.diagnostic_types as unknown as { name: string }).name);
  for (const r of rx.data ?? []) {
    if (!r.medicine_id) continue;                         // free-text medicines: owner may buy them outside
    const item = find((c) => c.medicine_id === r.medicine_id);
    if (!item) continue;
    const qty = Number(String(r.quantity ?? "").match(/[\d.]+/)?.[0] ?? 1) || 1;
    push("prescription_items", r.id, item, qty, "Prescribed & given from clinic stock", r.medicine_name);
  }
  for (const s of sx.data ?? []) {
    push("surgeries", s.id, find((c) => c.procedure_id === s.procedure_id), 1, "Surgery", s.procedure_name);
    for (const m of (s.surgery_consumables ?? []) as { id: string; product_id: string | null; item_name: string; quantity: number }[]) {
      if (m.product_id) push("surgery_consumables", m.id, find((c) => c.id === m.product_id), Number(m.quantity), "Surgery material", m.item_name);
    }
  }
  for (const a of adm.data ?? []) {
    const end = a.discharged_at ? new Date(a.discharged_at) : new Date();
    const days = Math.max(1, Math.ceil((end.getTime() - new Date(a.admitted_at).getTime()) / 86400_000));
    push("admissions", a.id, find((c) => c.is_ward_daily_fee), days, `Ward stay (${days} day${days > 1 ? "s" : ""})`, "Ward stay");
  }
  return { suggestions: out, unmatched };
}
