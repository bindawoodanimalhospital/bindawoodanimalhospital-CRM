"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan, getCurrentStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, type FormState } from "@/lib/validation";
import { todayPK } from "@/lib/format";

const refresh = (visitId: string) => revalidatePath(`/visits/${visitId}`);

// ---------------------------------------------------------------------------- Consultation

export async function startConsultation(visitId: string, templateKey: string): Promise<FormState & { id?: string }> {
  await assertCan("clinical.create");
  const supabase = await createClient();
  const { data: visit } = await supabase.from("visits").select("id, pet_id, reason, doctor_id").eq("id", visitId).single();
  if (!visit) return { message: "Visit not found." };
  const me = await getCurrentStaff();
  const { data, error } = await supabase.from("consultations").insert({
    visit_id: visit.id, pet_id: visit.pet_id, template_key: templateKey, chief_complaint: visit.reason,
    doctor_id: me?.isDoctor ? me.id : visit.doctor_id,
  }).select("id").single();
  if (error) return { message: dbErrorMessage(error) };
  refresh(visitId);
  return { ok: true, id: data.id };
}

const num = (min: number, max: number) =>
  z.union([z.literal(""), z.null(), z.coerce.number().min(min).max(max)]).optional()
    .transform((v) => (v === "" || v == null ? null : v));
const text = z.string().max(20000).nullable().optional().transform((v) => (v?.trim() ? v : null));

const consultationPatch = z.object({
  template_key: z.string().max(50).optional(),
  chief_complaint: text, history: text,
  temperature_c: num(25, 45), heart_rate: num(10, 400), resp_rate: num(2, 200), weight_kg: num(0.001, 1999),
  mucous_membranes: text, crt_seconds: num(0, 10), hydration: text,
  body_condition_score: num(1, 9), pain_score: num(0, 10),
  exam: z.record(z.string().max(100), z.string().max(2000)).optional(),
  observations: text, assessment: text, treatment: text, medicines_administered: text,
  follow_up_plan: text,
  follow_up_date: z.string().nullable().optional().transform((v) => v || null),
  doctor_notes: text,
}).partial();

export type ConsultationPatch = z.input<typeof consultationPatch>;

/** Autosave for drafts. RLS + the lock trigger reject writes to finalized records. */
export async function saveConsultation(id: string, patch: ConsultationPatch): Promise<FormState> {
  const parsed = consultationPatch.safeParse(patch);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Invalid value" };
  const supabase = await createClient();
  const { error } = await supabase.from("consultations").update(parsed.data).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  return { ok: true };
}

export async function setDiagnoses(visitId: string, consultationId: string,
  items: { label: string; certainty: string; is_primary: boolean }[]): Promise<FormState> {
  const clean = items.map((d) => ({ ...d, label: d.label.trim() })).filter((d) => d.label).slice(0, 20);
  const supabase = await createClient();
  const { error: delErr } = await supabase.from("consultation_diagnoses").delete().eq("consultation_id", consultationId);
  if (delErr) return { message: dbErrorMessage(delErr) };
  if (clean.length) {
    const { error } = await supabase.from("consultation_diagnoses").insert(clean.map((d) => ({
      consultation_id: consultationId, label: d.label,
      certainty: ["provisional", "confirmed", "ruled_out"].includes(d.certainty) ? d.certainty : "provisional",
      is_primary: d.is_primary,
    })));
    if (error) return { message: dbErrorMessage(error) };
  }
  refresh(visitId);
  return { ok: true };
}

export async function finalizeConsultation(visitId: string, id: string): Promise<FormState> {
  await assertCan("clinical.finalize");
  const supabase = await createClient();
  const { error } = await supabase.rpc("finalize_consultation", { p_id: id });
  if (error) return { message: dbErrorMessage(error) };
  refresh(visitId);
  return { ok: true, message: "Record finalized and locked." };
}

export async function reopenConsultation(visitId: string, id: string, reason: string): Promise<FormState> {
  await assertCan("clinical.reopen");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_consultation", { p_id: id, p_reason: reason });
  if (error) return { message: dbErrorMessage(error) };
  refresh(visitId);
  return { ok: true, message: "Reopened for correction. The previous version is kept." };
}

