"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertCan, getCurrentStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, type FormState } from "@/lib/validation";

const refresh = (id?: string) => { revalidatePath("/surgery"); if (id) revalidatePath(`/surgery/${id}`); };

const planSchema = z.object({
  pet_id: z.uuid(), customer_id: z.uuid(),
  visit_id: z.string().optional().transform((v) => v || null),
  consultation_id: z.string().optional().transform((v) => v || null),
  procedure_id: z.string().optional().transform((v) => v || null),
  procedure_name: z.string().trim().min(2, "Name the procedure"),
  indication: z.string().trim().optional().transform((v) => v || null),
  urgency: z.enum(["elective", "urgent", "emergency"]).default("elective"),
  surgeon_id: z.string().optional().transform((v) => (v && v !== "none" ? v : null)),
  scheduled_date: z.string().optional(), scheduled_time: z.string().optional(),
  estimate_amount: z.union([z.literal(""), z.coerce.number().min(0)]).optional().transform((v) => (v === "" || v == null ? null : v)),
  estimate_notes: z.string().trim().optional().transform((v) => v || null),
  pre_op_instructions: z.string().trim().optional().transform((v) => v || null),
});
export type PlanInput = z.input<typeof planSchema>;

export async function planSurgery(input: PlanInput): Promise<FormState> {
  await assertCan("surgery.manage");
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message };
  const { scheduled_date, scheduled_time, ...row } = parsed.data;
  const scheduled_at = scheduled_date ? new Date(`${scheduled_date}T${scheduled_time || "10:00"}:00+05:00`).toISOString() : null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("surgeries")
    .insert({ ...row, scheduled_at, status: scheduled_at ? "scheduled" : "planned" }).select("id").single();
  if (error) return { message: dbErrorMessage(error) };
  if (row.surgeon_id) await supabase.from("surgery_team").insert({ surgery_id: data.id, staff_id: row.surgeon_id, role: "surgeon" });
  refresh();
  redirect(`/surgery/${data.id}?notice=created`);
}

const STAGES = ["planned", "scheduled", "admitted", "pre_op", "in_surgery", "recovery", "discharged"] as const;

