import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BedDouble, OctagonAlert, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, StatusPill } from "@/components/app/page-header";
import { NoticeToast } from "@/components/app/notice-toast";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDoctors, getKennels, getSetting, getStaffOptions } from "@/lib/queries";
import { formatAge } from "@/lib/format";
import { SURGERY_LABEL, SURGERY_TONE, URGENCY } from "@/lib/clinic";
import { AdmitDialog } from "../../ward/admit-dialog";
import { ConsentDialog } from "./consent-dialog";
import { SurgeryWorkspace, type SurgeryData } from "./workspace";

export const metadata: Metadata = { title: "Surgery" };

const FIELDS = ["procedure_name", "indication", "urgency", "surgeon_id", "scheduled_at", "estimate_amount", "estimate_notes",
  "pre_op_instructions", "preop_weight_kg", "preop_temperature_c", "preop_heart_rate", "preop_resp_rate", "asa_class",
  "fasting_confirmed", "preop_notes", "anaesthesia_protocol", "intra_op_notes", "complications", "recovery_notes",
  "discharge_instructions", "follow_up_date"] as const;

export default async function SurgeryDetailPage({ params }: PageProps<"/surgery/[id]">) {
  const me = await requireStaff();
  if (!me.can("clinical.view") && !me.can("surgery.consent")) redirect("/dashboard?denied=1");
  const { id } = await params;
  const supabase = await createClient();

  const { data: s } = await supabase.from("surgeries")
    .select(`*, pets(id, name, sex, date_of_birth, dob_is_estimate, special_handling, species(name), breeds(name), breed_text,
      pet_alerts(label, kind, severity, is_active)), customers(id, full_name, phone),
      surgery_consents(id, signed_by_name, relationship, method, signed_at, revoked_at, revoked_reason, witnessed_by),
      surgery_team(staff_id, role), surgery_events(id, kind, at, data, note, recorded_by),
      surgery_consumables(id, item_name, quantity, unit, batch_no, created_at)`)
    .eq("id", id).maybeSingle();
  if (!s) notFound();

  const [doctors, staff, kennels, consentText, checklist, { data: admission }, { data: names }] = await Promise.all([
    getDoctors(), getStaffOptions(), getKennels(),
    getSetting<{ en: string; ur: string; status?: string }>("surgery.consent_text"),
    getSetting<string[]>("surgery.preop_checklist"),
    supabase.from("admissions").select("id").eq("surgery_id", id).order("admitted_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("staff").select("id, full_name"),
  ]);
  const nameOf = new Map((names ?? []).map((n) => [n.id, n.full_name]));

  type Pet = { id: string; name: string; sex: string; date_of_birth: string | null; dob_is_estimate: boolean; special_handling: string | null;
    species: { name: string } | null; breeds: { name: string } | null; breed_text: string | null;
    pet_alerts: { label: string; kind: string; severity: string; is_active: boolean }[] };
  const pet = s.pets as unknown as Pet;
  const owner = s.customers as unknown as { id: string; full_name: string; phone: string };

  const data: SurgeryData = {
    id: s.id, code: s.code, status: s.status, urgency: s.urgency, procedure_name: s.procedure_name,
    fields: Object.fromEntries(FIELDS.map((k) => [k, s[k] ?? null])),
    preop_checklist: (s.preop_checklist ?? {}) as Record<string, boolean>,
    preop_checked_at: s.preop_checked_at, preop_checked_by_name: s.preop_checked_by ? nameOf.get(s.preop_checked_by) ?? null : null,
    procedure_start: s.procedure_start, procedure_end: s.procedure_end, discharged_at: s.discharged_at,
    emergency_override_reason: s.emergency_override_reason, cancel_reason: s.cancel_reason, reopened_reason: s.reopened_reason,
    owner: { name: owner.full_name, phone: owner.phone }, pet: { id: pet.id, name: pet.name, customer_id: owner.id },
    consents: ((s.surgery_consents ?? []) as (SurgeryData["consents"][number] & { witnessed_by: string | null })[])
      .map((c) => ({ ...c, witness: c.witnessed_by ? nameOf.get(c.witnessed_by) ?? null : null })),
    team: (s.surgery_team ?? []) as SurgeryData["team"],
    events: ((s.surgery_events ?? []) as (Omit<SurgeryData["events"][number], "by"> & { recorded_by: string | null })[])
      .map((e) => ({ ...e, by: e.recorded_by ? nameOf.get(e.recorded_by) ?? null : null }))
      .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id),
    consumables: ((s.surgery_consumables ?? []) as (SurgeryData["consumables"][number] & { created_at: string })[])
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    admission_id: admission?.id ?? null,
  };

  const alerts = (pet.pet_alerts ?? []).filter((a) => a.is_active && a.severity !== "info");
  const clinical = me.can("clinical.view");

  return (
    <>
      <Suspense><NoticeToast /></Suspense>
      <PageHeader
        back={{ href: "/surgery", label: "Surgery" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Link href={`/pets/${pet.id}`} className="hover:underline">{pet.name}</Link>
            <span className="font-normal text-muted-foreground">{s.procedure_name}</span>
            <StatusPill tone={SURGERY_TONE[s.status as keyof typeof SURGERY_TONE]}>{SURGERY_LABEL[s.status as keyof typeof SURGERY_LABEL]}</StatusPill>
            {s.urgency !== "elective" && <StatusPill tone={URGENCY[s.urgency].tone}>{URGENCY[s.urgency].label}</StatusPill>}
          </span>
        }
        description={[s.code, pet.species?.name, pet.breeds?.name ?? pet.breed_text, pet.sex !== "unknown" ? pet.sex : null,
          formatAge(pet.date_of_birth, pet.dob_is_estimate)].filter(Boolean).join(" · ")}
        actions={<Button asChild variant="outline"><a href={`tel:${owner.phone}`}><Phone /> {owner.full_name}</a></Button>}
      />

      {(pet.special_handling || alerts.length > 0) && (
        <div className="-mt-4 mb-6 flex flex-wrap gap-2">
          {pet.special_handling && <Alert text={pet.special_handling} critical />}
          {alerts.map((a) => <Alert key={a.label} text={`${a.kind === "allergy" ? "Allergy: " : ""}${a.label}`} critical={a.severity === "critical"} />)}
        </div>
      )}

      {clinical ? (
        <SurgeryWorkspace s={data} doctors={doctors} staff={staff} checklist={checklist ?? []}
          consentText={consentText ?? { en: "", ur: "" }}
          perms={{ manage: me.can("surgery.manage"), assist: me.can("surgery.assist"), consent: me.can("surgery.consent"),
            reopen: me.can("clinical.reopen"), clinical }}
          admitSlot={me.can("inpatient.manage") && ["recovery", "discharged"].includes(s.status) ? (
            <AdmitDialog kennels={kennels} doctors={doctors}
              fixed={{ pet_id: pet.id, pet_name: pet.name, customer_id: owner.id, surgery_id: s.id, visit_id: s.visit_id ?? undefined, reason: `Recovery after ${s.procedure_name}` }}
              trigger={<Button variant="outline"><BedDouble /> Keep in ward</Button>} />
          ) : null} />
      ) : (
        <ReceptionView data={data} consentText={consentText ?? { en: "", ur: "" }} />
      )}
    </>
  );
}

function Alert({ text, critical }: { text: string; critical: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ring-1 ${critical ? "bg-danger-soft text-danger ring-danger/20" : "bg-warning-soft text-warning ring-warning/20"}`}>
      <OctagonAlert className="size-4" /> {text}
    </span>
  );
}

/** Reception sees scheduling, estimate and consent — not the clinical notes. */
function ReceptionView({ data, consentText }: { data: SurgeryData; consentText: { en: string; ur: string; status?: string } }) {
  const consent = data.consents.find((c) => !c.revoked_at);
  return (
    <div className="grid max-w-xl gap-4 rounded-2xl bg-card p-6 shadow-card ring-1 ring-border">
      <p><span className="text-muted-foreground">Estimate:</span> <b>{data.fields.estimate_amount ? `Rs. ${Number(data.fields.estimate_amount).toLocaleString("en-PK")}` : "not set"}</b></p>
      {data.fields.pre_op_instructions && <p><span className="text-muted-foreground">Owner instructions:</span> {String(data.fields.pre_op_instructions)}</p>}
      {consent
        ? <StatusPill tone="success" className="w-fit">Consent recorded by {consent.signed_by_name}</StatusPill>
        : ["planned", "scheduled", "admitted", "pre_op"].includes(data.status) && (
          <ConsentDialog surgeryId={data.id} procedure={data.procedure_name} estimate={(data.fields.estimate_amount as number) ?? null}
            ownerName={data.owner.name} ownerPhone={data.owner.phone} text={consentText} draft={consentText.status === "draft"} />
        )}
    </div>
  );
}
