import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InfoGrid, PrintShell, type ClinicProfile } from "@/components/print/print-shell";
import { EpisodeCard, HistorySummary } from "@/components/app/pet-history-view";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSetting } from "@/lib/queries";
import { loadPetHistory } from "@/lib/pet-history";
import { formatAge, formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export const metadata: Metadata = { title: "Medical history" };

/** The complete medical record of one pet, printable. Private doctor notes are never printed. */
export default async function PetHistoryPrint({ params }: PageProps<"/print/pet-history/[petId]">) {
  const me = await requireStaff();
  if (!me.can("clinical.view")) notFound();
  const { petId } = await params;
  const supabase = await createClient();
  const [{ data: pet }, clinic, h] = await Promise.all([
    supabase.from("pets").select(`code, name, sex, is_neutered, date_of_birth, dob_is_estimate, color, microchip_no, species(name), breeds(name), breed_text,
      pet_owners(is_primary, customers(full_name, phone))`).eq("id", petId).maybeSingle(),
    getSetting<ClinicProfile>("clinic.profile"),
    loadPetHistory(petId),
  ]);
  if (!pet) notFound();
  const owners = pet.pet_owners as unknown as { is_primary: boolean; customers: { full_name: string; phone: string } }[];
  const owner = owners.find((o) => o.is_primary)?.customers ?? owners[0]?.customers;
  const sp = pet.species as unknown as { name: string } | null;
  const br = pet.breeds as unknown as { name: string } | null;
  const showMoney = me.can("billing.view");

  return (
    <PrintShell clinic={clinic ?? {}} title="Complete medical history"
      footer={`Printed ${formatDateTime(new Date())} by ${me.fullName} · ${h.episodes.length} entries`}>
      <InfoGrid rows={[
        ["Pet", `${pet.name} (${pet.code})`],
        ["Owner", owner ? `${owner.full_name} · ${formatPhone(owner.phone)}` : null],
        ["Species / breed", [sp?.name, br?.name ?? pet.breed_text].filter(Boolean).join(" · ")],
        ["Age / sex", [formatAge(pet.date_of_birth, pet.dob_is_estimate), pet.sex !== "unknown" ? `${pet.sex}${pet.is_neutered ? " (neutered)" : ""}` : null].filter(Boolean).join(" · ")],
        ["Colour", pet.color], ["Microchip", pet.microchip_no],
      ]} />
      <div className="mt-4"><HistorySummary h={h} showMoney={showMoney} /></div>
      <div className="mt-4">
        {h.episodes.length ? h.episodes.map((e) => <EpisodeCard key={e.key} e={e} print showMoney={showMoney} showPrivate={false} />)
          : <p className="text-center text-muted-foreground">No visits recorded yet.</p>}
      </div>
    </PrintShell>
  );
}