// ---------------------------------------------------------------------------- Vaccinations

const vaccinationSchema = z.object({
  visit_id: z.uuid().nullable(),
  pet_id: z.uuid(),
  vaccine_id: z.uuid("Choose the vaccine"),
  manufacturer: text, batch_no: text,
  expiry_date: z.string().nullable().optional().transform((v) => v || null),
  dose: text, route: text, site: text,
  protocol_id: z.string().nullable().optional().transform((v) => v || null),
  protocol_step: z.coerce.number().int().positive().nullable().optional(),
  next_due_date: z.string().nullable().optional().transform((v) => v || null),
  next_due_label: text,
  adverse_reaction: text, notes: text,
  /** Given earlier (before the CRM or elsewhere): the date. Not part of a visit. */
  given_on: z.string().optional().transform((v) => v || null),
});
export type VaccinationInput = z.input<typeof vaccinationSchema>;

export async function recordVaccination(input: VaccinationInput): Promise<FormState> {
  await assertCan("vaccinations.manage");
  const parsed = vaccinationSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message };
  // Batch and vial expiry are recommended, not required — a missing label must never stop the record.
  const { given_on, ...row } = parsed.data;
  if (given_on && (!/^\d{4}-\d{2}-\d{2}$/.test(given_on) || given_on > todayPK())) return { message: "Enter the date it was given (today or earlier)." };
  if (given_on && row.next_due_date && row.next_due_date <= given_on) return { message: "The next dose must be after the date it was given." };
  if (!given_on && !row.visit_id) return { message: "Enter the date it was given." };
  const supabase = await createClient();
  const { data: vaccine } = await supabase.from("vaccines").select("name").eq("id", row.vaccine_id).single();
  if (!vaccine) return { message: "Vaccine not found." };
  const { error } = await supabase.from("vaccinations").insert({
    ...row, vaccine_name: vaccine.name,
    ...(given_on ? { visit_id: null, administered_at: `${given_on}T12:00:00+05:00`, administered_by: null, batch_no: null, expiry_date: null,
      notes: row.notes ?? "Given earlier (before the CRM or elsewhere)" } : {}),
  });
  if (error) {
    if (error.code === "23514" && error.message.includes("expiry")) return { message: "This batch is expired — don't use it." };
    if (error.code === "23514" && error.message.includes("next_due")) return { message: "The next dose must be after the date it was given." };
    return { message: dbErrorMessage(error) };
  }
  if (row.visit_id) refresh(row.visit_id);
  revalidatePath(`/pets/${row.pet_id}`);
  revalidatePath("/due");
  return { ok: true, message: given_on ? `${vaccine.name} added to the history.` : `${vaccine.name} recorded.` };
}

