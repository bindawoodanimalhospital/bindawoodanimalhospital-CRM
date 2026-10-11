import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InfoGrid, PrintShell, type ClinicProfile } from "@/components/print/print-shell";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSetting } from "@/lib/queries";
import { formatAge, formatDate, formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { ADMISSION_OUTCOMES } from "@/lib/clinic";

export const metadata: Metadata = { title: "Discharge sheet" };

type PetT = { code: string; name: string; sex: string; date_of_birth: string | null; dob_is_estimate: boolean;
  species: { name: string } | null; breeds: { name: string } | null; breed_text: string | null };

/** Owner-facing discharge sheet for a surgery or a ward stay. */
export default async function DischargePrint({ params }: PageProps<"/print/discharge/[kind]/[id]">) {
  await requireStaff("clinical.view");
  const { kind, id } = await params;
  const supabase = await createClient();
  const clinic = await getSetting<ClinicProfile>("clinic.profile");
  const petSel = "pets(code, name, sex, date_of_birth, dob_is_estimate, species(name), breeds(name), breed_text)";

  if (kind === "surgery") {
    const { data: s } = await supabase.from("surgeries").select(`code, procedure_name, procedure_start, procedure_end, discharged_at,
      recovery_notes, discharge_instructions, follow_up_date, complications, ${petSel}, customers(full_name, phone), surgeon:surgeon_id(full_name, pvmc_number)`)
      .eq("id", id).maybeSingle();
    if (!s || !s.discharged_at) notFound();
    const pet = s.pets as unknown as PetT;
    const owner = s.customers as unknown as { full_name: string; phone: string };
    const surgeon = s.surgeon as unknown as { full_name: string; pvmc_number: string | null } | null;
    return (
      <PrintShell clinic={clinic ?? {}} title="After-surgery care">
        <Header pet={pet} owner={owner} extra={[["Procedure", s.procedure_name], ["Operated", s.procedure_start ? formatDateTime(s.procedure_start) : null], ["Discharged", formatDateTime(s.discharged_at)]]} />
        <Block title="Care at home">{s.discharge_instructions}</Block>
        {s.follow_up_date && <Block title="Come back for a check-up on"><b>{formatDate(s.follow_up_date)}</b></Block>}
        <Block title="Call us straight away if you see">Bleeding, swelling or discharge from the wound, the stitches opening, vomiting, no eating for more than a day, or unusual weakness.</Block>
        <Signature name={surgeon?.full_name} pvmc={surgeon?.pvmc_number} />
      </PrintShell>
    );
  }

  if (kind === "ward") {
    const { data: a } = await supabase.from("admissions").select(`code, reason, admitted_at, discharged_at, outcome, discharge_summary,
      discharge_instructions, follow_up_date, ${petSel}, customers(full_name, phone), doctor:attending_doctor_id(full_name, pvmc_number)`)
      .eq("id", id).maybeSingle();
    if (!a || !a.discharged_at) notFound();
    const pet = a.pets as unknown as PetT;
    const owner = a.customers as unknown as { full_name: string; phone: string };
    const doctor = a.doctor as unknown as { full_name: string; pvmc_number: string | null } | null;
    return (
      <PrintShell clinic={clinic ?? {}} title="Hospital stay summary">
        <Header pet={pet} owner={owner} extra={[["Admitted", formatDateTime(a.admitted_at)], ["Discharged", formatDateTime(a.discharged_at)],
          ["Outcome", ADMISSION_OUTCOMES.find((o) => o.value === a.outcome)?.label ?? null]]} />
        <Block title="Reason for stay">{a.reason}</Block>
        <Block title="Summary">{a.discharge_summary}</Block>
        {a.discharge_instructions && <Block title="Care at home">{a.discharge_instructions}</Block>}
        {a.follow_up_date && <Block title="Come back for a check-up on"><b>{formatDate(a.follow_up_date)}</b></Block>}
        <Signature name={doctor?.full_name} pvmc={doctor?.pvmc_number} />
      </PrintShell>
    );
  }
  notFound();
}

function Header({ pet, owner, extra }: { pet: PetT; owner: { full_name: string; phone: string }; extra: [string, string | null][] }) {
  return (
    <InfoGrid rows={[
      ["Pet", `${pet.name} (${pet.code})`],
      ["Owner", `${owner.full_name} · ${formatPhone(owner.phone)}`],
      ["Species", [pet.species?.name, pet.breeds?.name ?? pet.breed_text].filter(Boolean).join(" · ")],
      ["Age / sex", [formatAge(pet.date_of_birth, pet.dob_is_estimate), pet.sex !== "unknown" ? pet.sex : null].filter(Boolean).join(" · ")],
      ...extra,
    ]} />
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <p className="text-xs font-semibold tracking-wide text-brand uppercase">{title}</p>
      <div className="mt-1 whitespace-pre-wrap">{children}</div>
    </div>
  );
}

function Signature({ name, pvmc }: { name?: string; pvmc?: string | null }) {
  return (
    <div className="mt-16 flex justify-end">
      <div className="w-64 border-t border-ink pt-2 text-center">
        <p className="font-semibold">{name ?? "Veterinarian"}</p>
        {pvmc && <p className="text-xs text-muted-foreground">PVMC Reg. No. {pvmc}</p>}
      </div>
    </div>
  );
}
