"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, type FormState } from "@/lib/validation";

const done = (message?: string): FormState => { revalidatePath("/settings/vaccines"); return { ok: true, message }; };

const stepSchema = z.object({
  label: z.string().trim().min(1, "Name the dose"),
  vaccine_id: z.uuid("Choose the vaccine"),
  min_age_weeks: z.coerce.number().int().min(0).max(520).nullable(),
  days_after_previous: z.coerce.number().int().min(1).max(3650).nullable(),
});

export async function saveStep(protocolId: string, stepNo: number, input: z.input<typeof stepSchema>): Promise<FormState> {
  await assertCan("clinical.reopen");
  const parsed = stepSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { error } = await supabase.from("vaccination_protocol_steps")
    .upsert({ protocol_id: protocolId, step_no: stepNo, ...parsed.data }, { onConflict: "protocol_id,step_no" });
  if (error) return { message: dbErrorMessage(error) };
  return done("Saved. The schedule needs approval again.");
}

export async function removeLastStep(protocolId: string): Promise<FormState> {
  await assertCan("clinical.reopen");
  const supabase = await createClient();
  const { data } = await supabase.from("vaccination_protocol_steps").select("id").eq("protocol_id", protocolId)
    .order("step_no", { ascending: false }).limit(1).maybeSingle();
  if (!data) return { message: "No steps to remove." };
  const { error } = await supabase.from("vaccination_protocol_steps").delete().eq("id", data.id);
  if (error) return { message: dbErrorMessage(error) };
  return done("Step removed.");
}

export async function saveProtocol(id: string | null, input: { name: string; species_id: string | null; booster_interval_days: number | null; description: string }): Promise<FormState> {
  await assertCan("clinical.reopen");
  const name = input.name.trim();
  if (name.length < 3) return { message: "Give the schedule a name." };
  const row = { name, species_id: input.species_id || null, booster_interval_days: input.booster_interval_days || null, description: input.description.trim() || null };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("vaccination_protocols").update(row).eq("id", id)
    : await supabase.from("vaccination_protocols").insert(row);
  if (error) return { message: error.code === "23505" ? "A schedule with this name exists." : dbErrorMessage(error) };
  return done(id ? "Schedule saved." : "Schedule created — add its doses.");
}

export async function approveProtocol(id: string): Promise<FormState> {
  await assertCan("clinical.reopen");
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_protocol", { p_id: id });
  if (error) return { message: dbErrorMessage(error) };
  return done("Approved. Doctors will now see suggestions from this schedule.");
}

export async function setProtocolActive(id: string, active: boolean): Promise<FormState> {
  await assertCan("clinical.reopen");
  const supabase = await createClient();
  const { error } = await supabase.from("vaccination_protocols").update({ is_active: active }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  return done(active ? "Schedule turned on." : "Schedule turned off.");
}
