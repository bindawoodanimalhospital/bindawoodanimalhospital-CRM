import { notFound } from "next/navigation";
import { PrintShell } from "@/components/print/print-shell";
import { MedicalRecordView } from "@/components/app/medical-record";
import type { MedicalRecord } from "@/lib/medical-record";
import { RecordCard } from "@/app/(app)/pets/[id]/record-card";
import { ProblemPicker } from "@/app/(app)/visits/[id]/problem-picker";
import { TestsPanel, type DiagnosticType } from "@/app/(app)/visits/[id]/tests-panel";

/* Dev-only: the owner's medical record and its screens with worst-case sample data (no database). */

const CBC: DiagnosticType = { id: "t-cbc", name: "CBC (complete blood count)", category: "lab", result_fields: [
  { key: "rbc", label: "RBC", unit: "×10⁶/µL", group: "Red cells", ranges: { Cat: "5.0-10.0" } },
  { key: "hb", label: "Haemoglobin (HB)", unit: "g/dL", group: "Red cells", ranges: { Cat: "8.0-15.0" } },
  { key: "pcv", label: "HCT / PCV", unit: "%", group: "Red cells", ranges: { Cat: "24-45" } },
  { key: "wbc", label: "WBC", unit: "×10³/µL", group: "White cells", ranges: { Cat: "5.5-19.5" } },
  { key: "neu_pct", label: "Neutrophils %", unit: "%", group: "White cells", ranges: { Cat: "35-75" } },
  { key: "bas_pct", label: "Basophils %", unit: "%", group: "White cells", ranges: { Cat: "< 1" } },
  { key: "plt", label: "Platelets (PLT)", unit: "×10³/µL", group: "Platelets", ranges: { Cat: "300-800" } },
] };

