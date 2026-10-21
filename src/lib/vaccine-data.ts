import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BilledVaccine, DueRow, ProtocolOption, VaccinationRow, VaccineOption } from "@/app/(app)/visits/[id]/vaccines-panel";

/**
 * Everything the vaccines panel needs for one pet (used on the pet page): the vaccines for its
 * species, approved schedules, its full vaccination history, what is due — and vaccines that were
 * billed for this pet but never written into its history (so they can be added in one tap).
 */
export async function petVaccineData(petId: string, speciesId: string) {
  const supabase = await createClient();
  const [vaccinesQ, protocolsQ, historyQ, dueQ, staffQ, petBills, visitsQ] = await Promise.all([
    supabase.from("vaccines").select("id, name, protects_against, default_route, default_manufacturer, species_ids").eq("is_active", true).order("name"),
    supabase.from("vaccination_protocols").select("id, name, species_id, booster_interval_days, vaccination_protocol_steps(step_no, label, vaccine_id, days_after_previous)")
      .eq("is_approved", true).eq("is_active", true),
    supabase.from("vaccinations").select("id, vaccine_id, vaccine_name, administered_at, batch_no, next_due_date, administered_by, voided_at, void_reason, visit_id")
      .eq("pet_id", petId).order("administered_at", { ascending: false }),
    supabase.from("due_items").select("id, title, due_on, kind").eq("pet_id", petId).eq("status", "pending").order("due_on"),
    supabase.from("staff").select("id, full_name"),
    supabase.from("invoices").select("id").eq("pet_id", petId).eq("status", "issued"),
    supabase.from("visits").select("id").eq("pet_id", petId),
  ]);
  const names = new Map((staffQ.data ?? []).map((s) => [s.id, s.full_name]));
  const vaccines = ((vaccinesQ.data ?? []) as (VaccineOption & { species_ids: string[] })[])
    .filter((v) => !v.species_ids.length || v.species_ids.includes(speciesId));
  const protocols: ProtocolOption[] = (protocolsQ.data ?? [])
    .filter((p) => !p.species_id || p.species_id === speciesId)
    .map((p) => ({ id: p.id, name: p.name, booster_interval_days: p.booster_interval_days,
      steps: ((p.vaccination_protocol_steps ?? []) as ProtocolOption["steps"]).sort((a, b) => a.step_no - b.step_no) }));
  const rows = historyQ.data ?? [];
  const history: VaccinationRow[] = rows.map((h) => ({ ...h, administered_by_name: h.administered_by ? names.get(h.administered_by) ?? null : null }));

  // Bills for this pet (directly, or through its visits) that include a vaccine from the price list.
  const visitIds = (visitsQ.data ?? []).map((v) => v.id);
  const viaVisits = visitIds.length
    ? (await supabase.from("invoices").select("id").in("visit_id", visitIds).eq("status", "issued")).data ?? [] : [];
  const billIds = [...new Set([...(petBills.data ?? []), ...viaVisits].map((b) => b.id))];
  const billed: BilledVaccine[] = [];
  if (billIds.length) {
    const { data: lines } = await supabase.from("invoice_items")
      .select("id, description, catalog_items!inner(vaccine_id), invoices!inner(number, issued_at)")
      .in("invoice_id", billIds).not("catalog_items.vaccine_id", "is", null);
    const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
    for (const l of lines ?? []) {
      const vaccineId = (l.catalog_items as unknown as { vaccine_id: string }).vaccine_id;
      const inv = l.invoices as unknown as { number: string; issued_at: string };
      const date = day(inv.issued_at);
      // Already in the history if the same vaccine was recorded within a week of the bill.
      const recorded = rows.some((h) => !h.voided_at && h.vaccine_id === vaccineId
        && Math.abs(new Date(day(h.administered_at)).getTime() - new Date(date).getTime()) <= 7 * 86400000);
      if (!recorded) billed.push({ key: l.id, vaccine_id: vaccineId, name: l.description, date, bill_no: inv.number });
    }
  }
  return { vaccines, protocols, history, due: (dueQ.data ?? []) as DueRow[], billed };
}
