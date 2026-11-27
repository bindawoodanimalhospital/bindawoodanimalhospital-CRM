import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultRange, flagResult } from "@/lib/clinical";
import { ADMISSION_OUTCOMES } from "@/lib/clinic";
import { historyLines, treatmentsGiven, type HistoryLine, type TreatmentGiven } from "@/lib/consult-questions";
import type { ClinicProfile } from "@/components/print/print-shell";

/*
 * The medical record shared with a pet's owner — the same document for the staff printout and the private link.
 * Built from the CRM's own records: finalized consultations, issued prescriptions, tests, confirmed vaccines and
 * dewormings, completed surgeries and hospital stays, problems and weights. Never included: bills and money, private doctor notes, draft consultation
 * notes, cancelled prescriptions or tests, and phone numbers. Every query is filtered to the one pet, so the same
 * loader is safe with the service-role client used by the public link page.
 */

const CAP = 500;

export type RecordLabRow = {
  key: string; label: string; value: string; unit: string | null; range: string | null; flag: "H" | "L" | null;
  comment: string | null; previous: { value: string; at: string } | null;
};
export type RecordTest = {
  id: string; code: string; name: string; category: string; status: string; reason: string | null; urgent: boolean;
  orderedAt: string; orderedBy: string | null; resultedAt: string | null; resultedBy: string | null; reviewedBy: string | null;
  lab: string | null; labRef: string | null; findings: string | null; impression: string | null;
  groups: { name: string | null; rows: RecordLabRow[] }[];
};
export type RecordRx = {
  code: string; issuedAt: string; doctor: string | null; notes: string | null;
  items: { medicine: string; strength: string | null; form: string | null; dose: string; frequency: string; duration: string | null;
    route: string | null; quantity: string | null; instructions: string | null }[];
};
export type RecordConsultation = {
  doctor: string | null; finalizedAt: string | null;
  complaint: string | null; history: string | null; answers: HistoryLine[]; given: TreatmentGiven[];
  vitals: { tempC: number | null; hr: number | null; rr: number | null; weightKg: number | null; crt: number | null; mm: string | null;
    hydration: string | null; bcs: number | null; pain: number | null; pulse: string | null; mentation: string | null };
  exam: { system: string; finding: string; normal: boolean }[];
  observations: string | null; assessment: string | null;
  diagnoses: { label: string; certainty: string; primary: boolean }[];
  prognosis: string | null; treatment: string | null; medicinesGiven: string | null; advice: string | null; followUpDate: string | null;
};
export type RecordSurgery = {
  procedure: string; at: string; doctor: string | null; reason: string | null; complications: string | null;
  homeCare: string | null; checkUp: string | null; visitId: string | null;
};
export type RecordStay = {
  admittedAt: string; dischargedAt: string; doctor: string | null; reason: string; outcome: string | null; summary: string | null;
  homeCare: string | null; checkUp: string | null; visitId: string | null;
};
export type RecordVisit = {
  id: string; at: string; token: number | null; priority: string; homeVisit: boolean; reason: string | null;
  doctor: string | null; problem: { id: string; title: string } | null;
  consultation: RecordConsultation | null; draftNotes: boolean;
  prescriptions: RecordRx[]; tests: RecordTest[];
  vaccinations: { name: string; at: string; nextDue: string | null }[];
  dewormings: { product: string; dose: string | null; at: string; nextDue: string | null }[];
  surgeries?: RecordSurgery[];
  stays?: RecordStay[];
};
export type RecordProblem = {
  id: string; title: string; status: "open" | "resolved"; openedAt: string; resolvedAt: string | null;
  firstVisit: string | null; lastVisit: string | null; visits: number;
};
export type MedicalRecord = {
  generatedAt: string;
  clinic: ClinicProfile;
  pet: { id: string; code: string; name: string; species: string | null; breed: string | null; sex: string; neutered: boolean;
    color: string | null; microchip: string | null; dob: string | null; dobEstimate: boolean };
  owner: { name: string; code: string | null } | null;
  latestWeight: { kg: number; at: string } | null;
  alerts: { label: string; kind: string; severity: string }[];
  due: { title: string; dueOn: string; kind: string }[];
  lastVaccination: { name: string; at: string } | null;
  lastDeworming: { product: string; at: string; nextDue: string | null } | null;
  problems: RecordProblem[];
  scope: RecordProblem | null;
  visits: RecordVisit[];
  vaccinations: { name: string; at: string; nextDue: string | null; visitId: string | null }[];
  dewormings: { product: string; dose: string | null; at: string; nextDue: string | null; visitId: string | null }[];
  vitals: { at: string; weightKg: number | null; tempC: number | null; hr: number | null; rr: number | null }[];
  /** Surgeries and stays not tied to a visit shown above (planned straight from the pet, or from an older visit). */
  surgeries?: RecordSurgery[];
  stays?: RecordStay[];
  draftNotes: number;
};

