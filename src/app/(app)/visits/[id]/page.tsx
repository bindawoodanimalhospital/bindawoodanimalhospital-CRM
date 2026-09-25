import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BedDouble, FlaskConical, MessageCircle, OctagonAlert, PawPrint, Phone, Pill, Scissors, Stethoscope, Syringe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, StatusPill } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatAge, formatTime } from "@/lib/format";
import { getDoctors, getKennels } from "@/lib/queries";
import { PlanSurgeryDialog } from "../../surgery/plan-dialog";
import { AdmitDialog } from "../../ward/admit-dialog";
import { whatsappLink } from "@/lib/phone";
import { PRIORITY, VISIT_STATUS_LABEL, type VisitStatus } from "@/lib/clinic";
import { ConsultationPanel, type Consultation, type Template } from "./consultation-panel";
import { VaccinesPanel, type ProtocolOption, type VaccinationRow, type VaccineOption } from "./vaccines-panel";
import { RxPanel, type Rx } from "./rx-panel";
import { TestsPanel, type DiagnosticOrder, type DiagnosticType } from "./tests-panel";

export const metadata: Metadata = { title: "Visit" };

const CONSULT_FIELDS = ["chief_complaint", "history", "temperature_c", "heart_rate", "resp_rate", "weight_kg", "mucous_membranes",
  "crt_seconds", "hydration", "body_condition_score", "pain_score", "observations", "assessment", "treatment",
  "medicines_administered", "follow_up_plan", "follow_up_date", "doctor_notes"] as const;

