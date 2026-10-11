import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { History, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { EpisodeCard } from "@/components/app/pet-history-view";
import { OwnerEventRow, OwnerPets, OwnerSummary } from "@/components/app/owner-history-view";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadOwnerHistory, type OwnerEvent } from "@/lib/owner-history";
import type { Episode } from "@/lib/pet-history";
import { formatDate } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export const metadata: Metadata = { title: "Owner history" };

type Item = { at: string; key: string; episode?: Episode; event?: OwnerEvent };
const SHOW = [
  { key: "", label: "Everything" },
  { key: "visits", label: "Clinic visits" },
  { key: "medicines", label: "Medicines" },
  { key: "vaccines", label: "Vaccines" },
  { key: "surgery", label: "Surgery & ward" },
  { key: "bills", label: "Bills" },
  { key: "payments", label: "Payments & refunds" },
  { key: "appointments", label: "Appointments" },
  { key: "contact", label: "Calls & messages" },
] as const;
const MATCH: Record<string, (i: Item) => boolean> = {
  visits: (i) => !!i.episode?.visitId,
  medicines: (i) => !!i.episode && (i.episode.prescriptions.length > 0 || !!i.episode.consultation?.medicinesGiven),
  vaccines: (i) => !!i.episode?.vaccinations.length,
  surgery: (i) => !!i.episode && (i.episode.surgeries.length > 0 || i.episode.ward.length > 0),
  bills: (i) => !!i.episode?.bills.length,
  payments: (i) => i.event?.kind === "payment",
  appointments: (i) => i.event?.kind === "appointment",
  contact: (i) => i.event?.kind === "contact",
};

/** An owner's whole story with the clinic: every pet, every visit in full, appointments, payments and contact. */
export default async function OwnerHistoryPage({ params, searchParams }: PageProps<"/customers/[id]/history">) {
  const me = await requireStaff("customers.view");
  const { id } = await params;
  const sp = await searchParams;
  const show = typeof sp.show === "string" && sp.show in MATCH ? sp.show : "";
  const pet = typeof sp.pet === "string" ? sp.pet : "";
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase().slice(0, 80) : "";

  const supabase = await createClient();
  const { data: c } = await supabase.from("customers").select("id, code, full_name, phone, area, created_at").eq("id", id).maybeSingle();
  if (!c) notFound();
  const h = await loadOwnerHistory(id, me);
  const showMoney = me.can("billing.view");

  const items: Item[] = [
    ...h.episodes.map((e) => ({ at: e.at, key: e.key, episode: e })),
    ...h.events.map((e) => ({ at: e.at, key: e.key, event: e })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const petName = h.pets.find((p) => p.id === pet)?.name;
  const shown = items.filter((i) =>
    (!show || MATCH[show](i))
    && (!pet || i.episode?.petId === pet || (!!petName && i.event?.petName === petName))
    && (!q || JSON.stringify(i).toLowerCase().includes(q)));
  const sel = "h-10 max-w-full min-w-0 rounded-xl border border-input bg-card px-3 text-sm";

  return (
    <>
      <PageHeader back={{ href: `/customers/${id}`, label: c.full_name }}
        title={`${c.full_name} — full history`}
        description={[c.code, formatPhone(c.phone), c.area, `Registered ${formatDate(c.created_at)}`].filter(Boolean).join(" · ")}
        actions={<Button asChild variant="outline"><Link href={`/print/owner-history/${id}`} target="_blank"><Printer /> Print full history</Link></Button>} />

      <div className="mb-4 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border"><OwnerSummary h={h} showMoney={showMoney} /></div>
      {h.pets.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Pets — tap one for that pet&apos;s own history</h2>
          <OwnerPets h={h} />
        </section>
      )}

      <form className="mb-4 flex flex-wrap items-end gap-2">
        <input name="q" defaultValue={q} placeholder="Search: medicine, diagnosis, doctor, bill no…" className={`${sel} min-w-0 flex-1 sm:min-w-64`} />
        {h.pets.length > 1 && (
          <select name="pet" defaultValue={pet} className={sel}><option value="">All pets</option>{h.pets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        )}
        <select name="show" defaultValue={show} className={sel}>{SHOW.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
        <button type="submit" className="h-10 rounded-xl bg-brand-gradient px-4 text-sm font-semibold text-white">Show</button>
        {(show || pet || q) && <Link href={`/customers/${id}/history`} className="px-2 text-sm leading-10 font-semibold text-brand hover:underline">Clear</Link>}
      </form>

      {!shown.length ? (
        <EmptyState icon={History} title={items.length ? "Nothing matches" : "No history yet"}
          description={items.length ? "Try a different filter." : "Visits, appointments, payments and calls will appear here."} />
      ) : (
        <div className="grid grid-cols-1 gap-3">
          <p className="text-xs text-muted-foreground">{shown.length} of {items.length} entries · newest first</p>
          {shown.map((i, n) => i.episode
            ? <EpisodeCard key={i.key} e={i.episode} showMoney={showMoney} showPrivate={me.can("clinical.create")} showPet open={n < 2 || !!q} />
            : <OwnerEventRow key={i.key} e={i.event!} />)}
        </div>
      )}
    </>
  );
}
