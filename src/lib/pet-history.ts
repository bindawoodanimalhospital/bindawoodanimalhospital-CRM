import "server-only";
import { createClient } from "@/lib/supabase/server";

/*
 * Everything that ever happened to one pet, organised as "episodes": one per visit, with the
 * consultation, diagnoses, medicines, vaccines, tests, surgery, ward stay and bill of that visit
 * nested inside — plus episodes for things that happened outside a visit (a surgery booked
 * directly, a ward stay, a vaccine recorded later, a pet-store bill). Every step says who did it.
 * Runs as the signed-in user, so RLS decides what each role sees (e.g. no bills for store staff).
 */

const CAP = 1000;
type Obj = Record<string, unknown>;

export type Who = string | null;
export type RxLine = { medicine: string; strength: string | null; form: string | null; dose: string | null; frequency: string | null; duration: string | null; route: string | null; quantity: number | null; instructions: string | null };
export type Rx = { id: string; code: string; status: string; issuedAt: string | null; doctor: Who; notes: string | null; lines: RxLine[] };
export type Vaccination = { id: string; at: string; name: string; manufacturer: string | null; batch: string | null; dose: string | null; route: string | null; site: string | null; by: Who; nextDue: string | null; reaction: string | null; notes: string | null };
export type Test = { id: string; code: string | null; type: string; status: string; reason: string | null; urgent: boolean; orderedBy: Who; orderedAt: string; lab: string | null; findings: string | null; impression: string | null; values: unknown; resultedAt: string | null; resultedBy: Who; reviewedBy: Who };
export type Surgery = { id: string; code: string | null; procedure: string; status: string; urgency: string | null; at: string; surgeon: Who; team: { name: Who; role: string }[]; indication: string | null; asa: string | null; anaesthesia: string | null; complications: string | null; intraOp: string | null; recovery: string | null; consumables: string[]; dischargedBy: Who; followUp: string | null };
export type WardStay = { id: string; code: string | null; reason: string | null; status: string; admittedAt: string; admittedBy: Who; doctor: Who; dischargedAt: string | null; dischargedBy: Who; outcome: string | null; summary: string | null; orders: { description: string; dose: string | null; route: string | null; every: number | null; by: Who; status: string }[]; doses: { at: string; what: string; result: string; by: Who; note: string | null }[]; notes: { at: string; kind: string; note: string; by: Who }[] };
export type Bill = { id: string; number: string | null; status: string; at: string; total: number; paid: number; balance: number; by: Who; lines: { description: string; qty: number; total: number }[] };
export type Consultation = { status: string; doctor: Who; finalizedAt: string | null; finalizedBy: Who; complaint: string | null; history: string | null; vitals: [string, string][]; exam: string | null; observations: string | null; assessment: string | null; treatment: string | null; medicinesGiven: string | null; followUpPlan: string | null; followUpDate: string | null; doctorNotes: string | null; diagnoses: { label: string; primary: boolean; certainty: string | null }[]; revisions: number };

export type Episode = {
  key: string; petId: string | null; petName: string | null; at: string; kind: "visit" | "surgery" | "ward" | "vaccination" | "bill";
  title: string; visitId: string | null; token: number | null; status: string | null; reason: string | null;
  doctor: Who; broughtBy: string | null; checkedInBy: Who; homeVisit: string | null;
  steps: { at: string; label: string; by: Who }[];
  weight: number | null;
  consultation: Consultation | null; prescriptions: Rx[]; vaccinations: Vaccination[]; tests: Test[];
  surgeries: Surgery[]; ward: WardStay[]; bills: Bill[];
};

export type PetHistory = {
  episodes: Episode[];
  weights: { at: string; kg: number; by: Who; note: string | null }[];
  summary: { visits: number; firstAt: string | null; lastAt: string | null; doctors: string[]; medicines: string[]; vaccines: number; surgeries: number; wardStays: number; billed: number; paid: number; owed: number };
};

const STATUS_LABEL: Record<string, string> = {
  waiting: "Checked in", with_doctor: "With doctor", in_treatment: "In treatment", ready_for_billing: "Ready to bill", completed: "Visit completed", cancelled: "Cancelled",
};

export function loadPetHistory(petId: string): Promise<PetHistory> {
  return loadHistory({ petIds: [petId] });
}

/**
 * History for several pets at once (an owner's whole family), newest first. With `customerId`,
 * that owner's bills that aren't tied to one pet (pet-store sales, deliveries) are included too.
 */
