import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadHistory, type Episode, type PetHistory } from "@/lib/pet-history";
import type { CurrentStaff } from "@/lib/auth";

/*
 * Everything about one pet owner: every pet they have (or had) with us, every visit of each pet
 * in full detail (see pet-history.ts), plus owner-level events — appointments (including
 * missed and cancelled ones), payments and refunds, and every call / WhatsApp / message.
 * Each part is loaded only if the viewer's role may see it; RLS enforces the same.
 */

export type OwnerPet = { id: string; code: string; name: string; species: string | null; status: string; primary: boolean; visits: number; lastAt: string | null };
export type OwnerEvent = {
  key: string; at: string; kind: "appointment" | "payment" | "contact";
  title: string; detail: string | null; by: string | null; petName: string | null;
  tone: "success" | "warning" | "danger" | "info" | "neutral"; href: string | null;
};
export type OwnerHistory = PetHistory & { pets: OwnerPet[]; events: OwnerEvent[]; extra: { appointments: number; missed: number; contacts: number; lastContact: string | null } };

const APPT: Record<string, { label: string; tone: OwnerEvent["tone"] }> = {
  booked: { label: "Booked", tone: "info" }, confirmed: { label: "Confirmed", tone: "info" }, arrived: { label: "Arrived", tone: "success" },
  completed: { label: "Completed", tone: "success" }, cancelled: { label: "Cancelled", tone: "neutral" }, no_show: { label: "Did not come", tone: "danger" },
};
const rs = (n: number) => `Rs. ${Math.round(n).toLocaleString("en-PK")}`;

export async function loadOwnerHistory(customerId: string, me: CurrentStaff): Promise<OwnerHistory> {
  const supabase = await createClient();
  const canClinical = me.can("clinical.view");
  const [{ data: links }, appts, pays, msgs, staff] = await Promise.all([
    supabase.from("pet_owners").select("is_primary, pets(id, code, name, status, species(name))").eq("customer_id", customerId),
    me.can("appointments.view")
      ? supabase.from("appointments").select("id, starts_at, status, reason, cancel_reason, created_by, visit_id, pets(name), appointment_types(name), doctor:doctor_id(full_name)")
          .eq("customer_id", customerId).order("starts_at", { ascending: false }).limit(500) : null,
    me.can("billing.view")
      ? supabase.from("payments").select("id, code, kind, amount, method, reference, notes, received_at, received_by").eq("customer_id", customerId).order("received_at", { ascending: false }).limit(1000) : null,
    me.can("crm.view")
      ? supabase.from("messages").select("id, direction, channel, status, body, outcome_note, created_at, sent_at, sent_by, created_by").eq("customer_id", customerId)
          .not("status", "in", "(to_send,queued,cancelled)").order("created_at", { ascending: false }).limit(1000) : null,
    supabase.from("staff").select("id, full_name"),
  ]);
  const names = new Map((staff.data ?? []).map((s) => [s.id as string, s.full_name as string]));
  const who = (id: unknown) => (typeof id === "string" ? names.get(id) ?? "Former staff" : null);

  type Link = { is_primary: boolean; pets: { id: string; code: string; name: string; status: string; species: { name: string } | null } | null };
  const owned = ((links ?? []) as unknown as Link[]).filter((l) => l.pets);
  const petIds = owned.map((l) => l.pets!.id);
  const h = await loadHistory({ petIds: canClinical ? petIds : [], customerId: me.can("billing.view") ? customerId : undefined });
  // Without clinical access, only the bills part of the history is shown.
  const episodes: Episode[] = canClinical ? h.episodes : h.episodes.filter((e) => e.kind === "bill" || e.bills.length > 0)
    .map((e) => ({ ...e, consultation: null, prescriptions: [], vaccinations: [], dewormings: [], tests: [], surgeries: [], ward: [] }));

  const pets: OwnerPet[] = owned.map((l) => {
    const p = l.pets!;
    const visits = h.episodes.filter((e) => e.petId === p.id && e.visitId && e.status !== "cancelled");
    return { id: p.id, code: p.code, name: p.name, species: p.species?.name ?? null, status: p.status, primary: l.is_primary, visits: visits.length, lastAt: visits[0]?.at ?? null };
  }).sort((a, b) => Number(a.status !== "active") - Number(b.status !== "active") || a.name.localeCompare(b.name));

  const events: OwnerEvent[] = [
    ...(appts?.data ?? []).map((a): OwnerEvent => {
      const st = APPT[a.status as string] ?? APPT.booked;
      const type = (a.appointment_types as unknown as { name: string } | null)?.name ?? "Appointment";
      const doc = (a.doctor as unknown as { full_name: string } | null)?.full_name;
      return {
        key: `ap-${a.id}`, at: a.starts_at as string, kind: "appointment", title: `${type} — ${st.label.toLowerCase()}`,
        detail: [a.reason, doc && `with ${doc}`, a.cancel_reason && `reason: ${a.cancel_reason}`].filter(Boolean).join(" · ") || null,
        by: who(a.created_by) && `Booked by ${who(a.created_by)}`, petName: (a.pets as unknown as { name: string } | null)?.name ?? null,
        tone: st.tone, href: a.visit_id ? `/visits/${a.visit_id}` : null,
      };
    }),
    ...(pays?.data ?? []).map((p): OwnerEvent => ({
      key: `pa-${p.id}`, at: p.received_at as string, kind: "payment",
      title: `${p.kind === "refund" ? "Refund" : p.kind === "write_off" ? "Written off" : "Payment"} ${rs(Number(p.amount))}${p.method ? ` · ${String(p.method).replace(/_/g, " ")}` : ""}`,
      detail: [p.code, p.reference && `ref ${p.reference}`, p.notes].filter(Boolean).join(" · ") || null,
      by: who(p.received_by) && `Received by ${who(p.received_by)}`, petName: null,
      tone: p.kind === "payment" ? "success" : p.kind === "refund" ? "warning" : "neutral", href: `/print/receipt/${p.id}`,
    })),
    ...(msgs?.data ?? []).map((m): OwnerEvent => {
      const ch = String(m.channel).replace(/_/g, " ");
      const dir = m.direction === "in" ? "from owner" : m.channel === "call" || m.channel === "in_person" ? "with owner" : "to owner";
      return {
        key: `m-${m.id}`, at: (m.sent_at ?? m.created_at) as string, kind: "contact",
        title: `${ch.charAt(0).toUpperCase() + ch.slice(1)} ${dir}${m.status === "failed" ? " (failed)" : m.status === "not_reached" ? " (not reached)" : ""}`,
        detail: [m.body, m.outcome_note && `Outcome: ${m.outcome_note}`].filter(Boolean).join(" — ") || null,
        by: who(m.sent_by ?? m.created_by), petName: null, tone: m.status === "failed" || m.status === "not_reached" ? "danger" : "info", href: null,
      };
    }),
  ];

  const contacts = (msgs?.data ?? []);
  return {
    ...h, episodes, pets, events,
    extra: {
      appointments: (appts?.data ?? []).length,
      missed: (appts?.data ?? []).filter((a) => a.status === "no_show").length,
      contacts: contacts.length,
      lastContact: contacts[0] ? String(contacts[0].sent_at ?? contacts[0].created_at) : null,
    },
  };
}
