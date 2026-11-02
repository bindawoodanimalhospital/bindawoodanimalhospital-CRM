import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, StatusPill } from "@/components/app/page-header";
import { VaccinesPanel } from "@/app/(app)/visits/[id]/vaccines-panel";
import { DewormingPanel } from "@/app/(app)/visits/[id]/deworming-panel";
import { VaccineList } from "@/app/(app)/settings/vaccines/vaccine-list";
import { DewormerList } from "@/app/(app)/settings/vaccines/dewormer-list";
import { ProtocolCard } from "@/app/(app)/settings/vaccines/protocol-card";
import { DueRow } from "@/app/(app)/due/due-row";
import { AppointmentRow } from "@/app/(app)/appointments/appointment-row";
import { QuickPetDemo } from "./quick-pet-demo";
import { EpisodeCard, HistorySummary } from "@/components/app/pet-history-view";
import { ReminderPlan, HowRemindersWork } from "@/components/app/reminder-plan";
import type { Episode, PetHistory } from "@/lib/pet-history";

export const metadata: Metadata = { title: "Stress test" };

/**
 * Dev-only: every vaccine / deworming / pet component with worst-case data (long names, many rows,
 * records to confirm) to catch overflow and overlap at phone, tablet and desktop widths.
 */
const LONG_VACCINE = "Biocan Novel DHPPi/L4R";
const LONG_PROTECTS = "Distemper, hepatitis, parvovirus, parainfluenza, leptospirosis (4 strains) and rabies";
const LONG_PET = "Princess Fluffington-Whiskers the Third";
const LONG_OWNER = "Muhammad Abdul Rehman Siddiqui Qureshi";
const plan = { customer: [-3, 0, 3, 7], staff: [0, 3] };

const vaccines = [
  { id: "v1", name: "PCHR (Biofel PCHR)", protects_against: "PCH + rabies", default_route: "SC", default_manufacturer: "Bioveta" },
  { id: "v3", name: LONG_VACCINE, protects_against: LONG_PROTECTS, default_route: "SC", default_manufacturer: "Bioveta a.s., Ivanovice na Hané, Czech Republic" },
];
const history = Array.from({ length: 4 }, (_, i) => ({
  id: `h${i}`, vaccine_name: i % 2 ? LONG_VACCINE : "PCHR (Biofel PCHR)", administered_at: `2026-0${i + 3}-18T07:00:00Z`,
  batch_no: i === 1 ? "BATCH-2026-00012345-LONG-LOT" : null, next_due_date: "2027-10-18",
  administered_by_name: i === 2 ? "Dr. Abubakar Naseer Siddiqui" : null, voided_at: i === 3 ? "2026-06-01" : null,
  void_reason: i === 3 ? "Entered on the wrong pet — the owner brought two cats with the same name that day" : null,
  visit_id: i === 0 ? "x" : null, confirmed: i !== 0,
}));
const dewormHistory = Array.from({ length: 4 }, (_, i) => ({
  id: `g${i}`, product: i % 2 ? "Drontal Plus Flavour XL for large dogs (35 kg)" : "Praferan", dose: i === 1 ? "1 tablet per 10 kg body weight, with food" : null,
  given_at: `2026-0${i + 3}-23T07:00:00Z`, next_due_date: "2027-01-21", given_by: null,
  voided_at: i === 3 ? "2026-06-01" : null, void_reason: i === 3 ? "Not given — a different product was given (owner had their own tablets at home)" : null,
  visit_id: i === 0 ? "x" : null, confirmed: i !== 0, tracks: i === 2 ? ["internal", "external"] : ["internal"],
}));
const dewormers = [
  { id: "w1", name: "Drontal Cat", tracks: ["internal"], covers: ["roundworm", "tapeworm", "hookworm"], dose_text: "1 tablet per 4 kg", adult_interval_days: 90 },
  { id: "w2", name: "Bravecto Plus spot-on for cats (2.8–6.25 kg)", tracks: ["internal", "external"], covers: ["roundworm", "hookworm", "fleas", "ticks", "mites", "heartworm"], dose_text: "1 pipette per cat, every 12 weeks — do not bathe for 3 days", adult_interval_days: 84 },
];
const ep = (k: Episode["kind"], i: number): Episode => ({
  key: `${k}${i}`, petId: "p", petName: LONG_PET, at: "2026-10-18T07:00:00Z", kind: k, title: k === "deworming" ? "Deworming — Drontal Plus Flavour XL for large dogs" : `${LONG_VACCINE} — ${LONG_PROTECTS}`,
  visitId: null, token: 12, status: "completed", reason: "Vaccination and deworming; owner also asked about a lump on the left hind leg near the knee",
  doctor: "Dr. Musab Bin Dawood", broughtBy: LONG_OWNER, checkedInBy: "Reception", homeVisit: null, steps: [], weight: 4.2,
  consultation: null, prescriptions: [], tests: [], surgeries: [], ward: [], bills: [],
  vaccinations: k === "vaccination" ? [{ id: "x", at: "2026-10-18T07:00:00Z", name: `${LONG_VACCINE}`, manufacturer: "Bioveta a.s.", batch: "BATCH-2026-00012345-LONG", dose: "1 ml", route: "SC", site: "Right shoulder", by: "Dr. Musab Bin Dawood", nextDue: "2027-10-18", reaction: null, notes: "From bill BD-26-000093 — waiting for the doctor to confirm what was given" }] : [],
  dewormings: k === "deworming" ? [{ id: "y", at: "2026-10-18T07:00:00Z", product: "Drontal Plus Flavour XL for large dogs (35 kg)", dose: "1 tablet per 10 kg body weight", by: "Dr. Musab Bin Dawood", nextDue: "2027-01-21" }] : [],
} as unknown as Episode);
const pethistory = {
  episodes: [ep("vaccination", 1), ep("deworming", 2)], weights: [],
  summary: { visits: 14, firstAt: "2024-01-02", lastAt: "2026-10-18", doctors: ["Dr. Musab Bin Dawood", "Dr. Abubakar Naseer", "Dr. Usama Naseer"], medicines: ["Amoxicillin-clavulanic acid 250 mg", "Meloxicam oral suspension 1.5 mg/ml"], vaccines: 6, surgeries: 1, wardStays: 1, billed: 125000, paid: 120000, owed: 5000 },
} as unknown as PetHistory;

