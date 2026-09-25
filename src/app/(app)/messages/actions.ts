"use server";

import { revalidatePath } from "next/cache";
import { assertCan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toE164 } from "@/lib/phone";
import { dbErrorMessage, type FormState } from "@/lib/validation";

const refresh = () => { revalidatePath("/messages"); revalidatePath("/alerts"); };

export async function markMessage(id: string, status: "sent" | "not_reached" | "cancelled", note?: string): Promise<FormState> {
  await assertCan("crm.manage");
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_message", { p_id: id, p_status: status, p_note: note ?? null });
  if (error) return { message: error.message };
  refresh();
  return { ok: true, message: status === "sent" ? "Marked as sent." : status === "not_reached" ? "Noted — the reminder will come up again." : "Skipped." };
}

/** Log a call made, a reply received, or a message sent outside the queue. */
export async function logContact(input: { customer_id: string; channel: "whatsapp" | "sms" | "call" | "in_person"; direction: "out" | "in"; body: string }): Promise<FormState> {
  const me = await assertCan("crm.manage");
  if (input.body.trim().length < 2) return { message: "Write what was said." };
  const supabase = await createClient();
  const { data: c } = await supabase.from("customers").select("phone, whatsapp").eq("id", input.customer_id).single();
  const { error } = await supabase.from("messages").insert({
    customer_id: input.customer_id, channel: input.channel, direction: input.direction, status: "logged",
    body: input.body.trim(), to_phone: c ? toE164(c.whatsapp ?? c.phone) : null, sent_at: new Date().toISOString(), sent_by: me.id, created_by: me.id,
  });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/customers/${input.customer_id}`);
  refresh();
  return { ok: true, message: "Saved to the customer's history." };
}

export async function runRemindersNow(): Promise<FormState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("run_reminders_now");
  if (error) return { message: error.message };
  refresh();
  const r = data as { messages: number; alerts: number; escalations: number };
  return { ok: true, message: `Checked: ${r.messages} new message(s), ${r.alerts} alert(s), ${r.escalations} escalation(s).` };
}

export async function pauseReminder(trackId: string, until: string | null, reason: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("pause_reminder", { p_track: trackId, p_until: until, p_reason: reason });
  if (error) return { message: error.message };
  refresh();
  return { ok: true, message: until ? "Reminders paused." : "Reminders resumed." };
}

export async function previewCampaign(audience: string): Promise<number> {
  await assertCan("crm.campaigns");
  const supabase = await createClient();
  const { data } = await supabase.rpc("campaign_audience", { p_audience: audience });
  return (data ?? []).length;
}

export async function createCampaign(name: string, audience: string, template: string): Promise<FormState> {
  await assertCan("crm.campaigns");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_campaign", { p_name: name, p_audience: audience, p_template: template });
  if (error) return { message: error.message };
  refresh();
  return { ok: true, message: `${data} message(s) added to “Messages to send”.` };
}
