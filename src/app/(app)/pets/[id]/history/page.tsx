import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { History, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { EpisodeCard, HistorySummary } from "@/components/app/pet-history-view";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadPetHistory, type Episode } from "@/lib/pet-history";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Full medical history" };

const SHOW = [
  { key: "", label: "Everything" },
  { key: "medicines", label: "Medicines" },
  { key: "vaccines", label: "Vaccines" },
  { key: "tests", label: "Tests" },
  { key: "surgery", label: "Surgery" },
  { key: "ward", label: "Hospital stays" },
  { key: "bills", label: "Bills" },
] as const;
const MATCH: Record<string, (e: Episode) => boolean> = {
  medicines: (e) => e.prescriptions.length > 0 || !!e.consultation?.medicinesGiven,
  vaccines: (e) => e.vaccinations.length > 0,
  tests: (e) => e.tests.length > 0,
  surgery: (e) => e.surgeries.length > 0,
  ward: (e) => e.ward.length > 0,
  bills: (e) => e.bills.length > 0,
};

/** Every visit of one pet, with what was done, by whom, which medicines, tests, vaccines, surgery, ward and bills. */
export default async function PetHistoryPage({ params, searchParams }: PageProps<"/pets/[id]/history">) {
  const me = await requireStaff("clinical.view");
  const { id } = await params;
  const sp = await searchParams;
  const show = typeof sp.show === "string" && sp.show in MATCH ? sp.show : "";
  const doctor = typeof sp.doctor === "string" ? sp.doctor : "";
  const year = typeof sp.year === "string" && /^\d{4}$/.test(sp.year) ? sp.year : "";
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase().slice(0, 80) : "";

  const supabase = await createClient();
  const { data: pet } = await supabase.from("pets")
    .select("id, code, name, species(name), pet_owners(is_primary, customers(id, full_name))").eq("id", id).maybeSingle();
  if (!pet) notFound();
  const h = await loadPetHistory(id);
  const showMoney = me.can("billing.view");
  const showPrivate = me.can("clinical.create");

  const years = [...new Set(h.episodes.map((e) => e.at.slice(0, 4)))];
  const episodes = h.episodes.filter((e) =>
    (!show || MATCH[show](e))
    && (!doctor || [e.doctor, e.consultation?.doctor, ...e.surgeries.map((s) => s.surgeon), ...e.prescriptions.map((p) => p.doctor), ...e.vaccinations.map((v) => v.by)].includes(doctor))
    && (!year || e.at.startsWith(year))
    && (!q || JSON.stringify(e).toLowerCase().includes(q)));

  const owners = (pet.pet_owners ?? []) as unknown as { is_primary: boolean; customers: { id: string; full_name: string } }[];
  const owner = owners.find((o) => o.is_primary)?.customers ?? owners[0]?.customers;
  const sel = "h-10 rounded-xl border border-input bg-card px-3 text-sm";

  return (
    <>
      <PageHeader back={{ href: `/pets/${id}`, label: pet.name }}
        title={`${pet.name} — full medical history`}
        description={[pet.code, (pet.species as unknown as { name: string } | null)?.name, owner ? `Owner: ${owner.full_name}` : null,
          h.summary.firstAt ? `With us since ${formatDate(h.summary.firstAt)}` : null].filter(Boolean).join(" · ")}
        actions={<Button asChild variant="outline"><Link href={`/print/pet-history/${id}`} target="_blank"><Printer /> Print full history</Link></Button>} />

      <div className="mb-5 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border"><HistorySummary h={h} showMoney={showMoney} /></div>

      <form className="mb-4 flex flex-wrap items-end gap-2">
        <input name="q" defaultValue={q} placeholder="Search this history: medicine, diagnosis, doctor…" className={`${sel} min-w-0 flex-1 sm:min-w-64`} />
        <select name="show" defaultValue={show} className={sel}>{SHOW.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
        <select name="doctor" defaultValue={doctor} className={sel}>
          <option value="">Any doctor / staff</option>
          {h.summary.doctors.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        {years.length > 1 && (
          <select name="year" defaultValue={year} className={sel}><option value="">All years</option>{years.map((y) => <option key={y}>{y}</option>)}</select>
        )}
        <button type="submit" className="h-10 rounded-xl bg-brand-gradient px-4 text-sm font-semibold text-white">Show</button>
        {(show || doctor || year || q) && <Link href={`/pets/${id}/history`} className="px-2 text-sm leading-10 font-semibold text-brand hover:underline">Clear</Link>}
      </form>

      {!episodes.length ? (
        <EmptyState icon={History} title={h.episodes.length ? "Nothing matches" : "No history yet"}
          description={h.episodes.length ? "Try a different filter." : "Visits, medicines, vaccines and bills will appear here."} />
      ) : (
        <div className="grid gap-3">
          <p className="text-xs text-muted-foreground">{episodes.length} of {h.episodes.length} entries · newest first · tap one to see everything</p>
          {episodes.map((e, i) => <EpisodeCard key={e.key} e={e} showMoney={showMoney} showPrivate={showPrivate} open={i < 2 || !!q} />)}
        </div>
      )}
    </>
  );
}
