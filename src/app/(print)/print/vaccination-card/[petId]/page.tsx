import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InfoGrid, PrintShell, type ClinicProfile } from "@/components/print/print-shell";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSetting } from "@/lib/queries";
import { formatAge, formatDate } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export const metadata: Metadata = { title: "Vaccination card" };

export default async function VaccinationCardPrint({ params }: PageProps<"/print/vaccination-card/[petId]">) {
  const me = await requireStaff();
  if (!me.can("clinical.view") && !me.can("crm.view")) notFound();
  const { petId } = await params;
  const supabase = await createClient();
  const [{ data: pet }, { data: vaccinations }, { data: due }, { data: staff }, clinic] = await Promise.all([
    supabase.from("pets").select(`code, name, sex, date_of_birth, dob_is_estimate, color, microchip_no, species(name), breeds(name), breed_text,
      pet_owners(is_primary, customers(full_name, phone))`).eq("id", petId).maybeSingle(),
    supabase.from("vaccinations").select("vaccine_name, manufacturer, batch_no, administered_at, next_due_date, administered_by")
      .eq("pet_id", petId).is("voided_at", null).order("administered_at"),
    supabase.from("due_items").select("title, due_on").eq("pet_id", petId).eq("kind", "vaccination").eq("status", "pending").order("due_on"),
    supabase.from("staff").select("id, full_name, pvmc_number"),
    getSetting<ClinicProfile>("clinic.profile"),
  ]);
  if (!pet) notFound();

  const owners = pet.pet_owners as unknown as { is_primary: boolean; customers: { full_name: string; phone: string } }[];
  const owner = owners.find((o) => o.is_primary)?.customers ?? owners[0]?.customers;
  const sp = pet.species as unknown as { name: string } | null;
  const br = pet.breeds as unknown as { name: string } | null;
  const names = new Map((staff ?? []).map((s) => [s.id, s]));

  return (
    <PrintShell clinic={clinic ?? {}} title="Vaccination record">
      <InfoGrid rows={[
        ["Pet", `${pet.name} (${pet.code})`],
        ["Owner", owner ? `${owner.full_name} · ${formatPhone(owner.phone)}` : null],
        ["Species", [sp?.name, br?.name ?? pet.breed_text].filter(Boolean).join(" · ")],
        ["Age / sex", [formatAge(pet.date_of_birth, pet.dob_is_estimate), pet.sex !== "unknown" ? pet.sex : null].filter(Boolean).join(" · ")],
        ["Colour", pet.color],
        ["Microchip", pet.microchip_no],
      ]} />

      <table className="mt-6 w-full border-collapse text-left">
        <thead>
          <tr className="border-b-2 border-ink text-xs tracking-wide uppercase">
            <th className="py-2">Date</th><th>Vaccine</th><th>Brand / batch</th><th>Next due</th><th>Vet</th>
          </tr>
        </thead>
        <tbody>
          {(vaccinations ?? []).map((v, i) => {
            const vet = v.administered_by ? names.get(v.administered_by) : null;
            return (
              <tr key={i} className="border-b align-top">
                <td className="py-2 pr-2 whitespace-nowrap">{formatDate(v.administered_at)}</td>
                <td className="pr-2 font-semibold">{v.vaccine_name}</td>
                <td className="pr-2">{[v.manufacturer, v.batch_no && `Batch ${v.batch_no}`].filter(Boolean).join(" · ")}</td>
                <td className="pr-2 whitespace-nowrap">{formatDate(v.next_due_date)}</td>
                <td>{vet?.full_name}{vet?.pvmc_number ? <span className="block text-[10px] text-muted-foreground">PVMC {vet.pvmc_number}</span> : null}</td>
              </tr>
            );
          })}
          {!vaccinations?.length && <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">No vaccinations recorded.</td></tr>}
        </tbody>
      </table>

      {due && due.length > 0 && (
        <div className="mt-6 rounded-lg border-2 border-brand p-3">
          <p className="font-bold text-brand">Upcoming</p>
          <ul className="mt-1">{due.map((d, i) => <li key={i}>{d.title} — <b>{formatDate(d.due_on)}</b></li>)}</ul>
        </div>
      )}
    </PrintShell>
  );
}
