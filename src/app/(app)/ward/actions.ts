"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertCan, getCurrentStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, type FormState } from "@/lib/validation";

const refresh = (id?: string) => { revalidatePath("/ward"); if (id) revalidatePath(`/ward/${id}`); };

const admitSchema = z.object({
  pet_id: z.uuid(), customer_id: z.uuid(),
  visit_id: z.string().optional().transform((v) => v || null),
  surgery_id: z.string().optional().transform((v) => v || null),
  kennel_id: z.string().optional().transform((v) => (v && v !== "none" ? v : null)),
  attending_doctor_id: z.string().optional().transform((v) => (v && v !== "none" ? v : null)),
  reason: z.string().trim().min(3, "Why is the pet staying?"),
  expected_discharge_on: z.string().optional().transform((v) => v || null),
  feeding_plan: z.string().trim().optional().transform((v) => v || null),
  care_notes: z.string().trim().optional().transform((v) => v || null),
});
export type AdmitInput = z.input<typeof admitSchema>;

export async function admitPet(input: AdmitInput): Promise<FormState> {
  await assertCan("inpatient.manage");
  const parsed = admitSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { data, error } = await supabase.from("admissions").insert(parsed.data).select("id").single();
  if (error) {
    if (error.code === "23505" && error.message.includes("kennel")) return { message: "That kennel is already occupied." };
    if (error.code === "23505") return { message: "This pet is already admitted." };
    return { message: dbErrorMessage(error) };
  }
  refresh();
  redirect(`/ward/${data.id}?notice=created`);
}

export async function moveKennel(id: string, kennelId: string | null): Promise<FormState> {
  const me = await getCurrentStaff();
  if (!me?.can("inpatient.manage") && !me?.can("inpatient.care")) return { message: "You don't have permission." };
  const supabase = await createClient();
  const { error } = await supabase.from("admissions").update({ kennel_id: kennelId }).eq("id", id);
  if (error) return { message: error.code === "23505" ? "That kennel is occupied." : dbErrorMessage(error) };
  refresh(id);
  return { ok: true, message: "Moved." };
}

export async function savePlan(id: string, patch: { feeding_plan?: string; care_notes?: string; expected_discharge_on?: string | null; attending_doctor_id?: string | null }): Promise<FormState> {
  await assertCan("inpatient.manage");
  const supabase = await createClient();
  const clean = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, typeof v === "string" ? (v.trim() || null) : v]));
  const { error } = await supabase.from("admissions").update(clean).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  return { ok: true };
}

const orderSchema = z.object({
  kind: z.enum(["medication", "fluids", "feeding", "procedure", "monitoring"]),
  description: z.string().trim().min(2, "What should be given/done?"),
  dose: z.string().trim().optional().transform((v) => v || null),
  route: z.string().trim().optional().transform((v) => v || null),
  every_hours: z.union([z.literal(""), z.coerce.number().positive().max(168)]).optional().transform((v) => (v === "" || v == null ? null : v)),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  days: z.union([z.literal(""), z.coerce.number().positive().max(60)]).optional().transform((v) => (v === "" || v == null ? null : v)),
  instructions: z.string().trim().optional().transform((v) => v || null),
});
export type OrderInput = z.input<typeof orderSchema>;

export async function addOrder(admissionId: string, input: OrderInput): Promise<FormState> {
  await assertCan("inpatient.manage");
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message };
  const { start_time, days, ...row } = parsed.data;
  if (row.kind === "medication" && !row.dose) return { message: "Write the dose for this medicine." };
  // First dose: today at the chosen Lahore time (or now), rounded to 5 minutes so slots line up exactly.
  let starts = new Date();
  if (start_time) {
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
    starts = new Date(`${ymd}T${start_time}:00+05:00`);
  }
  starts = new Date(Math.round(starts.getTime() / 300_000) * 300_000);
  const ends = days ? new Date(starts.getTime() + days * 86400_000) : null;
  const supabase = await createClient();
  const { error } = await supabase.from("admission_orders").insert({
    ...row, admission_id: admissionId, starts_at: starts.toISOString(), ends_at: ends?.toISOString() ?? null,
  });
  if (error) return { message: dbErrorMessage(error) };
  refresh(admissionId);
  return { ok: true, message: "Added to the treatment chart." };
}

export async function stopOrder(admissionId: string, orderId: string, reason: string): Promise<FormState> {
  await assertCan("inpatient.manage");
  if (reason.trim().length < 3) return { message: "Give a reason." };
  const supabase = await createClient();
  const { error } = await supabase.from("admission_orders").update({ status: "stopped", stop_reason: reason.trim() }).eq("id", orderId);
  if (error) return { message: dbErrorMessage(error) };
  refresh(admissionId);
  return { ok: true, message: "Stopped." };
}

export async function recordDose(admissionId: string, orderId: string, dueAt: string | null,
  result: "given" | "skipped" | "refused", note: string): Promise<FormState> {
  const me = await getCurrentStaff();
  if (!me?.can("inpatient.care") && !me?.can("inpatient.manage")) return { message: "You don't have permission." };
  if (result !== "given" && note.trim().length < 3) return { message: "Say why it wasn't given." };
  const supabase = await createClient();
  const { error } = await supabase.from("admission_administrations").insert({
    admission_id: admissionId, order_id: orderId, due_at: dueAt, result, note: note.trim() || null, given_by: me.id,
  });
  if (error) return { message: error.code === "23505" ? "Already recorded for this time." : dbErrorMessage(error) };
  refresh(admissionId);
  return { ok: true, message: result === "given" ? "Recorded as given." : "Recorded." };
}

export async function addNote(admissionId: string, kind: "progress" | "vitals" | "feeding" | "owner_update" | "procedure",
  note: string, vitals: Record<string, string>): Promise<FormState> {
  const me = await getCurrentStaff();
  if (!me?.can("inpatient.care") && !me?.can("inpatient.manage")) return { message: "You don't have permission." };
  const clean = Object.fromEntries(Object.entries(vitals).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
  if (!note.trim() && !Object.keys(clean).length) return { message: "Write something first." };
  const supabase = await createClient();
  const { error } = await supabase.from("admission_notes").insert({ admission_id: admissionId, kind, note: note.trim() || null, vitals: clean, created_by: me.id });
  if (error) return { message: dbErrorMessage(error) };
  refresh(admissionId);
  return { ok: true };
}

const dischargeSchema = z.object({
  outcome: z.enum(["discharged_home", "transferred", "left_against_advice", "deceased"]),
  discharge_summary: z.string().trim().min(5, "Write a short summary of the stay"),
  discharge_instructions: z.string().trim().optional().transform((v) => v || null),
  follow_up_date: z.string().optional().transform((v) => v || null),
});

export async function dischargeAdmission(id: string, input: z.input<typeof dischargeSchema>): Promise<FormState> {
  await assertCan("inpatient.manage");
  const parsed = dischargeSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message };
  if (parsed.data.outcome === "discharged_home" && !parsed.data.discharge_instructions) return { message: "Write home-care instructions for the owner." };
  const supabase = await createClient();
  const { error } = await supabase.from("admissions").update({ ...parsed.data, status: "discharged" }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  refresh(id);
  return { ok: true, message: "Discharged." };
}

export async function cancelAdmission(id: string, reason: string): Promise<FormState> {
  await assertCan("inpatient.manage");
  if (reason.trim().length < 3) return { message: "Give a reason." };
  const supabase = await createClient();
  const { error } = await supabase.from("admissions").update({ status: "cancelled", cancel_reason: reason.trim() }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  refresh(id);
  return { ok: true, message: "Admission cancelled (entered by mistake)." };
}
