import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OctagonAlert, Printer, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, StatusPill } from "@/components/app/page-header";
import { NoticeToast } from "@/components/app/notice-toast";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getKennels } from "@/lib/queries";
import { formatAge, formatDate, formatDateTime } from "@/lib/format";
import { whatsappLink } from "@/lib/phone";
import { ADMISSION_OUTCOMES } from "@/lib/clinic";
import { LiveRefresh } from "../live-refresh";
import { StatusBadge, TreatmentChart, type Dose, type Order } from "./chart";
import { DischargeDialog, KennelPicker, NotesPanel, OwnerUpdateHint, PlanPanel, type Note } from "./panels";

export const metadata: Metadata = { title: "Ward patient" };

export default async function AdmissionPage({ params }: PageProps<"/ward/[id]">) {
  const me = await requireStaff();
  if (!me.can("clinical.view")) redirect("/dashboard?denied=1");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: a }, kennels, { data: staff }] = await Promise.all([
    supabase.from("admissions")
      .select(`*, pets(id, name, sex, date_of_birth, dob_is_estimate, special_handling, species(name), breeds(name), breed_text, pet_alerts(label, kind, severity, is_active)),
        customers(full_name, phone, whatsapp), surgeries(id, procedure_name, code), doctor:attending_doctor_id(full_name),
        admission_orders(*), admission_administrations(order_id, due_at, result, given_at, given_by, note), admission_notes(*)`)
      .eq("id", id).maybeSingle(),
    getKennels(),
    supabase.from("staff").select("id, full_name"),
  ]);
  if (!a) notFound();
  const nameOf = new Map((staff ?? []).map((s) => [s.id, s.full_name]));

  type Pet = { id: string; name: string; sex: string; date_of_birth: string | null; dob_is_estimate: boolean; special_handling: string | null;
    species: { name: string } | null; breeds: { name: string } | null; breed_text: string | null;
    pet_alerts: { label: string; kind: string; severity: string; is_active: boolean }[] };
  const pet = a.pets as unknown as Pet;
  const owner = a.customers as unknown as { full_name: string; phone: string; whatsapp: string | null };
  const surgery = a.surgeries as unknown as { id: string; procedure_name: string; code: string } | null;
  const open = a.status === "admitted";

  const orders: Order[] = ((a.admission_orders ?? []) as (Omit<Order, "ordered_by"> & { ordered_by: string | null; created_at: string })[])
    .sort((x, y) => x.created_at.localeCompare(y.created_at))
    .map((o) => ({ ...o, ordered_by: o.ordered_by ? nameOf.get(o.ordered_by) ?? null : null }));
  const doses: Dose[] = ((a.admission_administrations ?? []) as (Omit<Dose, "by"> & { given_by: string | null })[])
    .map((d) => ({ ...d, by: d.given_by ? nameOf.get(d.given_by) ?? null : null }));
  const notes: Note[] = ((a.admission_notes ?? []) as (Omit<Note, "by"> & { created_by: string | null })[])
    .sort((x, y) => y.created_at.localeCompare(x.created_at))
    .map((n) => ({ ...n, by: n.created_by ? nameOf.get(n.created_by) ?? null : null }));
  const alerts = (pet.pet_alerts ?? []).filter((x) => x.is_active && x.severity !== "info");
  const wa = whatsappLink(owner.whatsapp, `Assalam o Alaikum ${owner.full_name}, an update about ${pet.name} from Bin Dawood Animal Hospital: `);

  return (
    <>
      <Suspense><NoticeToast /></Suspense>
      {open && <LiveRefresh tables={["admission_administrations", "admissions"]} />}
      <PageHeader
        back={{ href: "/ward", label: "Ward" }}
        title={<span className="flex flex-wrap items-center gap-3"><Link href={`/pets/${pet.id}`} className="hover:underline">{pet.name}</Link><StatusBadge status={a.status} /></span>}
        description={[a.code, pet.species?.name, pet.breeds?.name ?? pet.breed_text, formatAge(pet.date_of_birth, pet.dob_is_estimate),
          `admitted ${formatDateTime(a.admitted_at)}`, (a.doctor as unknown as { full_name: string } | null)?.full_name].filter(Boolean).join(" · ")}
        actions={
          <>
            <KennelPicker id={a.id} current={a.kennel_id} kennels={kennels} canMove={open && (me.can("inpatient.care") || me.can("inpatient.manage"))} />
            {open && me.can("inpatient.manage") && <DischargeDialog id={a.id} petName={pet.name} />}
            {!open && a.status === "discharged" && (
              <Button asChild variant="outline"><Link href={`/print/discharge/ward/${a.id}`} target="_blank"><Printer /> Discharge sheet</Link></Button>
            )}
          </>
        }
      />

      <div className="-mt-4 mb-6 flex flex-wrap gap-2">
        {pet.special_handling && <Chip text={pet.special_handling} critical />}
        {alerts.map((x) => <Chip key={x.label} text={`${x.kind === "allergy" ? "Allergy: " : ""}${x.label}`} critical={x.severity === "critical"} />)}
        {surgery && (
          <Link href={`/surgery/${surgery.id}`} className="inline-flex items-center gap-2 rounded-xl bg-brand-soft px-3 py-2 text-sm font-semibold text-brand ring-1 ring-brand-muted">
            <Scissors className="size-4" /> After {surgery.procedure_name}
          </Link>
        )}
      </div>

      {a.status === "discharged" && (
        <div className="mb-6 rounded-2xl bg-success-soft p-4 ring-1 ring-success/20">
          <p className="font-semibold text-success">{ADMISSION_OUTCOMES.find((o) => o.value === a.outcome)?.label} · {formatDateTime(a.discharged_at)}</p>
          <p className="mt-1 text-sm whitespace-pre-wrap">{a.discharge_summary}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Treatment chart</CardTitle></CardHeader>
            <CardContent>
              <TreatmentChart admissionId={a.id} orders={orders} doses={doses} open={open}
                canOrder={me.can("inpatient.manage")} canGive={me.can("inpatient.care") || me.can("inpatient.manage")} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Notes & vitals</CardTitle></CardHeader>
            <CardContent><NotesPanel admissionId={a.id} notes={notes} canWrite={open && (me.can("inpatient.care") || me.can("inpatient.manage"))} /></CardContent>
          </Card>
        </div>
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader><CardTitle>Why here</CardTitle></CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <p className="whitespace-pre-wrap">{a.reason}</p>
              {a.expected_discharge_on && <StatusPill className="w-fit">Expected home {formatDate(a.expected_discharge_on)}</StatusPill>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Plan</CardTitle></CardHeader>
            <CardContent>
              <PlanPanel id={a.id} canEdit={open && me.can("inpatient.manage")}
                plan={{ feeding_plan: a.feeding_plan ?? "", care_notes: a.care_notes ?? "", expected_discharge_on: a.expected_discharge_on ?? "" }} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Owner</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <p><b>{owner.full_name}</b></p>
              <OwnerUpdateHint phone={owner.phone} wa={wa} />
              <p className="text-xs text-muted-foreground">After calling, add an “Owner updated” note so everyone knows what was said.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Chip({ text, critical }: { text: string; critical: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ring-1 ${critical ? "bg-danger-soft text-danger ring-danger/20" : "bg-warning-soft text-warning ring-warning/20"}`}>
      <OctagonAlert className="size-4" /> {text}
    </span>
  );
}