const sample: MedicalRecord = {
  generatedAt: "2026-10-25T10:40:00Z",
  clinic: { name: "Green Valley Animal Hospital", address: "12 Canal View Road", city: "Lahore", phone: "+923001234567", whatsapp: "+923001234567" },
  pet: { id: "p1", code: "P-00412", name: "Daisy", species: "Cat", breed: "Domestic Shorthair", sex: "male", neutered: true, color: "Grey tabby",
    microchip: "985112003344556", dob: "2022-10-01", dobEstimate: true },
  owner: { name: "Hafsa Ahmed", code: "C-00087" },
  latestWeight: { kg: 4.1, at: "2026-10-25T05:32:00Z" },
  alerts: [{ label: "Penicillin", kind: "allergy", severity: "critical" }, { label: "Bites when handled", kind: "behaviour", severity: "warning" }],
  due: [{ title: "Rabies booster", dueOn: "2027-03-02", kind: "vaccination" }, { title: "Deworming", dueOn: "2026-11-20", kind: "deworming" }],
  lastVaccination: { name: "Feline PCHR (Biofel PCHR)", at: "2026-03-02T07:00:00Z" },
  lastDeworming: { product: "Drontal Cat", at: "2026-08-20T07:00:00Z", nextDue: "2026-11-20" },
  problems: [
    { id: "pr1", title: "Severe renal insult (kidney failure)", status: "open", openedAt: "2026-10-16T05:00:00Z", resolvedAt: null, firstVisit: "2026-10-16T05:00:00Z", lastVisit: "2026-10-25T05:32:00Z", visits: 2 },
    { id: "pr2", title: "Skin allergy", status: "resolved", openedAt: "2026-04-01T05:00:00Z", resolvedAt: "2026-04-20T05:00:00Z", firstVisit: "2026-04-01T05:00:00Z", lastVisit: "2026-04-08T05:00:00Z", visits: 2 },
  ],
  scope: null,
  visits: [
    {
      id: "v2", at: "2026-10-25T05:32:00Z", token: 14, priority: "emergency", homeVisit: false, reason: "Not eating, vomiting", doctor: "Dr. Sara Ahmed",
      problem: { id: "pr1", title: "Severe renal insult (kidney failure)" }, draftNotes: false,
      consultation: {
        doctor: "Dr. Sara Ahmed", finalizedAt: "2026-10-25T06:10:00Z",
        complaint: "Stopped eating one day ago; repeated vomiting and nausea.",
        history: "Previously obese, significant weight loss over two months. A lab test at another clinic nine days ago showed a normal blood count and liver tests, but markedly raised kidney values (creatinine 10 mg/dL).",
        vitals: { tempC: 39.1, hr: 144, rr: 32, weightKg: 4.1, crt: 3, mm: "Pale", hydration: "Moderate (8%)", bcs: 4, pain: 2,
          pulse: "Strong and synchronous", mentation: "QAR (quiet, alert, responsive)" },
        exam: [
          { system: "Eyes", finding: "Conjunctiva pale; no discharge", normal: false },
          { system: "Oral cavity", finding: "Pale mucous membranes, uraemic breath", normal: false },
          { system: "Skin / coat", finding: "Unkempt coat", normal: false },
          { system: "Gastrointestinal", finding: "Vomiting; pasty stool with blood", normal: false },
          { system: "Heart", finding: "Normal", normal: true }, { system: "Lungs", finding: "Normal", normal: true },
          { system: "Lymph nodes", finding: "Normal", normal: true },
        ],
        observations: null,
        assessment: "Severe azotaemia with advanced kidney dysfunction; creatinine has risen from 10 to 12 mg/dL. Anaemia (HCT 15%) consistent with chronic kidney disease.",
        diagnoses: [{ label: "Severe renal insult", certainty: "confirmed", primary: true },
          { label: "Acute kidney injury", certainty: "provisional", primary: false }, { label: "Acute on chronic kidney disease", certainty: "provisional", primary: false },
          { label: "Pyelonephritis", certainty: "ruled_out", primary: false }],
        prognosis: "Guarded",
        treatment: "IV isotonic fluids (Ringer lactate) at a calculated rate; anti-nausea injection.",
        medicinesGiven: "Inj. Ondansetron 0.5 mg/kg IV; Inj. Tropin SC.",
        advice: "Give medicines exactly as written. Renal diet only. Repeat blood tests in 3 days — come back sooner if vomiting returns or Daisy stops drinking.",
        followUpDate: "2026-10-28",
      },
      prescriptions: [{ code: "RX-000231", issuedAt: "2026-10-25T06:12:00Z", doctor: "Dr. Sara Ahmed", notes: "Inj. Tropin will be given 3 times a week at the clinic.",
        items: [
          { medicine: "Syp. Renelof", strength: null, form: "syrup", dose: "1.5 ml", frequency: "BD", duration: "14 days", route: "Oral", quantity: "1 bottle", instructions: "After food" },
          { medicine: "Tab. Renitec", strength: "5 mg", form: "tablet", dose: "½ tab", frequency: "OD", duration: "30 days", route: "Oral", quantity: null, instructions: null },
          { medicine: "Tab. Mirtazep", strength: "15 mg", form: "tablet", dose: "¼ tab", frequency: "EOD", duration: null, route: "Oral", quantity: null, instructions: "Appetite stimulant" },
        ] }],
      tests: [
        { id: "dx1", code: "DX-000041", name: "CBC (complete blood count)", category: "lab", status: "reviewed", reason: "Anaemia, kidney disease", urgent: true,
          orderedAt: "2026-10-25T05:40:00Z", orderedBy: "Dr. Sara Ahmed", resultedAt: "2026-10-25T10:27:00Z", resultedBy: "Dr. Sara Ahmed", reviewedBy: "Dr. Sara Ahmed",
          lab: "Center for Animal Diagnostics (CADx)", labRef: "670016-25-10", findings: null, impression: "Regenerative-looking anaemia with marked neutrophilia.",
          groups: [
            { name: "Red cells", rows: [
              { key: "hb", label: "Haemoglobin (HB)", value: "6.3", unit: "g/dL", range: "9.5 - 15", flag: "L", comment: "Anaemia", previous: { value: "8.1", at: "2026-10-16T09:00:00Z" } },
              { key: "pcv", label: "HCT / PCV", value: "15.6", unit: "%", range: "29 - 45", flag: "L", comment: null, previous: { value: "21", at: "2026-10-16T09:00:00Z" } },
              { key: "mcv", label: "MCV", value: "43", unit: "fL", range: "41 - 54", flag: null, comment: null, previous: null } ] },
            { name: "White cells", rows: [
              { key: "wbc", label: "WBC", value: "31.83", unit: "×10³/µL", range: "5.5 - 19.5", flag: "H", comment: null, previous: { value: "18.2", at: "2026-10-16T09:00:00Z" } },
              { key: "bas_pct", label: "Basophils %", value: "0", unit: "%", range: "< 1", flag: null, comment: null, previous: null } ] },
          ] },
        { id: "dx2", code: "DX-000042", name: "Blood chemistry (LFT / RFT)", category: "lab", status: "reviewed", reason: null, urgent: false,
          orderedAt: "2026-10-25T05:40:00Z", orderedBy: "Dr. Sara Ahmed", resultedAt: "2026-10-25T10:27:00Z", resultedBy: null, reviewedBy: "Dr. Sara Ahmed",
          lab: null, labRef: null, findings: null, impression: null,
          groups: [
            { name: "Kidney (RFT)", rows: [
              { key: "creat", label: "Creatinine", value: "12.18", unit: "mg/dL", range: "0.8 - 2.3", flag: "H", comment: "Rising", previous: { value: "10.0", at: "2026-10-16T09:00:00Z" } },
              { key: "bun", label: "BUN", value: "145.6", unit: "mg/dL", range: "15 - 34", flag: "H", comment: null, previous: null } ] },
            { name: "Electrolytes & minerals", rows: [
              { key: "k", label: "Potassium (K)", value: "5.5", unit: "mmol/L", range: "3.9 - 5.3", flag: "H", comment: null, previous: null },
              { key: "phos", label: "Phosphorus", value: "3.68", unit: "mg/dL", range: "3 - 7", flag: null, comment: null, previous: null } ] },
          ] },
        { id: "dx3", code: "DX-000043", name: "Abdominal ultrasound", category: "ultrasound", status: "ordered", reason: null, urgent: false,
          orderedAt: "2026-10-25T06:00:00Z", orderedBy: "Dr. Sara Ahmed", resultedAt: null, resultedBy: null, reviewedBy: null, lab: null, labRef: null,
          findings: null, impression: null, groups: [] },
      ],
      vaccinations: [], dewormings: [],
    },
    {
      id: "v1", at: "2026-10-16T05:00:00Z", token: 3, priority: "normal", homeVisit: true, reason: "Weight loss, lethargic", doctor: "Dr. Ali Khan",
      problem: { id: "pr1", title: "Severe renal insult (kidney failure)" }, consultation: null, draftNotes: true,
      prescriptions: [], tests: [], vaccinations: [{ name: "Rabies", at: "2026-10-16T05:30:00Z", nextDue: "2027-10-16" }], dewormings: [],
    },
  ],
  vaccinations: [{ name: "Rabies", at: "2026-10-16T05:30:00Z", nextDue: "2027-10-16", visitId: "v1" }, { name: "Feline PCHR (Biofel PCHR)", at: "2026-03-02T07:00:00Z", nextDue: "2027-03-02", visitId: null }],
  dewormings: [{ product: "Drontal Cat", dose: "1 tablet", at: "2026-08-20T07:00:00Z", nextDue: "2026-11-20", visitId: null }],
  vitals: [{ at: "2026-10-25T06:10:00Z", weightKg: 4.1, tempC: 39.1, hr: 144, rr: 32 }, { at: "2026-08-20T06:10:00Z", weightKg: 6.8, tempC: 38.6, hr: 160, rr: 28 }],
  draftNotes: 1,
};