export async function moveSurgery(id: string, status: (typeof STAGES)[number], extra?: { emergency_override_reason?: string }): Promise<FormState> {
  await assertCan("surgery.manage");
  if (!STAGES.includes(status)) return { message: "Unknown stage." };
  const supabase = await createClient();
  const { error } = await supabase.from("surgeries").update({ status, ...extra }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  refresh(id);
  return { ok: true };
}

const num = z.union([z.literal(""), z.null(), z.coerce.number()]).optional().transform((v) => (v === "" || v == null ? null : v));
const txt = z.string().nullable().optional().transform((v) => (v?.trim() ? v.trim() : null));

const fieldsSchema = z.object({
  procedure_name: z.string().trim().min(2).optional(),
  indication: txt, urgency: z.enum(["elective", "urgent", "emergency"]).optional(),
  surgeon_id: z.string().nullable().optional().transform((v) => v || null),
  scheduled_at: z.string().nullable().optional(),
  estimate_amount: num, estimate_notes: txt, pre_op_instructions: txt,
  preop_weight_kg: num, preop_temperature_c: num, preop_heart_rate: num, preop_resp_rate: num,
  asa_class: num, fasting_confirmed: z.boolean().nullable().optional(),
  preop_checklist: z.record(z.string(), z.boolean()).optional(), preop_notes: txt,
  anaesthesia_protocol: txt, intra_op_notes: txt, complications: txt,
  recovery_notes: txt, discharge_instructions: txt,
  follow_up_date: z.string().nullable().optional().transform((v) => v || null),
}).partial();
export type SurgeryFields = z.input<typeof fieldsSchema>;

export async function saveSurgery(id: string, patch: SurgeryFields): Promise<FormState> {
  await assertCan("surgery.manage");
  const parsed = fieldsSchema.safeParse(patch);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { error } = await supabase.from("surgeries").update(parsed.data).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  return { ok: true };
}

export async function completePreop(id: string): Promise<FormState> {
  await assertCan("surgery.manage");
  const supabase = await createClient();
  const { data: s } = await supabase.from("surgeries").select("preop_weight_kg, fasting_confirmed, urgency").eq("id", id).single();
  if (!s?.preop_weight_kg) return { message: "Enter today's weight first." };
  if (s.fasting_confirmed == null && s.urgency !== "emergency") return { message: "Confirm whether the pet was fasted." };
  const { error } = await supabase.from("surgeries").update({ preop_checked_at: new Date().toISOString() }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  refresh(id);
  return { ok: true, message: "Pre-op check complete." };
}

export async function cancelSurgery(id: string, reason: string): Promise<FormState> {
  await assertCan("surgery.manage");
  if (reason.trim().length < 3) return { message: "Give a reason." };
  const supabase = await createClient();
  const { error } = await supabase.from("surgeries").update({ status: "cancelled", cancel_reason: reason.trim() }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  refresh(id);
  return { ok: true, message: "Surgery cancelled." };
}

export async function reopenSurgery(id: string, reason: string): Promise<FormState> {
  await assertCan("clinical.reopen");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_surgery", { p_id: id, p_reason: reason });
  if (error) return { message: dbErrorMessage(error) };
  refresh(id);
  return { ok: true, message: "Reopened. The discharged version is kept." };
}

// ---------------------------------------------------------------- consent

const consentSchema = z.object({
  signed_by_name: z.string().trim().min(2, "Who is giving consent?"),
  relationship: z.string().trim().optional().transform((v) => v || null),
  signer_phone: z.string().trim().optional().transform((v) => v || null),
  method: z.enum(["signed_paper", "signed_on_screen", "verbal_phone"]),
  language: z.enum(["en", "ur"]),
  risks_explained: z.literal(true, "Confirm the risks were explained"),
  estimate_explained: z.literal(true, "Confirm the estimate was explained"),
  document_id: z.string().optional().transform((v) => v || null),
});
export type ConsentInput = z.input<typeof consentSchema>;

export async function recordConsent(surgeryId: string, input: ConsentInput): Promise<FormState> {
  await assertCan("surgery.consent");
  const parsed = consentSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const [{ data: s }, { data: text }] = await Promise.all([
    supabase.from("surgeries").select("procedure_name, estimate_amount").eq("id", surgeryId).single(),
    supabase.from("system_settings").select("value").eq("key", "surgery.consent_text").single(),
  ]);
  if (!s) return { message: "Surgery not found." };
  const wording = (text?.value as Record<string, string> | undefined)?.[parsed.data.language] ?? "";
  const { language, ...row } = parsed.data;
  const consent_text = `[${language.toUpperCase()}] Procedure: ${s.procedure_name}. ${wording}`;
  const { error } = await supabase.from("surgery_consents").insert({
    ...row, surgery_id: surgeryId, consent_text, estimate_amount: s.estimate_amount,
  });
  if (error) return { message: dbErrorMessage(error) };
  refresh(surgeryId);
  return { ok: true, message: "Consent recorded." };
}

export async function revokeConsent(surgeryId: string, consentId: string, reason: string): Promise<FormState> {
  await assertCan("surgery.consent");
  if (reason.trim().length < 3) return { message: "Give a reason." };
  const supabase = await createClient();
  const { error } = await supabase.from("surgery_consents")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: reason.trim() }).eq("id", consentId);
  if (error) return { message: dbErrorMessage(error) };
  refresh(surgeryId);
  return { ok: true, message: "Consent withdrawn." };
}

// ---------------------------------------------------------------- theatre log

export async function addSurgeryEvent(surgeryId: string, kind: "monitoring" | "drug" | "complication" | "note",
  data: Record<string, string>, note: string): Promise<FormState> {
  const me = await getCurrentStaff();
  if (!me?.can("surgery.manage") && !me?.can("surgery.assist")) return { message: "You don't have permission." };
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
  if (!Object.keys(clean).length && !note.trim()) return { message: "Nothing to record." };
  const supabase = await createClient();
  const { error } = await supabase.from("surgery_events").insert({ surgery_id: surgeryId, kind, data: clean, note: note.trim() || null });
  if (error) return { message: dbErrorMessage(error) };
  refresh(surgeryId);
  return { ok: true };
}

export async function addConsumable(surgeryId: string, input: { item_name: string; quantity: number; unit: string; batch_no: string }): Promise<FormState> {
  const me = await getCurrentStaff();
  if (!me?.can("surgery.manage") && !me?.can("surgery.assist")) return { message: "You don't have permission." };
  if (!input.item_name.trim() || !(input.quantity > 0)) return { message: "Enter the item and quantity." };
  const supabase = await createClient();
  const { error } = await supabase.from("surgery_consumables").insert({
    surgery_id: surgeryId, item_name: input.item_name.trim(), quantity: input.quantity,
    unit: input.unit.trim() || null, batch_no: input.batch_no.trim() || null,
  });
  if (error) return { message: dbErrorMessage(error) };
  refresh(surgeryId);
  return { ok: true };
}

export async function removeConsumable(surgeryId: string, id: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.from("surgery_consumables").delete().eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  refresh(surgeryId);
  return { ok: true };
}

export async function setTeam(surgeryId: string, members: { staff_id: string; role: string }[]): Promise<FormState> {
  await assertCan("surgery.manage");
  const supabase = await createClient();
  const { error: delErr } = await supabase.from("surgery_team").delete().eq("surgery_id", surgeryId);
  if (delErr) return { message: dbErrorMessage(delErr) };
  const rows = members.filter((m) => m.staff_id).map((m) => ({ surgery_id: surgeryId, ...m }));
  if (rows.length) {
    const { error } = await supabase.from("surgery_team").insert(rows);
    if (error) return { message: dbErrorMessage(error) };
  }
  refresh(surgeryId);
  return { ok: true, message: "Team saved." };
}