export async function loadHistory({ petIds, customerId }: { petIds: string[]; customerId?: string }): Promise<PetHistory> {
  const supabase = await createClient();
  const ids = petIds.length ? petIds : ["00000000-0000-0000-0000-000000000000"];
  const billFilter = customerId ? `pet_id.in.(${ids.join(",")}),customer_id.eq.${customerId}` : `pet_id.in.(${ids.join(",")})`;
  const [visits, consults, rx, vacc, tests, surg, team, cons, adm, orders, doses, notes, bills, weights, staff, pets, steps] = await Promise.all([
    supabase.from("visits").select("id, pet_id, token_no, status, reason, priority, checked_in_at, started_at, completed_at, doctor_id, created_by, service_location, service_address, customers(full_name), appointment_types(name)")
      .in("pet_id", ids).order("checked_in_at", { ascending: false }).limit(CAP),
    supabase.from("consultations").select("*, consultation_diagnoses(label, is_primary, certainty), consultation_revisions(id)").in("pet_id", ids).limit(CAP),
    supabase.from("prescriptions").select("id, code, status, issued_at, created_at, pet_id, visit_id, doctor_id, notes, prescription_items(sort_order, medicine_name, strength, form, dose, frequency, duration, route, quantity, instructions)")
      .in("pet_id", ids).neq("status", "draft").limit(CAP),
    supabase.from("vaccinations").select("id, pet_id, visit_id, vaccine_name, manufacturer, batch_no, administered_at, dose, route, site, administered_by, next_due_date, adverse_reaction, notes")
      .in("pet_id", ids).is("voided_at", null).limit(CAP),
    supabase.from("diagnostic_orders").select("id, code, visit_id, status, reason, is_urgent, ordered_by, created_at, external_lab, findings, impression, result_values, resulted_at, resulted_by, reviewed_by, diagnostic_types(name)")
      .in("pet_id", ids).neq("status", "cancelled").limit(CAP),
    supabase.from("surgeries").select("id, code, pet_id, visit_id, procedure_name, status, urgency, scheduled_at, procedure_start, created_at, surgeon_id, indication, asa_class, anaesthesia_protocol, complications, intra_op_notes, recovery_notes, discharged_by, follow_up_date")
      .in("pet_id", ids).neq("status", "cancelled").limit(CAP),
    supabase.from("surgery_team").select("surgery_id, staff_id, role, surgeries!inner(pet_id)").in("surgeries.pet_id", ids).limit(CAP),
    supabase.from("surgery_consumables").select("surgery_id, item_name, quantity, unit, surgeries!inner(pet_id)").in("surgeries.pet_id", ids).limit(CAP),
    supabase.from("admissions").select("id, code, pet_id, visit_id, surgery_id, reason, status, admitted_at, admitted_by, attending_doctor_id, discharged_at, discharged_by, outcome, discharge_summary")
      .in("pet_id", ids).neq("status", "cancelled").limit(CAP),
    supabase.from("admission_orders").select("id, admission_id, description, dose, route, every_hours, ordered_by, status, admissions!inner(pet_id)").in("admissions.pet_id", ids).limit(CAP),
    supabase.from("admission_administrations").select("admission_id, order_id, given_at, due_at, result, given_by, note, admissions!inner(pet_id)").in("admissions.pet_id", ids).not("given_at", "is", null).limit(CAP),
    supabase.from("admission_notes").select("admission_id, kind, note, created_by, created_at, admissions!inner(pet_id)").in("admissions.pet_id", ids).limit(CAP),
    supabase.from("invoices").select("id, number, status, pet_id, visit_id, surgery_id, admission_id, issued_at, created_at, total, amount_paid, balance, issued_by, invoice_items(sort_order, description, quantity, line_total)")
      .or(billFilter).neq("status", "draft").limit(CAP),
    supabase.from("pet_weights").select("weight_kg, measured_at, visit_id, recorded_by, note").in("pet_id", ids).order("measured_at", { ascending: false }).limit(CAP),
    supabase.from("staff").select("id, full_name"),
    supabase.from("pets").select("id, name").in("id", ids),
    supabase.from("visit_status_events").select("visit_id, to_status, changed_at, changed_by, visits!inner(pet_id)").in("visits.pet_id", ids).order("changed_at").limit(CAP),
  ]);

  const names = new Map((staff.data ?? []).map((s) => [s.id as string, s.full_name as string]));
  const petNames = new Map((pets.data ?? []).map((p) => [p.id as string, p.name as string]));
  const who = (id: unknown): Who => (typeof id === "string" ? names.get(id) ?? "Former staff" : null);
  const str = (v: unknown) => (v == null || v === "" ? null : String(v));
  const num = (v: unknown) => Number(v ?? 0);
  const by = <T extends Obj>(rows: T[] | null, key: string) => {
    const m = new Map<string, T[]>();
    for (const r of rows ?? []) { const k = r[key] as string | null; if (!k) continue; (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
    return m;
  };

  // ---- build the parts ---------------------------------------------------------------------
  const toRx = (r: Obj): Rx => ({
    id: r.id as string, code: r.code as string, status: r.status as string, issuedAt: str(r.issued_at), doctor: who(r.doctor_id), notes: str(r.notes),
    lines: ((r.prescription_items ?? []) as Obj[]).sort((a, b) => num(a.sort_order) - num(b.sort_order)).map((i) => ({
      medicine: String(i.medicine_name), strength: str(i.strength), form: str(i.form), dose: str(i.dose), frequency: str(i.frequency),
      duration: str(i.duration), route: str(i.route), quantity: i.quantity == null ? null : num(i.quantity), instructions: str(i.instructions),
    })),
  });
  const toVacc = (v: Obj): Vaccination => ({
    id: v.id as string, at: v.administered_at as string, name: String(v.vaccine_name), manufacturer: str(v.manufacturer), batch: str(v.batch_no),
    dose: str(v.dose), route: str(v.route), site: str(v.site), by: who(v.administered_by), nextDue: str(v.next_due_date), reaction: str(v.adverse_reaction), notes: str(v.notes),
  });
  const toTest = (t: Obj): Test => ({
    id: t.id as string, code: str(t.code), type: (t.diagnostic_types as { name: string } | null)?.name ?? "Test", status: String(t.status), reason: str(t.reason),
    urgent: !!t.is_urgent, orderedBy: who(t.ordered_by), orderedAt: t.created_at as string, lab: str(t.external_lab), findings: str(t.findings),
    impression: str(t.impression), values: t.result_values, resultedAt: str(t.resulted_at), resultedBy: who(t.resulted_by), reviewedBy: who(t.reviewed_by),
  });
  const teamBy = by(team.data as Obj[] | null, "surgery_id");
  const consBy = by(cons.data as Obj[] | null, "surgery_id");
  const toSurgery = (s: Obj): Surgery => ({
    id: s.id as string, code: str(s.code), procedure: String(s.procedure_name), status: String(s.status), urgency: str(s.urgency),
    at: String(s.procedure_start ?? s.scheduled_at ?? s.created_at), surgeon: who(s.surgeon_id),
    team: (teamBy.get(s.id as string) ?? []).map((t) => ({ name: who(t.staff_id), role: String(t.role) })),
    indication: str(s.indication), asa: str(s.asa_class), anaesthesia: str(s.anaesthesia_protocol), complications: str(s.complications),
    intraOp: str(s.intra_op_notes), recovery: str(s.recovery_notes),
    consumables: (consBy.get(s.id as string) ?? []).map((c) => `${c.item_name} × ${num(c.quantity)}${c.unit ? ` ${c.unit}` : ""}`),
    dischargedBy: who(s.discharged_by), followUp: str(s.follow_up_date),
  });
  const ordersBy = by(orders.data as Obj[] | null, "admission_id");
  const orderName = new Map((orders.data ?? []).map((o) => [o.id as string, String(o.description)]));
  const dosesBy = by(doses.data as Obj[] | null, "admission_id");
  const notesBy = by(notes.data as Obj[] | null, "admission_id");
  const toWard = (a: Obj): WardStay => ({
    id: a.id as string, code: str(a.code), reason: str(a.reason), status: String(a.status), admittedAt: a.admitted_at as string, admittedBy: who(a.admitted_by),
    doctor: who(a.attending_doctor_id), dischargedAt: str(a.discharged_at), dischargedBy: who(a.discharged_by), outcome: str(a.outcome), summary: str(a.discharge_summary),
    orders: (ordersBy.get(a.id as string) ?? []).map((o) => ({ description: String(o.description), dose: str(o.dose), route: str(o.route), every: o.every_hours == null ? null : num(o.every_hours), by: who(o.ordered_by), status: String(o.status) })),
    doses: (dosesBy.get(a.id as string) ?? []).map((d) => ({ at: String(d.given_at), what: orderName.get(d.order_id as string) ?? "Dose", result: String(d.result), by: who(d.given_by), note: str(d.note) }))
      .sort((x, y) => x.at.localeCompare(y.at)),
    notes: (notesBy.get(a.id as string) ?? []).map((n) => ({ at: String(n.created_at), kind: String(n.kind), note: String(n.note), by: who(n.created_by) }))
      .sort((x, y) => x.at.localeCompare(y.at)),
  });
  const toBill = (b: Obj): Bill => ({
    id: b.id as string, number: str(b.number), status: String(b.status), at: String(b.issued_at ?? b.created_at), total: num(b.total), paid: num(b.amount_paid), balance: num(b.balance), by: who(b.issued_by),
    lines: ((b.invoice_items ?? []) as Obj[]).sort((x, y) => num(x.sort_order) - num(y.sort_order)).map((i) => ({ description: String(i.description), qty: num(i.quantity), total: num(i.line_total) })),
  });
  const toConsult = (c: Obj): Consultation => {
    const vit: [string, unknown, string][] = [
      ["Temp", c.temperature_c, " °C"], ["Heart rate", c.heart_rate, " /min"], ["Resp. rate", c.resp_rate, " /min"], ["Weight", c.weight_kg, " kg"],
      ["Mucous membranes", c.mucous_membranes, ""], ["CRT", c.crt_seconds, " s"], ["Hydration", c.hydration, ""], ["Body condition", c.body_condition_score, "/9"], ["Pain", c.pain_score, "/10"],
    ];
    return {
      status: String(c.status), doctor: who(c.doctor_id), finalizedAt: str(c.finalized_at), finalizedBy: who(c.finalized_by),
      complaint: str(c.chief_complaint), history: str(c.history), vitals: vit.filter(([, v]) => v != null && v !== "").map(([k, v, u]) => [k, `${v}${u}`]),
      exam: typeof c.exam === "object" && c.exam ? Object.entries(c.exam as Obj).filter(([, v]) => v).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("; ") || null : str(c.exam),
      observations: str(c.observations), assessment: str(c.assessment), treatment: str(c.treatment), medicinesGiven: str(c.medicines_administered),
      followUpPlan: str(c.follow_up_plan), followUpDate: str(c.follow_up_date), doctorNotes: str(c.doctor_notes),
      diagnoses: ((c.consultation_diagnoses ?? []) as Obj[]).map((d) => ({ label: String(d.label), primary: !!d.is_primary, certainty: str(d.certainty) })),
      revisions: ((c.consultation_revisions ?? []) as unknown[]).length,
    };
  };

  // ---- group by visit -----------------------------------------------------------------------
  const consultBy = by(consults.data as Obj[] | null, "visit_id");
  const rxBy = by(rx.data as Obj[] | null, "visit_id");
  const vaccBy = by(vacc.data as Obj[] | null, "visit_id");
  const testBy = by(tests.data as Obj[] | null, "visit_id");
  const surgBy = by(surg.data as Obj[] | null, "visit_id");
  const admBy = by(adm.data as Obj[] | null, "visit_id");
  const billBy = by(bills.data as Obj[] | null, "visit_id");
  const weightBy = by(weights.data as Obj[] | null, "visit_id");
  const stepsBy = by(steps.data as Obj[] | null, "visit_id");
  const usedSurg = new Set<string>(), usedAdm = new Set<string>(), usedBill = new Set<string>();

  const blank = (key: string, at: string, kind: Episode["kind"], title: string, petId?: unknown): Episode => ({
    key, at, kind, title, petId: typeof petId === "string" ? petId : null, petName: typeof petId === "string" ? petNames.get(petId) ?? null : null, visitId: null, token: null, status: null, reason: null, doctor: null, broughtBy: null, checkedInBy: null, homeVisit: null,
    steps: [], weight: null, consultation: null, prescriptions: [], vaccinations: [], tests: [], surgeries: [], ward: [], bills: [],
  });

  const episodes: Episode[] = (visits.data ?? []).map((v) => {
    const id = v.id as string;
    const e = blank(`v-${id}`, v.checked_in_at as string, "visit", (v.appointment_types as unknown as { name: string } | null)?.name ?? "Clinic visit", v.pet_id);
    e.visitId = id; e.token = v.token_no as number; e.status = v.status as string; e.reason = str(v.reason); e.doctor = who(v.doctor_id);
    e.broughtBy = (v.customers as unknown as { full_name: string } | null)?.full_name ?? null; e.checkedInBy = who(v.created_by);
    e.homeVisit = v.service_location === "home_visit" ? str(v.service_address) ?? "Home visit" : null;
    e.steps = (stepsBy.get(id) ?? []).map((s) => ({ at: String(s.changed_at), label: STATUS_LABEL[String(s.to_status)] ?? String(s.to_status), by: who(s.changed_by) }));
    const c = consultBy.get(id)?.[0];
    e.consultation = c ? toConsult(c) : null;
    e.prescriptions = (rxBy.get(id) ?? []).map(toRx);
    e.vaccinations = (vaccBy.get(id) ?? []).map(toVacc);
    e.tests = (testBy.get(id) ?? []).map(toTest);
    e.surgeries = (surgBy.get(id) ?? []).map((s) => (usedSurg.add(s.id as string), toSurgery(s)));
    e.ward = (admBy.get(id) ?? []).map((a) => (usedAdm.add(a.id as string), toWard(a)));
    e.bills = (billBy.get(id) ?? []).map((b) => (usedBill.add(b.id as string), toBill(b)));
    const w = weightBy.get(id)?.[0];
    e.weight = w ? num(w.weight_kg) : c?.weight_kg != null ? num(c.weight_kg) : null;
    return e;
  });

  // Things that happened outside a visit get their own entry.
  for (const s of surg.data ?? []) {
    if (usedSurg.has(s.id as string)) continue;
    const e = blank(`s-${s.id}`, String(s.procedure_start ?? s.scheduled_at ?? s.created_at), "surgery", `Surgery — ${s.procedure_name}`, s.pet_id);
    e.surgeries = [toSurgery(s)];
    e.ward = (adm.data ?? []).filter((a) => a.surgery_id === s.id && !usedAdm.has(a.id as string)).map((a) => (usedAdm.add(a.id as string), toWard(a)));
    e.bills = (bills.data ?? []).filter((b) => b.surgery_id === s.id && !usedBill.has(b.id as string)).map((b) => (usedBill.add(b.id as string), toBill(b)));
    episodes.push(e);
  }
  for (const a of adm.data ?? []) {
    if (usedAdm.has(a.id as string)) continue;
    const e = blank(`a-${a.id}`, a.admitted_at as string, "ward", "Hospital stay", a.pet_id);
    e.ward = [toWard(a)];
    e.bills = (bills.data ?? []).filter((b) => b.admission_id === a.id && !usedBill.has(b.id as string)).map((b) => (usedBill.add(b.id as string), toBill(b)));
    episodes.push(e);
  }
  for (const v of vacc.data ?? []) {
    if (v.visit_id) continue;
    const e = blank(`x-${v.id}`, v.administered_at as string, "vaccination", `Vaccination — ${v.vaccine_name}`, v.pet_id);
    e.vaccinations = [toVacc(v)];
    episodes.push(e);
  }
  for (const r of rx.data ?? []) {
    if (r.visit_id) continue;
    const e = blank(`r-${r.id}`, String(r.issued_at ?? r.created_at), "visit", `Prescription ${r.code}`, r.pet_id);
    e.prescriptions = [toRx(r)];
    episodes.push(e);
  }
  for (const b of bills.data ?? []) {
    if (usedBill.has(b.id as string)) continue;
    const e = blank(`b-${b.id}`, String(b.issued_at ?? b.created_at), "bill", b.pet_id ? "Counter bill" : "Pet store / counter bill", b.pet_id);
    e.bills = [toBill(b)];
    episodes.push(e);
  }
  episodes.sort((a, b) => b.at.localeCompare(a.at));

  // ---- summary --------------------------------------------------------------------------------
  const realVisits = (visits.data ?? []).filter((v) => v.status !== "cancelled");
  const issuedBills = (bills.data ?? []).filter((b) => b.status !== "void");
  const doctors = [...new Set(episodes.flatMap((e) => [e.doctor, e.consultation?.doctor, ...e.surgeries.map((s) => s.surgeon)]).filter((d): d is string => !!d))];
  const medicines = [...new Set(episodes.flatMap((e) => e.prescriptions.filter((p) => p.status !== "cancelled").flatMap((p) => p.lines.map((l) => l.medicine))))];
  const dates = episodes.map((e) => e.at).sort();
  return {
    episodes,
    weights: (weights.data ?? []).map((w) => ({ at: String(w.measured_at), kg: num(w.weight_kg), by: who(w.recorded_by), note: str(w.note) })),
    summary: {
      visits: realVisits.length, firstAt: dates[0] ?? null, lastAt: dates.at(-1) ?? null, doctors, medicines,
      vaccines: (vacc.data ?? []).length, surgeries: (surg.data ?? []).length, wardStays: (adm.data ?? []).length,
      billed: issuedBills.reduce((s, b) => s + num(b.total), 0), paid: issuedBills.reduce((s, b) => s + num(b.amount_paid), 0),
      owed: issuedBills.reduce((s, b) => s + num(b.balance), 0),
    },
  };
}