export default function StressPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto grid max-w-7xl grid-cols-1 gap-8 p-4 md:p-6" id="stress">
      <h1 className="text-xl font-bold">Stress test — pet, vaccines, deworming</h1>

      {/* Pet page layout (same grid as /pets/[id]) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3" data-stress="pet-grid">
        <Card><CardHeader><CardTitle>Identity</CardTitle></CardHeader><CardContent><dl className="grid grid-cols-2 gap-4">
          <Field label="Species">Cat</Field><Field label="Breed">Persian × Siamese (doll face, long hair)</Field><Field label="Microchip">985112003344556123</Field><Field label="Colour">Golden-brown tabby with white</Field></dl></CardContent></Card>
        <Card><CardHeader><CardTitle>Owners</CardTitle></CardHeader><CardContent className="text-sm">{LONG_OWNER} · C-01012 <StatusPill tone="brand">Primary owner</StatusPill></CardContent></Card>
        <Card><CardHeader><CardTitle>Alerts</CardTitle></CardHeader><CardContent className="text-sm">Severe penicillin allergy — anaphylaxis in 2025</CardContent></Card>
        <Card className="lg:col-span-3"><CardHeader><CardTitle>Vaccinations</CardTitle></CardHeader><CardContent>
          <VaccinesPanel visitId={null} petId="pet-a" canRecord plan={plan} vaccines={vaccines} history={history}
            protocols={[{ id: "pr1", name: "Puppy — Biocan (Bioveta) full primary course with rabies", booster_interval_days: 365, steps: [{ step_no: 1, label: "Biocan Puppy — first dose at 6 weeks", vaccine_id: "v3", days_after_previous: null }, { step_no: 2, label: "Biocan Novel DHPPi/L4 — second dose", vaccine_id: "v3", days_after_previous: 21 }] }]}
            due={[{ id: "d1", title: `Yearly booster — ${LONG_VACCINE}`, due_on: "2027-10-18", kind: "vaccination" }, { id: "d2", title: "Rabies booster", due_on: "2026-01-01", kind: "vaccination" }]}
            billed={[{ key: "b1", vaccine_id: "v3", name: "Cat Vaccination PCH+Rabies with free health check and nail trim", date: "2026-09-02", bill_no: "BD-26-000093" }]} />
        </CardContent></Card>
        <DewormingPanel className="lg:col-span-3" visitId={null} petId="pet-a" dob="2025-04-21" weight={4.2} canRecord plan={plan} dewormers={dewormers} history={dewormHistory} />
      </div>

      {/* Visit tab (vaccines & deworming side by side as on the visit page) */}
      <div className="grid gap-6" data-stress="visit-tab">
        <VaccinesPanel visitId="visit-1" petId="pet-b" canRecord plan={plan} vaccines={vaccines} history={history} protocols={[]} due={[]} />
        <DewormingPanel visitId="visit-1" petId="pet-b" dob="2026-09-01" weight={1.1} canRecord plan={plan} dewormers={dewormers} history={dewormHistory} />
      </div>

      {/* Settings */}
      <div className="grid gap-6" data-stress="settings">
        <VaccineList canEdit species={[{ id: "s1", name: "Dog" }, { id: "s2", name: "Cat" }]}
          vaccines={[{ id: "v3", name: LONG_VACCINE, protects_against: LONG_PROTECTS, species_ids: ["s1"], default_manufacturer: "Bioveta a.s., Czech Republic", default_route: "SC", default_dose: "1 ml", is_active: true, covers: ["dog_core", "lepto", "rabies"] } as never]} />
        <DewormerList canEdit species={[{ id: "s1", name: "Dog" }, { id: "s2", name: "Cat" }]} items={[{ id: "i1", name: "Deworming (Bravecto Plus spot-on for cats)" }]}
          dewormers={[{ id: "w2", name: "Bravecto Plus spot-on for cats (2.8–6.25 kg)", species_ids: ["s2"], tracks: ["internal", "external"], covers: ["roundworm", "hookworm", "fleas", "ticks", "mites", "heartworm"], dose_text: "1 pipette per cat, every 12 weeks — do not bathe for 3 days", adult_interval_days: 84, catalog_item_id: "i1", notes: null, is_active: true }]} />
        <ProtocolCard canEdit vaccines={[{ id: "v3", name: LONG_VACCINE }]}
          p={{ id: "pr1", name: "Puppy — Biocan (Bioveta) full primary course with rabies and leptospirosis", description: "Example schedule. A senior doctor must review the intervals before approving.", species_id: null, species_name: "Dog", booster_interval_days: 365, is_approved: false, approved_by_name: null, approved_at: null, is_active: true,
            steps: [{ step_no: 1, label: "Biocan Puppy — first dose at 6 weeks of age", vaccine_id: "v3", min_age_weeks: 6, days_after_previous: null }, { step_no: 2, label: "Biocan Novel DHPPi/L4R — second dose with rabies", vaccine_id: "v3", min_age_weeks: null, days_after_previous: 21 }] }} />
      </div>

      {/* Due list, appointments, reminders, history */}
      <ul className="grid gap-2" data-stress="due">
        <DueRow canWork clinicName="Bin Dawood Animal Hospital" d={{ id: "x1", kind: "vaccination", title: `Yearly booster — ${LONG_VACCINE} (${LONG_PROTECTS})`, due_on: "2026-10-01", outcome: null, previous_due_on: "2026-09-01",
          pet: { id: "p", name: LONG_PET }, owner: { full_name: LONG_OWNER, phone: "+923001234567", whatsapp: "+923001234567" } }} />
        <DueRow canWork clinicName="Bin Dawood Animal Hospital" d={{ id: "x2", kind: "deworming", title: "Flea & tick treatment", due_on: "2026-12-01", outcome: null, previous_due_on: null,
          pet: { id: "p", name: "Moti" }, owner: null }} />
      </ul>
      <ul className="grid gap-2" data-stress="appointments">
        <AppointmentRow canManage canCheckIn doctors={[{ id: "d", full_name: "Dr. Musab Bin Dawood" }]} types={[{ id: "t", name: "Deworming", default_minutes: 10, tone: "success" }]}
          a={{ id: "a1", customer: { id: "c", title: LONG_OWNER, subtitle: "C-01012" }, pet_id: null, appointment_type_id: "t", doctor_id: null, date: "2026-11-02", time: "17:30", minutes: 10, source: "phone",
            is_urgent: true, reason: "Deworming and a quick look at the stray kitten they found near the canal yesterday evening", pre_visit_instructions: null, service_location: "clinic", service_address: null,
            starts_at: "2026-11-02T12:30:00Z", ends_at: "2026-11-02T12:40:00Z", status: "booked", visit_id: null, pet_name: null, owner_phone: "+923001234567", owner_whatsapp: "+923001234567",
            type_name: "Deworming", type_tone: "success", doctor_name: null }} />
      </ul>
      <div className="grid gap-6 lg:grid-cols-2" data-stress="misc">
        <QuickPetDemo />
        <ReminderPlan due="2027-01-21" plan={plan} what="the next flea / tick treatment" />
      </div>
      <HowRemindersWork vaccine={plan} deworming={plan} />
      <div className="grid gap-4" data-stress="history">
        <HistorySummary h={pethistory} showMoney />
        {pethistory.episodes.map((e) => <EpisodeCard key={e.key} e={e} showMoney showPrivate open showPet />)}
      </div>
    </main>
  );
}