export default async function VisitPage({ params, searchParams }: PageProps<"/visits/[id]">) {
  const me = await requireStaff("clinical.view");
  const { id } = await params;
  const { tab } = await searchParams;
  const supabase = await createClient();

  const { data: visit } = await supabase.from("visits")
    .select(`*, pets(id, code, name, sex, date_of_birth, dob_is_estimate, special_handling, species_id, species(name), breeds(name), breed_text,
      pet_alerts(label, kind, severity, is_active)),
      customers(id, full_name, phone, whatsapp), doctor:doctor_id(full_name), appointment_types(name)`)
    .eq("id", id).maybeSingle();
  if (!visit) notFound();

  type PetT = { id: string; code: string; name: string; sex: string; date_of_birth: string | null; dob_is_estimate: boolean;
    special_handling: string | null; species_id: string; species: { name: string } | null; breeds: { name: string } | null;
    breed_text: string | null; pet_alerts: { label: string; kind: string; severity: string; is_active: boolean }[] };
  const pet = visit.pets as unknown as PetT;
  const owner = visit.customers as unknown as { id: string; full_name: string; phone: string; whatsapp: string | null };

  const canSurgery = me.can("surgery.manage");
  const canAdmit = me.can("inpatient.manage");
  const [doctors, kennels, proceduresQ, openAdmissionQ] = await Promise.all([
    canSurgery || canAdmit ? getDoctors() : Promise.resolve([]),
    canAdmit ? getKennels() : Promise.resolve([]),
    canSurgery ? supabase.from("surgery_procedures").select("id, name, default_minutes").eq("is_active", true).order("sort_order") : Promise.resolve({ data: [] }),
    supabase.from("admissions").select("id").eq("pet_id", pet.id).eq("status", "admitted").maybeSingle(),
  ]);
  const [templatesQ, consultQ, vaccinesQ, protocolsQ, historyQ, dueQ, rxQ, dxTypesQ, dxQ, staffQ, weightQ] = await Promise.all([
    supabase.from("clinical_templates").select("key, name, description, sections, exam_prompts").eq("is_active", true).order("sort_order"),
    supabase.from("consultations").select("*, consultation_diagnoses(label, certainty, is_primary, created_at), consultation_revisions(revision, finalized_at, reason)")
      .eq("visit_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("vaccines").select("id, name, protects_against, default_route, default_manufacturer, species_ids").eq("is_active", true).order("name"),
    supabase.from("vaccination_protocols").select("id, name, species_id, booster_interval_days, vaccination_protocol_steps(step_no, label, vaccine_id, days_after_previous)")
      .eq("is_approved", true).eq("is_active", true),
    supabase.from("vaccinations").select("id, vaccine_name, administered_at, batch_no, next_due_date, administered_by, voided_at, void_reason, visit_id")
      .eq("pet_id", pet.id).order("administered_at", { ascending: false }),
    supabase.from("due_items").select("id, title, due_on, kind").eq("pet_id", pet.id).eq("status", "pending").order("due_on"),
    supabase.from("prescriptions").select("id, code, status, notes, issued_at, cancel_reason, doctor_id, prescription_items(id, medicine_name, strength, form, dose, frequency, duration, route, quantity, instructions, sort_order)")
      .eq("visit_id", id).order("created_at", { ascending: false }),
    supabase.from("diagnostic_types").select("id, name, category, result_fields").eq("is_active", true).order("sort_order"),
    supabase.from("diagnostic_orders").select("id, code, status, reason, is_urgent, findings, impression, result_values, created_at, ordered_by, reviewed_at, cancel_reason, diagnostic_types(id, name, category, result_fields)")
      .eq("visit_id", id).order("created_at", { ascending: false }),
    supabase.from("staff").select("id, full_name"),
    supabase.from("pet_weights").select("weight_kg").eq("pet_id", pet.id).order("measured_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const names = new Map((staffQ.data ?? []).map((s) => [s.id, s.full_name]));
  const templates = (templatesQ.data ?? []) as Template[];

  const c = consultQ.data;
  const consultation: Consultation | null = c ? {
    id: c.id, status: c.status, template_key: c.template_key, revision: c.revision,
    finalized_at: c.finalized_at, finalized_by_name: c.finalized_by ? names.get(c.finalized_by) ?? null : null,
    reopened_reason: c.reopened_reason, doctor_name: c.doctor_id ? names.get(c.doctor_id) ?? null : null, updated_at: c.updated_at,
    fields: Object.fromEntries(CONSULT_FIELDS.map((k) => [k, c[k] ?? null])),
    exam: (c.exam ?? {}) as Record<string, string>,
    diagnoses: ((c.consultation_diagnoses ?? []) as { label: string; certainty: string; is_primary: boolean; created_at: string }[])
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.created_at.localeCompare(b.created_at)),
    revisions: ((c.consultation_revisions ?? []) as Consultation["revisions"]).sort((a, b) => a.revision - b.revision),
  } : null;

  const vaccines = ((vaccinesQ.data ?? []) as (VaccineOption & { species_ids: string[] })[])
    .filter((v) => !v.species_ids.length || v.species_ids.includes(pet.species_id));
  const protocols: ProtocolOption[] = (protocolsQ.data ?? [])
    .filter((p) => !p.species_id || p.species_id === pet.species_id)
    .map((p) => ({ id: p.id, name: p.name, booster_interval_days: p.booster_interval_days,
      steps: ((p.vaccination_protocol_steps ?? []) as ProtocolOption["steps"]).sort((a, b) => a.step_no - b.step_no) }));
  const history: VaccinationRow[] = (historyQ.data ?? []).map((h) => ({ ...h, administered_by_name: h.administered_by ? names.get(h.administered_by) ?? null : null }));

  const prescriptions: Rx[] = (rxQ.data ?? []).map((r) => ({
    id: r.id, code: r.code, status: r.status, notes: r.notes, issued_at: r.issued_at, cancel_reason: r.cancel_reason,
    doctor_name: names.get(r.doctor_id) ?? null,
    items: ((r.prescription_items ?? []) as (Rx["items"][number] & { sort_order: number })[]).sort((a, b) => a.sort_order - b.sort_order),
  }));

  const orderIds = (dxQ.data ?? []).map((o) => o.id);
  const { data: docs } = orderIds.length
    ? await supabase.from("documents").select("id, file_name, path, mime_type, entity_id").eq("entity_type", "diagnostic_order").in("entity_id", orderIds).is("deleted_at", null)
    : { data: [] };
  const orders: DiagnosticOrder[] = (dxQ.data ?? []).map((o) => ({
    id: o.id, code: o.code, status: o.status, reason: o.reason, is_urgent: o.is_urgent, findings: o.findings,
    impression: o.impression, result_values: (o.result_values ?? {}) as Record<string, string>, created_at: o.created_at,
    ordered_by_name: o.ordered_by ? names.get(o.ordered_by) ?? null : null, reviewed_at: o.reviewed_at, cancel_reason: o.cancel_reason,
    type: o.diagnostic_types as unknown as DiagnosticType,
    files: (docs ?? []).filter((d) => d.entity_id === o.id),
  }));

  const alerts = (pet.pet_alerts ?? []).filter((a) => a.is_active && a.severity !== "info");
  const status = visit.status as VisitStatus;
  const wa = whatsappLink(owner.whatsapp);
  const weight = weightQ.data?.weight_kg;
  const openTests = orders.filter((o) => ["ordered", "in_progress", "resulted"].includes(o.status)).length;
  const activeTab = typeof tab === "string" ? tab : "consultation";

  return (
    <>
      <PageHeader
        back={{ href: "/queue", label: "Today's queue" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="flex size-12 flex-col items-center justify-center rounded-2xl bg-brand-gradient text-white">
              <span className="text-[9px] leading-none font-semibold opacity-80">TOKEN</span>
              <span className="text-lg leading-tight font-bold tabular">{visit.token_no}</span>
            </span>
            <Link href={`/pets/${pet.id}`} className="hover:underline">{pet.name}</Link>
            <StatusPill tone={status === "completed" ? "success" : status === "cancelled" ? "neutral" : "brand"}>{VISIT_STATUS_LABEL[status]}</StatusPill>
            {visit.priority !== "normal" && <StatusPill tone={PRIORITY[visit.priority as keyof typeof PRIORITY].tone}>{PRIORITY[visit.priority as keyof typeof PRIORITY].label}</StatusPill>}
          </span>
        }
        description={[pet.species?.name, pet.breeds?.name ?? pet.breed_text, pet.sex !== "unknown" ? pet.sex : null,
          formatAge(pet.date_of_birth, pet.dob_is_estimate), weight ? `${Number(weight)} kg` : null,
          `checked in ${formatTime(visit.checked_in_at)}`].filter(Boolean).join(" · ")}
        actions={
          <>
            <Button asChild variant="outline"><a href={`tel:${owner.phone}`}><Phone /> {owner.full_name}</a></Button>
            {wa && <Button asChild variant="outline" size="icon" aria-label="WhatsApp owner"><a href={wa} target="_blank" rel="noreferrer"><MessageCircle /></a></Button>}
            {canSurgery && (
              <PlanSurgeryDialog procedures={proceduresQ.data ?? []} doctors={doctors}
                fixed={{ pet_id: pet.id, pet_name: pet.name, customer_id: owner.id, visit_id: id, consultation_id: c?.id ?? null }}
                trigger={<Button variant="outline"><Scissors /> Plan surgery</Button>} />
            )}
            {openAdmissionQ.data
              ? <Button asChild variant="outline"><Link href={`/ward/${openAdmissionQ.data.id}`}><BedDouble /> In ward</Link></Button>
              : canAdmit && (
                <AdmitDialog kennels={kennels} doctors={doctors} fixed={{ pet_id: pet.id, pet_name: pet.name, customer_id: owner.id, visit_id: id, reason: visit.reason ?? "" }}
                  trigger={<Button variant="outline"><BedDouble /> Admit to ward</Button>} />
              )}
            <Button asChild variant="ghost"><Link href={`/pets/${pet.id}`}><PawPrint /> Full history</Link></Button>
          </>
        }
      />

      {(pet.special_handling || alerts.length > 0) && (
        <div className="-mt-4 mb-6 flex flex-wrap gap-2">
          {pet.special_handling && (
            <span className="inline-flex items-center gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm font-semibold text-danger ring-1 ring-danger/20">
              <OctagonAlert className="size-4" /> {pet.special_handling}
            </span>
          )}
          {alerts.map((a) => (
            <span key={a.label} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ring-1 ${a.severity === "critical" ? "bg-danger-soft text-danger ring-danger/20" : "bg-warning-soft text-warning ring-warning/20"}`}>
              <OctagonAlert className="size-4" /> {a.kind === "allergy" ? "Allergy: " : ""}{a.label}
            </span>
          ))}
        </div>
      )}

      {visit.reason && (
        <p className="-mt-2 mb-6 rounded-xl bg-surface px-4 py-3 ring-1 ring-border">
          <span className="text-sm text-muted-foreground">Owner says: </span>{visit.reason}
        </p>
      )}

      <Tabs defaultValue={activeTab} className="gap-6">
        <TabsList className="h-12 w-full justify-start gap-1 overflow-x-auto rounded-2xl bg-muted p-1 sm:w-fit">
          <TabsTrigger value="consultation" className="h-10 gap-2 rounded-xl px-4"><Stethoscope /> Consultation</TabsTrigger>
          <TabsTrigger value="vaccines" className="h-10 gap-2 rounded-xl px-4"><Syringe /> Vaccines</TabsTrigger>
          <TabsTrigger value="rx" className="h-10 gap-2 rounded-xl px-4"><Pill /> Prescription</TabsTrigger>
          <TabsTrigger value="tests" className="h-10 gap-2 rounded-xl px-4">
            <FlaskConical /> Tests {openTests > 0 && <span className="rounded-full bg-brand px-1.5 text-[11px] font-bold text-white">{openTests}</span>}
          </TabsTrigger>
        </TabsList>

        <div className="rounded-2xl bg-card p-4 shadow-card ring-1 ring-border md:p-6">
          <TabsContent value="consultation">
            <ConsultationPanel visitId={id} consultation={consultation} templates={templates} perms={{
              create: me.can("clinical.create"), edit: me.can("clinical.edit"), finalize: me.can("clinical.finalize"),
              reopen: me.can("clinical.reopen"), isAuthor: c?.created_by === me.id,
            }} />
          </TabsContent>
          <TabsContent value="vaccines">
            <VaccinesPanel visitId={id} petId={pet.id} vaccines={vaccines} protocols={protocols} history={history}
              due={dueQ.data ?? []} canRecord={me.can("vaccinations.manage")} />
          </TabsContent>
          <TabsContent value="rx">
            <RxPanel visitId={id} petId={pet.id} consultationId={c?.id ?? null} prescriptions={prescriptions} canWrite={me.can("prescriptions.manage")} />
          </TabsContent>
          <TabsContent value="tests">
            <TestsPanel visitId={id} petId={pet.id} consultationId={c?.id ?? null} types={(dxTypesQ.data ?? []) as DiagnosticType[]}
              orders={orders} canManage={me.can("diagnostics.manage")} canUpload={me.can("diagnostics.manage") || me.can("clinical.create")} />
          </TabsContent>
        </div>
      </Tabs>
    </>
  );
}
