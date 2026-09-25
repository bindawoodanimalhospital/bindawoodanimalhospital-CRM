import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InfoGrid, PrintShell, type ClinicProfile } from "@/components/print/print-shell";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSetting } from "@/lib/queries";
import { formatAge, formatDate, formatDateTime, formatPKR } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export const metadata: Metadata = { title: "Surgery consent" };

export default async function ConsentPrint({ params }: PageProps<"/print/consent/[id]">) {
  const me = await requireStaff();
  if (!me.can("clinical.view") && !me.can("surgery.consent")) notFound();
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: s }, clinic, text] = await Promise.all([
    supabase.from("surgeries").select(`code, procedure_name, indication, estimate_amount, estimate_notes, scheduled_at, urgency,
      pets(code, name, sex, date_of_birth, dob_is_estimate, color, species(name), breeds(name), breed_text),
      customers(full_name, phone, address, area), surgeon:surgeon_id(full_name, pvmc_number),
      surgery_consents(signed_by_name, relationship, method, signed_at, revoked_at)`).eq("id", id).maybeSingle(),
    getSetting<ClinicProfile>("clinic.profile"),
    getSetting<{ en: string; ur: string; status?: string }>("surgery.consent_text"),
  ]);
  if (!s) notFound();
  const pet = s.pets as unknown as { code: string; name: string; sex: string; date_of_birth: string | null; dob_is_estimate: boolean; color: string | null;
    species: { name: string } | null; breeds: { name: string } | null; breed_text: string | null };
  const owner = s.customers as unknown as { full_name: string; phone: string; address: string | null; area: string | null };
  const surgeon = s.surgeon as unknown as { full_name: string; pvmc_number: string | null } | null;
  const signed = ((s.surgery_consents ?? []) as { signed_by_name: string; relationship: string | null; method: string; signed_at: string; revoked_at: string | null }[])
    .find((c) => !c.revoked_at);

  return (
    <PrintShell clinic={clinic ?? {}} title="Consent for surgery & anaesthesia"
      footer={text?.status === "draft" ? "Draft wording — to be reviewed by the clinic." : undefined}>
      <div className="flex justify-between text-xs text-muted-foreground"><span>Ref. {s.code}</span><span>{s.scheduled_at ? `Planned: ${formatDateTime(s.scheduled_at)}` : ""}</span></div>
      <div className="mt-2">
        <InfoGrid rows={[
          ["Pet", `${pet.name} (${pet.code})`],
          ["Species", [pet.species?.name, pet.breeds?.name ?? pet.breed_text, pet.sex !== "unknown" ? pet.sex : null].filter(Boolean).join(" · ")],
          ["Age / colour", [formatAge(pet.date_of_birth, pet.dob_is_estimate), pet.color].filter(Boolean).join(" · ")],
          ["Owner", `${owner.full_name} · ${formatPhone(owner.phone)}`],
          ["Address", [owner.address, owner.area].filter(Boolean).join(", ") || null],
          ["Surgeon", surgeon ? `${surgeon.full_name}${surgeon.pvmc_number ? ` (PVMC ${surgeon.pvmc_number})` : ""}` : null],
        ]} />
      </div>
      <div className="mt-4 rounded-lg border p-3">
        <p><b>Procedure:</b> {s.procedure_name}</p>
        {s.indication && <p><b>Reason:</b> {s.indication}</p>}
        <p><b>Estimated cost:</b> {s.estimate_amount != null ? formatPKR(s.estimate_amount) : "—"}{s.estimate_notes ? ` (${s.estimate_notes})` : ""}</p>
      </div>
      <p className="mt-4 text-justify leading-relaxed">{text?.en}</p>
      <p dir="rtl" lang="ur" className="mt-4 text-right text-[15px] leading-loose">{text?.ur}</p>

      <div className="mt-10 grid grid-cols-2 gap-10">
        <div>
          <div className="h-12 border-b border-ink" />
          <p className="mt-1 text-xs">Owner / authorised person — name, signature & CNIC</p>
          <p className="text-xs" dir="rtl" lang="ur">مالک / مجاز شخص — نام، دستخط اور شناختی کارڈ نمبر</p>
          {signed && <p className="mt-1 text-xs text-muted-foreground">Recorded: {signed.signed_by_name}{signed.relationship ? ` (${signed.relationship})` : ""}, {formatDateTime(signed.signed_at)}</p>}
        </div>
        <div>
          <div className="h-12 border-b border-ink" />
          <p className="mt-1 text-xs">Veterinary surgeon / witness</p>
          <p className="text-xs">Date: {formatDate(new Date())}</p>
        </div>
      </div>
    </PrintShell>
  );
}
