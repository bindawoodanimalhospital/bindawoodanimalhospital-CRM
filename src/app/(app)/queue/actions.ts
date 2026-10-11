"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan, getCurrentStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, type FormState } from "@/lib/validation";
import type { VisitStatus } from "@/lib/clinic";

export type PetOption = {
  id: string; code: string; name: string; subtitle: string;
  owners: { id: string; full_name: string; is_primary: boolean }[];
};

/** Pet search for check-in: name, owner phone, ID. RLS limits results. */
export async function searchPets(q: string): Promise<PetOption[]> {
  if (q.trim().length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("global_search", { q, max_results: 20 });
  const petIds = ((data ?? []) as { kind: string; id: string }[]).filter((h) => h.kind === "pet").map((h) => h.id).slice(0, 8);
  if (!petIds.length) return [];
  const { data: pets } = await supabase
    .from("pets")
    .select("id, code, name, status, species(name), breeds(name), breed_text, pet_owners(is_primary, customers(id, full_name))")
    .in("id", petIds);
  return (pets ?? [])
    .filter((p) => p.status === "active")
    .map((p) => {
      const owners = ((p.pet_owners ?? []) as unknown as { is_primary: boolean; customers: { id: string; full_name: string } }[])
        .map((o) => ({ ...o.customers, is_primary: o.is_primary }))
        .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
      const sp = p.species as unknown as { name: string } | null;
      const br = p.breeds as unknown as { name: string } | null;
      return {
        id: p.id, code: p.code, name: p.name, owners,
        subtitle: [sp?.name, br?.name ?? p.breed_text, owners[0]?.full_name].filter(Boolean).join(" · "),
      };
    })
    .sort((a, b) => petIds.indexOf(a.id) - petIds.indexOf(b.id));
}

const walkInSchema = z.object({
  pet_id: z.uuid("Choose the pet"),
  customer_id: z.uuid("Choose who brought the pet"),
  reason: z.string().trim().max(500).optional().transform((v) => v || null),
  priority: z.enum(["normal", "urgent", "emergency"]).default("normal"),
  doctor_id: z.string().optional().transform((v) => (v && v !== "any" ? v : null)).pipe(z.uuid().nullable()),
  visit_type_id: z.string().optional().transform((v) => v || null).pipe(z.uuid().nullable()),
});

export async function checkInWalkIn(input: z.input<typeof walkInSchema>): Promise<FormState & { token?: number }> {
  await assertCan("queue.manage");
  const parsed = walkInSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  // Don't queue the same pet twice on the same day.
  const { data: open } = await supabase.from("visits").select("token_no")
    .eq("pet_id", parsed.data.pet_id).eq("visit_date", new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date()))
    .not("status", "in", "(completed,cancelled)").maybeSingle();
  if (open) return { message: `This pet is already in today's queue (token #${open.token_no}).` };

  const { data, error } = await supabase.from("visits").insert(parsed.data).select("token_no").single();
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/queue");
  return { ok: true, message: `Checked in — token #${data.token_no}`, token: data.token_no };
}

const STATUSES: VisitStatus[] = ["waiting", "with_doctor", "in_treatment", "ready_for_billing", "completed"];

export async function moveVisit(visitId: string, status: VisitStatus): Promise<FormState> {
  const me = await getCurrentStaff();
  if (!me?.can("queue.manage") && !me?.can("clinical.create")) return { message: "You don't have permission to move patients." };
  if (!STATUSES.includes(status)) return { message: "Unknown stage." };
  const supabase = await createClient();
  const patch: { status: VisitStatus; doctor_id?: string } = { status };
  // A doctor calling a patient in becomes their doctor if none was assigned.
  if (status === "with_doctor" && me.isDoctor) {
    const { data: v } = await supabase.from("visits").select("doctor_id").eq("id", visitId).single();
    if (!v?.doctor_id) patch.doctor_id = me.id;
  }
  const { error } = await supabase.from("visits").update(patch).eq("id", visitId);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/queue");
  return { ok: true };
}

export async function assignDoctor(visitId: string, doctorId: string | null): Promise<FormState> {
  await assertCan("queue.manage");
  const supabase = await createClient();
  const { error } = await supabase.from("visits").update({ doctor_id: doctorId }).eq("id", visitId);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/queue");
  return { ok: true, message: "Doctor assigned." };
}

export async function cancelVisit(visitId: string, reason: string): Promise<FormState> {
  await assertCan("queue.manage");
  if (reason.trim().length < 3) return { message: "Please give a reason." };
  const supabase = await createClient();
  const { error } = await supabase.from("visits").update({ status: "cancelled", cancel_reason: reason.trim() }).eq("id", visitId);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/queue");
  return { ok: true, message: "Removed from the queue." };
}