export async function voidVaccination(visitId: string | null, id: string, reason: string, petId?: string): Promise<FormState> {
  await assertCan("vaccinations.manage");
  if (reason.trim().length < 3) return { message: "Give a reason." };
  const supabase = await createClient();
  const { error } = await supabase.from("vaccinations")
    .update({ voided_at: new Date().toISOString(), void_reason: reason.trim() }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  if (visitId) refresh(visitId);
  if (petId) revalidatePath(`/pets/${petId}`);
  return { ok: true, message: "Marked as entered by mistake." };
}

// ---------------------------------------------------------------------------- Prescriptions

export async function createPrescription(visitId: string, petId: string, consultationId: string | null): Promise<FormState> {
  await assertCan("prescriptions.manage");
  const supabase = await createClient();
  const { error } = await supabase.from("prescriptions").insert({ visit_id: visitId, pet_id: petId, consultation_id: consultationId });
  if (error) return { message: dbErrorMessage(error) };
  refresh(visitId);
  return { ok: true };
}

const rxItemSchema = z.object({
  medicine_id: z.string().nullable().optional().transform((v) => v || null),
  medicine_name: z.string().trim().min(1, "Medicine name is required"),
  strength: text, form: text,
  dose: z.string().trim().min(1, "Dose is required (e.g. 1 tablet)"),
  frequency: z.string().trim().min(1, "How often? (e.g. twice a day)"),
  duration: text, route: text, quantity: text, instructions: text,
  save_to_catalog: z.boolean().optional(),
});
export type RxItemInput = z.input<typeof rxItemSchema>;

export async function addRxItem(visitId: string, prescriptionId: string, input: RxItemInput): Promise<FormState> {
  await assertCan("prescriptions.manage");
  const parsed = rxItemSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message };
  const { save_to_catalog, ...item } = parsed.data;
  const supabase = await createClient();
  if (save_to_catalog && !item.medicine_id) {
    // Find-or-insert (doctors may add to the catalogue but not edit existing entries).
    let lookup = supabase.from("medicines").select("id").ilike("name", item.medicine_name);
    lookup = item.strength ? lookup.eq("strength", item.strength) : lookup.is("strength", null);
    const { data: existing } = await lookup.limit(1).maybeSingle();
    if (existing) item.medicine_id = existing.id;
    else {
      const { data: med } = await supabase.from("medicines")
        .insert({ name: item.medicine_name, strength: item.strength, form: item.form, default_route: item.route })
        .select("id").maybeSingle();
      if (med) item.medicine_id = med.id;
    }
  }
  const { count } = await supabase.from("prescription_items").select("id", { count: "exact", head: true }).eq("prescription_id", prescriptionId);
  const { error } = await supabase.from("prescription_items").insert({ ...item, prescription_id: prescriptionId, sort_order: count ?? 0 });
  if (error) return { message: dbErrorMessage(error) };
  refresh(visitId);
  return { ok: true };
}

export async function removeRxItem(visitId: string, itemId: string): Promise<FormState> {
  await assertCan("prescriptions.manage");
  const supabase = await createClient();
  const { error } = await supabase.from("prescription_items").delete().eq("id", itemId);
  if (error) return { message: dbErrorMessage(error) };
  refresh(visitId);
  return { ok: true };
}