type Obj = Record<string, unknown>;
type Field = { key: string; label: string; unit?: string; group?: string; ranges?: Record<string, string> };
const s = (v: unknown) => (v == null || v === "" ? null : String(v));
const n = (v: unknown) => (v == null || v === "" ? null : Number(v));

/** Load the record for one pet; with `problemId`, only that problem's visits. Returns null if the pet isn't found. */
export async function loadMedicalRecord(db: SupabaseClient, petId: string, problemId?: string | null): Promise<MedicalRecord | null> {
  const [pet, clinic, visits, consults, rx, tests, vacc, dew, problems, weights, alerts, due, staff, surg, adm] = await Promise.all([
    db.from("pets").select(`id, code, name, sex, is_neutered, date_of_birth, dob_is_estimate, color, microchip_no, breed_text,
      species(name), breeds(name), pet_owners(is_primary, customers(full_name, code))`).eq("id", petId).maybeSingle(),
    db.from("system_settings").select("value").eq("key", "clinic.profile").maybeSingle(),
    db.from("visits").select("id, checked_in_at, token_no, priority, reason, doctor_id, problem_id, service_location, status")
      .eq("pet_id", petId).neq("status", "cancelled").order("checked_in_at", { ascending: false }).limit(CAP),
    db.from("consultations").select(`id, visit_id, status, doctor_id, finalized_at, created_at, chief_complaint, history, temperature_c,
      heart_rate, resp_rate, weight_kg, mucous_membranes, crt_seconds, hydration, body_condition_score, pain_score, pulse_quality,
      mentation, exam, observations, assessment, prognosis, treatment, medicines_administered, follow_up_plan, follow_up_date,
      history_answers, treatments_given, consultation_diagnoses(label, certainty, is_primary, created_at)`).eq("pet_id", petId).order("created_at", { ascending: false }).limit(CAP),
    db.from("prescriptions").select(`code, status, notes, issued_at, created_at, doctor_id, visit_id,
      prescription_items(medicine_name, strength, form, dose, frequency, duration, route, quantity, instructions, sort_order)`)
      .eq("pet_id", petId).eq("status", "issued").order("issued_at", { ascending: false }).limit(CAP),
    db.from("diagnostic_orders").select(`id, code, visit_id, status, reason, is_urgent, created_at, ordered_by, resulted_at, resulted_by,
      reviewed_by, external_lab, external_ref, findings, impression, result_values, result_meta,
      diagnostic_types(id, name, category, result_fields)`).eq("pet_id", petId).neq("status", "cancelled")
      .order("created_at", { ascending: false }).limit(CAP),
    db.from("vaccinations").select("vaccine_name, administered_at, next_due_date, visit_id").eq("pet_id", petId)
      .is("voided_at", null).eq("confirmed", true).order("administered_at", { ascending: false }).limit(CAP),
    db.from("dewormings").select("product, dose, given_at, next_due_date, visit_id").eq("pet_id", petId)
      .is("voided_at", null).eq("confirmed", true).order("given_at", { ascending: false }).limit(CAP),
    db.from("pet_problems").select("id, title, status, opened_at, resolved_at").eq("pet_id", petId).order("opened_at", { ascending: false }),
    db.from("pet_weights").select("weight_kg, measured_at").eq("pet_id", petId).order("measured_at", { ascending: false }).limit(1),
    db.from("pet_alerts").select("label, kind, severity").eq("pet_id", petId).eq("is_active", true),
    db.from("due_items").select("title, due_on, kind").eq("pet_id", petId).eq("status", "pending").order("due_on").limit(20),
    db.from("staff").select("id, full_name"),
    db.from("surgeries").select(`visit_id, procedure_name, indication, procedure_start, discharged_at, discharge_instructions, follow_up_date,
      complications, surgeon_id`).eq("pet_id", petId).not("discharged_at", "is", null).order("discharged_at", { ascending: false }).limit(CAP),
    db.from("admissions").select(`visit_id, reason, admitted_at, discharged_at, outcome, discharge_summary, discharge_instructions,
      follow_up_date, attending_doctor_id`).eq("pet_id", petId).eq("status", "discharged").order("discharged_at", { ascending: false }).limit(CAP),
  ]);
  if (!pet.data) return null;

  const name = new Map(((staff.data ?? []) as { id: string; full_name: string }[]).map((x) => [x.id, x.full_name]));
  const who = (id: unknown) => (id ? name.get(String(id)) ?? null : null);
  const p = pet.data as Obj;
  const species = (p.species as { name: string } | null)?.name ?? null;
  const owners = (p.pet_owners ?? []) as { is_primary: boolean; customers: { full_name: string; code: string | null } | null }[];
  const owner = (owners.find((o) => o.is_primary) ?? owners[0])?.customers ?? null;

  // Lab values, oldest first, so each result can show the one before it.
  type Order = Obj & { diagnostic_types: { name: string; category: string; result_fields: Field[] } | null };
  const orders = (tests.data ?? []) as unknown as Order[];
  const history = new Map<string, { value: string; at: string }[]>();
  for (const o of [...orders].reverse()) {
    if (!["resulted", "reviewed"].includes(String(o.status))) continue;
    for (const [k, v] of Object.entries((o.result_values ?? {}) as Record<string, string>)) {
      const id = `${o.diagnostic_types?.name}|${k}`;
      history.set(id, [...(history.get(id) ?? []), { value: v, at: String(o.resulted_at ?? o.created_at) }]);
    }
  }
  const toTest = (o: Order): RecordTest => {
    const type = o.diagnostic_types;
    const values = (o.result_values ?? {}) as Record<string, string>;
    const meta = (o.result_meta ?? {}) as Record<string, { range?: string; comment?: string }>;
    const resulted = ["resulted", "reviewed"].includes(String(o.status));
    const at = String(o.resulted_at ?? o.created_at);
    const groups: RecordTest["groups"] = [];
    if (resulted) {
      for (const f of type?.result_fields ?? []) {
        const value = s(values[f.key]);
        if (!value) continue;
        const range = s(meta[f.key]?.range) ?? (defaultRange(f, species) || null);
        const prior = (history.get(`${type?.name}|${f.key}`) ?? []).filter((h) => h.at < at);
        const row: RecordLabRow = { key: f.key, label: f.label, value, unit: f.unit || null, range, flag: flagResult(value, range),
          comment: s(meta[f.key]?.comment), previous: prior.at(-1) ?? null };
        const g = f.group ?? null;
        const last = groups.at(-1);
        if (last && last.name === g) last.rows.push(row); else groups.push({ name: g, rows: [row] });
      }
    }
    return {
      id: String(o.id), code: String(o.code), name: type?.name ?? "Test", category: type?.category ?? "", status: String(o.status),
      reason: s(o.reason), urgent: Boolean(o.is_urgent), orderedAt: String(o.created_at), orderedBy: who(o.ordered_by),
      resultedAt: resulted ? at : null, resultedBy: who(o.resulted_by), reviewedBy: who(o.reviewed_by),
      lab: s(o.external_lab), labRef: s(o.external_ref), findings: resulted ? s(o.findings) : null, impression: resulted ? s(o.impression) : null, groups,
    };
  };

  type Consult = Obj & { consultation_diagnoses: { label: string; certainty: string; is_primary: boolean; created_at: string }[] };
  const consultations = (consults.data ?? []) as unknown as Consult[];
  const toConsultation = (c: Consult): RecordConsultation => ({
    doctor: who(c.doctor_id), finalizedAt: s(c.finalized_at),
    complaint: s(c.chief_complaint), history: s(c.history), answers: historyLines(c.history_answers), given: treatmentsGiven(c.treatments_given),
    vitals: { tempC: n(c.temperature_c), hr: n(c.heart_rate), rr: n(c.resp_rate), weightKg: n(c.weight_kg), crt: n(c.crt_seconds),
      mm: s(c.mucous_membranes), hydration: s(c.hydration), bcs: n(c.body_condition_score), pain: n(c.pain_score),
      pulse: s(c.pulse_quality), mentation: s(c.mentation) },
    exam: Object.entries((c.exam ?? {}) as Record<string, string>).filter(([, v]) => v?.trim())
      .map(([system, finding]) => ({ system, finding, normal: finding.trim().toLowerCase() === "normal" })),
    observations: s(c.observations), assessment: s(c.assessment),
    diagnoses: [...(c.consultation_diagnoses ?? [])]
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.created_at.localeCompare(b.created_at))
      .map((d) => ({ label: d.label, certainty: d.certainty, primary: d.is_primary })),
    prognosis: s(c.prognosis), treatment: s(c.treatment), medicinesGiven: s(c.medicines_administered),
    advice: s(c.follow_up_plan), followUpDate: s(c.follow_up_date),
  });

  type Rx = Obj & { prescription_items: (Obj & { sort_order: number })[] };
  const toRx = (r: Rx): RecordRx => ({
    code: String(r.code), issuedAt: String(r.issued_at ?? r.created_at), doctor: who(r.doctor_id), notes: s(r.notes),
    items: [...(r.prescription_items ?? [])].sort((a, b) => a.sort_order - b.sort_order).map((i) => ({
      medicine: String(i.medicine_name), strength: s(i.strength), form: s(i.form), dose: String(i.dose), frequency: String(i.frequency),
      duration: s(i.duration), route: s(i.route), quantity: s(i.quantity), instructions: s(i.instructions) })),
  });

  const vaccinations = ((vacc.data ?? []) as Obj[]).map((v) => ({ name: String(v.vaccine_name), at: String(v.administered_at),
    nextDue: s(v.next_due_date), visitId: s(v.visit_id) }));
  const dewormings = ((dew.data ?? []) as Obj[]).map((d) => ({ product: String(d.product), dose: s(d.dose), at: String(d.given_at),
    nextDue: s(d.next_due_date), visitId: s(d.visit_id) }));

  const surgeries: RecordSurgery[] = ((surg.data ?? []) as Obj[]).map((x) => ({ procedure: String(x.procedure_name),
    at: String(x.procedure_start ?? x.discharged_at), doctor: who(x.surgeon_id), reason: s(x.indication), complications: s(x.complications),
    homeCare: s(x.discharge_instructions), checkUp: s(x.follow_up_date), visitId: s(x.visit_id) }));
  const stays: RecordStay[] = ((adm.data ?? []) as Obj[]).map((x) => ({ admittedAt: String(x.admitted_at), dischargedAt: String(x.discharged_at),
    doctor: who(x.attending_doctor_id), reason: String(x.reason), outcome: ADMISSION_OUTCOMES.find((o) => o.value === x.outcome)?.label ?? null,
    summary: s(x.discharge_summary), homeCare: s(x.discharge_instructions), checkUp: s(x.follow_up_date), visitId: s(x.visit_id) }));

  const allVisits = (visits.data ?? []) as Obj[];
  const problemList = ((problems.data ?? []) as Obj[]).map((pr): RecordProblem => {
    const vs = allVisits.filter((v) => v.problem_id === pr.id).map((v) => String(v.checked_in_at)).sort();
    return { id: String(pr.id), title: String(pr.title), status: pr.status === "resolved" ? "resolved" : "open",
      openedAt: String(pr.opened_at), resolvedAt: s(pr.resolved_at), firstVisit: vs[0] ?? null, lastVisit: vs.at(-1) ?? null, visits: vs.length };
  });
  const scope = problemId ? problemList.find((pr) => pr.id === problemId) ?? null : null;
  if (problemId && !scope) return null;
  const inScope = scope ? allVisits.filter((v) => v.problem_id === scope.id) : allVisits;

  let draftNotes = 0;
  const recordVisits: RecordVisit[] = inScope.map((v) => {
    const cs = consultations.filter((c) => c.visit_id === v.id);
    const final = cs.find((c) => c.status === "finalized") ?? null;
    const drafts = cs.some((c) => c.status !== "finalized");
    if (drafts && !final) draftNotes++;
    const pr = problemList.find((x) => x.id === v.problem_id);
    return {
      id: String(v.id), at: String(v.checked_in_at), token: n(v.token_no), priority: String(v.priority ?? "normal"),
      homeVisit: v.service_location === "home_visit", reason: s(v.reason), doctor: who(final?.doctor_id ?? v.doctor_id),
      problem: pr ? { id: pr.id, title: pr.title } : null,
      consultation: final ? toConsultation(final) : null, draftNotes: drafts && !final,
      prescriptions: ((rx.data ?? []) as unknown as Rx[]).filter((r) => r.visit_id === v.id).map(toRx),
      tests: orders.filter((o) => o.visit_id === v.id).map(toTest),
      vaccinations: vaccinations.filter((x) => x.visitId === v.id).map(({ name: nm, at, nextDue }) => ({ name: nm, at, nextDue })),
      dewormings: dewormings.filter((x) => x.visitId === v.id).map(({ product, dose, at, nextDue }) => ({ product, dose, at, nextDue })),
      surgeries: surgeries.filter((x) => x.visitId === v.id),
      stays: stays.filter((x) => x.visitId === v.id),
    };
  });

  const inScopeIds = new Set(recordVisits.map((v) => v.id));
  const vitals = consultations.filter((c) => c.status === "finalized" && (!scope || inScopeIds.has(String(c.visit_id))))
    .map((c) => ({ at: String(c.finalized_at ?? c.created_at), weightKg: n(c.weight_kg), tempC: n(c.temperature_c), hr: n(c.heart_rate), rr: n(c.resp_rate) }))
    .filter((x) => x.weightKg != null || x.tempC != null || x.hr != null || x.rr != null);
  const w = (weights.data ?? [])[0] as Obj | undefined;

  return {
    generatedAt: new Date().toISOString(),
    clinic: ((clinic.data as Obj | null)?.value ?? {}) as ClinicProfile,
    pet: { id: String(p.id), code: String(p.code), name: String(p.name), species,
      breed: (p.breeds as { name: string } | null)?.name ?? s(p.breed_text), sex: String(p.sex ?? "unknown"), neutered: Boolean(p.is_neutered),
      color: s(p.color), microchip: s(p.microchip_no), dob: s(p.date_of_birth), dobEstimate: Boolean(p.dob_is_estimate) },
    owner: owner ? { name: owner.full_name, code: owner.code } : null,
    latestWeight: w ? { kg: Number(w.weight_kg), at: String(w.measured_at) } : null,
    alerts: ((alerts.data ?? []) as Obj[]).map((a) => ({ label: String(a.label), kind: String(a.kind), severity: String(a.severity) })),
    due: ((due.data ?? []) as Obj[]).map((d) => ({ title: String(d.title), dueOn: String(d.due_on), kind: String(d.kind) })),
    lastVaccination: vaccinations[0] ? { name: vaccinations[0].name, at: vaccinations[0].at } : null,
    lastDeworming: dewormings[0] ? { product: dewormings[0].product, at: dewormings[0].at, nextDue: dewormings[0].nextDue } : null,
    problems: problemList, scope, visits: recordVisits,
    vaccinations: scope ? vaccinations.filter((x) => x.visitId && inScopeIds.has(x.visitId)) : vaccinations,
    dewormings: scope ? dewormings.filter((x) => x.visitId && inScopeIds.has(x.visitId)) : dewormings,
    vitals, draftNotes,
    surgeries: scope ? [] : surgeries.filter((x) => !x.visitId || !inScopeIds.has(x.visitId)),
    stays: scope ? [] : stays.filter((x) => !x.visitId || !inScopeIds.has(x.visitId)),
  };
}