export default function MedicalRecordDesign() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <div id="mr-design" className="grid gap-10 bg-background pb-10">
      <PrintShell clinic={sample.clinic} title="Medical record" footer="Sample record (dev only)">
        <MedicalRecordView r={sample} />
      </PrintShell>
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-6 px-4">
        <RecordCard petId="p1" petName="Daisy" ownerWhatsapp="+923001234567" canEdit draftNotes={1}
          problems={sample.problems.map((p) => ({ id: p.id, title: p.title, status: p.status, opened_at: p.openedAt, resolved_at: p.resolvedAt, visits: p.visits }))}
          shares={[{ id: "s1", problem_id: "pr1", created_at: "2026-10-25T10:45:00Z", expires_at: "2026-11-24T10:45:00Z", views: 3, last_viewed_at: "2026-10-26T08:00:00Z", created_by_name: "Dr. Sara Ahmed" },
            { id: "s2", problem_id: null, created_at: "2026-10-25T10:50:00Z", expires_at: "2026-11-24T10:50:00Z", views: 0, last_viewed_at: null, created_by_name: "Reception" }]} />
        <ProblemPicker visitId="v2" canEdit current={{ id: "pr1", title: sample.problems[0].title, status: "open" }}
          options={sample.problems.map((p) => ({ id: p.id, title: p.title, status: p.status }))} />
        <TestsPanel visitId="v2" petId="p1" species="Cat" consultationId={null} types={[CBC]} canManage canUpload={false}
          orders={[{ id: "dx1", code: "DX-000041", status: "resulted", type: CBC, reason: "Anaemia", is_urgent: true, findings: null, impression: null,
            result_values: { hb: "6.3", pcv: "15.6", wbc: "31.83", bas_pct: "0" }, result_meta: { hb: { range: "9.5 - 15", comment: "Anaemia" } },
            external_lab: "Center for Animal Diagnostics (CADx)", external_ref: "670016-25-10",
            created_at: "2026-10-25T05:40:00Z", ordered_by_name: "Dr. Sara Ahmed", reviewed_at: null, cancel_reason: null, files: [] }]} />
      </div>
    </div>
  );
}