export async function setRxStatus(visitId: string, id: string, status: "issued" | "cancelled", reason?: string, notes?: string): Promise<FormState> {
  await assertCan("prescriptions.manage");
  const supabase = await createClient();
  if (notes !== undefined && status === "issued") {
    await supabase.from("prescriptions").update({ notes: notes.trim() || null }).eq("id", id);
  }
  const { error } = await supabase.from("prescriptions")
    .update(status === "cancelled" ? { status, cancel_reason: reason?.trim() || "Cancelled" } : { status }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  refresh(visitId);
  return { ok: true, message: status === "issued" ? "Prescription issued — ready to print." : "Prescription cancelled." };
}

export async function searchMedicines(q: string) {
  if (q.trim().length < 2) return [];
  // Only letters, digits, spaces and hyphens reach the filter expression.
  const term = q.replace(/[^\p{L}\p{N} -]/gu, "").trim();
  if (term.length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("medicines")
    .select("id, name, generic_name, form, strength, default_route, default_instructions")
    .eq("is_active", true).or(`name.ilike.%${term}%,generic_name.ilike.%${term}%`)
    .order("name").limit(8);
  return data ?? [];
}

// ---------------------------------------------------------------------------- Diagnostics

export async function orderDiagnostic(visitId: string, petId: string, consultationId: string | null,
  typeId: string, reason: string, isUrgent: boolean): Promise<FormState> {
  await assertCan("diagnostics.manage");
  const supabase = await createClient();
  const { error } = await supabase.from("diagnostic_orders").insert({
    visit_id: visitId, pet_id: petId, consultation_id: consultationId, type_id: typeId,
    reason: reason.trim() || null, is_urgent: isUrgent,
  });
  if (error) return { message: dbErrorMessage(error) };
  refresh(visitId);
  return { ok: true, message: "Test ordered." };
}

export async function saveDiagnosticResult(visitId: string, id: string, input: {
  findings: string; impression: string; result_values: Record<string, string>; status: "in_progress" | "resulted" | "reviewed";
}): Promise<FormState> {
  await assertCan("diagnostics.manage");
  const supabase = await createClient();
  const values = Object.fromEntries(Object.entries(input.result_values).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
  const { error } = await supabase.from("diagnostic_orders").update({
    findings: input.findings.trim() || null, impression: input.impression.trim() || null,
    result_values: values, status: input.status,
  }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  refresh(visitId);
  return { ok: true, message: input.status === "reviewed" ? "Result reviewed and locked." : "Result saved." };
}

export async function cancelDiagnostic(visitId: string, id: string, reason: string): Promise<FormState> {
  await assertCan("diagnostics.manage");
  const supabase = await createClient();
  const { error } = await supabase.from("diagnostic_orders").update({ status: "cancelled", cancel_reason: reason.trim() || "Cancelled" }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  refresh(visitId);
  return { ok: true, message: "Test cancelled." };
}

/** After the browser uploads a file to private storage, record what it belongs to. */
export async function recordDocument(visitId: string, doc: {
  path: string; pet_id: string; entity_type: "diagnostic_order" | "consultation" | "visit"; entity_id: string;
  file_name: string; mime_type: string; size_bytes: number; category?: string;
}): Promise<FormState> {
  const supabase = await createClient();
  if (!doc.path.startsWith(`pets/${doc.pet_id}/`)) return { message: "Invalid file path." };
  const { error } = await supabase.from("documents").insert({ ...doc, bucket: "clinical-files" });
  if (error) return { message: dbErrorMessage(error) };
  refresh(visitId);
  return { ok: true, message: "File attached." };
}

export async function signedFileUrl(path: string): Promise<string | null> {
  const supabase = await createClient();
  // RLS on storage.objects decides whether this user may read it. Link expires in 10 minutes.
  const { data } = await supabase.storage.from("clinical-files").createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

// ---------------------------------------------------------------------------- Deworming

export async function recordDeworming(input: {
  visit_id: string | null; pet_id: string; product: string; dose?: string; weight_kg?: number | null; next_due_date?: string; notes?: string;
  /** Given earlier (before the CRM or elsewhere): the date it was given. Not part of a visit, not billed. */
  given_on?: string;
}): Promise<FormState> {
  await assertCan("vaccinations.manage");
  if (input.product.trim().length < 2) return { message: "Write which dewormer was given." };
  const earlier = !!input.given_on;
  if (earlier && (!/^\d{4}-\d{2}-\d{2}$/.test(input.given_on!) || input.given_on! > todayPK())) return { message: "Enter the date it was given (today or earlier)." };
  if (earlier && input.next_due_date && input.next_due_date <= input.given_on!) return { message: "The next due date must be after the date it was given." };
  const supabase = await createClient();
  const { error } = await supabase.from("dewormings").insert({
    visit_id: earlier ? null : input.visit_id, pet_id: input.pet_id,
    ...(earlier ? { given_at: `${input.given_on}T12:00:00+05:00` } : {}), product: input.product.trim(), dose: input.dose?.trim() || null,
    weight_kg: input.weight_kg || null, next_due_date: input.next_due_date || null, notes: input.notes?.trim() || null,
  });
  if (error) {
    if (error.code === "23514") return { message: "The next due date must be after today." };
    return { message: dbErrorMessage(error) };
  }
  if (input.visit_id) refresh(input.visit_id);
  revalidatePath(`/pets/${input.pet_id}`);
  revalidatePath("/due");
  return { ok: true, message: earlier ? "Earlier deworming added to the history." + (input.next_due_date ? " Next reminder set." : "")
    : input.next_due_date ? "Deworming recorded — the next reminder is set." : "Deworming recorded." };
}

export async function voidDeworming(visitId: string | null, id: string, reason: string, petId?: string): Promise<FormState> {
  await assertCan("vaccinations.manage");
  if (reason.trim().length < 3) return { message: "Give a reason." };
  const supabase = await createClient();
  const { error } = await supabase.from("dewormings").update({ voided_at: new Date().toISOString(), void_reason: reason.trim() }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  if (visitId) refresh(visitId);
  if (petId) revalidatePath(`/pets/${petId}`);
  return { ok: true, message: "Marked as entered by mistake." };
}
