import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InfoGrid, PrintShell, type ClinicProfile } from "@/components/print/print-shell";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSetting } from "@/lib/queries";
import { formatAge, formatDate } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export const metadata: Metadata = { title: "Prescription" };

export default async function PrescriptionPrint({ params }: PageProps<"/print/prescription/[id]">) {
  await requireStaff("clinical.view");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: rx }, clinic] = await Promise.all([
    supabase.from("prescriptions")
      .select(`code, status, notes, issued_at, created_at,
        doctor:doctor_id(full_name, title, pvmc_number),
        pets(code, name, sex, date_of_birth, dob_is_estimate, species(name), breeds(name), breed_text,
             pet_owners(is_primary, customers(full_name, phone))),
        visits(customers(full_name, phone)),
        consultations(weight_kg, consultation_diagnoses(label, is_primary)),
        prescription_items(medicine_name, strength, form, dose, frequency, duration, route, quantity, instructions, sort_order)`)
      .eq("id", id).maybeSingle(),
    getSetting<ClinicProfile>("clinic.profile"),
  ]);
  if (!rx || rx.status === "draft") notFound();

  type Pet = { code: string; name: string; sex: string; date_of_birth: string | null; dob_is_estimate: boolean;
    species: { name: string } | null; breeds: { name: string } | null; breed_text: string | null;
    pet_owners: { is_primary: boolean; customers: { full_name: string; phone: string } }[] };
  const pet = rx.pets as unknown as Pet;
  const visitOwner = (rx.visits as unknown as { customers: { full_name: string; phone: string } } | null)?.customers;
  const owner = visitOwner ?? pet.pet_owners.find((o) => o.is_primary)?.customers ?? pet.pet_owners[0]?.customers;
  const doctor = rx.doctor as unknown as { full_name: string; title: string | null; pvmc_number: string | null } | null;
  const consult = rx.consultations as unknown as { weight_kg: number | null; consultation_diagnoses: { label: string; is_primary: boolean }[] } | null;
  const items = ((rx.prescription_items ?? []) as { sort_order: number; medicine_name: string; strength: string | null; form: string | null;
    dose: string; frequency: string; duration: string | null; route: string | null; quantity: string | null; instructions: string | null }[])
    .sort((a, b) => a.sort_order - b.sort_order);
  const cancelled = rx.status === "cancelled";

  return (
    <PrintShell clinic={clinic ?? {}} title="Prescription"
      footer="This prescription is valid only with the doctor's signature. Do not change doses without asking the doctor.">
      {cancelled && (
        <p className="mb-4 rounded-lg border-2 border-danger p-2 text-center font-bold text-danger uppercase">Cancelled — do not dispense</p>
      )}
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>No. {rx.code}</span><span>Date: {formatDate(rx.issued_at ?? rx.created_at)}</span>
      </div>
      <div className="mt-2">
        <InfoGrid rows={[
          ["Patient", `${pet.name} (${pet.code})`],
          ["Owner", owner ? `${owner.full_name} · ${formatPhone(owner.phone)}` : null],
          ["Species", [pet.species?.name, pet.breeds?.name ?? pet.breed_text].filter(Boolean).join(" · ")],
          ["Age / sex", [formatAge(pet.date_of_birth, pet.dob_is_estimate), pet.sex !== "unknown" ? pet.sex : null].filter(Boolean).join(" · ")],
          ["Weight", consult?.weight_kg ? `${Number(consult.weight_kg)} kg` : null],
          ["Diagnosis", consult?.consultation_diagnoses?.map((d) => d.label).join(", ") || null],
        ]} />
      </div>

      <p className="mt-6 font-heading text-3xl font-bold text-brand">℞</p>
      <ol className="mt-2 grid gap-3">
        {items.map((it, i) => (
          <li key={i} className="flex gap-3 border-b border-dashed pb-3">
            <span className="w-5 font-bold">{i + 1}.</span>
            <div className="flex-1">
              <p className="text-[14px] font-bold">
                {it.medicine_name}{it.strength ? ` ${it.strength}` : ""}{it.form ? <span className="font-normal"> ({it.form})</span> : null}
                {it.quantity ? <span className="float-right font-normal">Qty: {it.quantity}</span> : null}
              </p>
              <p>{it.dose} — {it.frequency}{it.duration ? ` — for ${it.duration}` : ""}{it.route ? ` — ${it.route}` : ""}</p>
              {it.instructions && <p className="text-muted-foreground">{it.instructions}</p>}
            </div>
          </li>
        ))}
      </ol>
      {rx.notes && (
        <div className="mt-5">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Advice</p>
          <p className="mt-1 whitespace-pre-wrap">{rx.notes}</p>
        </div>
      )}

      <div className="mt-16 flex justify-end">
        <div className="w-64 border-t border-ink pt-2 text-center">
          <p className="font-semibold">{doctor?.full_name}</p>
          {doctor?.title && <p className="text-xs">{doctor.title}</p>}
          {doctor?.pvmc_number && <p className="text-xs text-muted-foreground">PVMC Reg. No. {doctor.pvmc_number}</p>}
        </div>
      </div>
    </PrintShell>
  );
}
