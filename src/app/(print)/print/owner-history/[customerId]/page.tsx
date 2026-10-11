import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InfoGrid, PrintShell, type ClinicProfile } from "@/components/print/print-shell";
import { EpisodeCard } from "@/components/app/pet-history-view";
import { OwnerEventRow, OwnerPets, OwnerSummary } from "@/components/app/owner-history-view";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSetting } from "@/lib/queries";
import { loadOwnerHistory } from "@/lib/owner-history";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export const metadata: Metadata = { title: "Owner history" };

/** An owner's complete record with all pets, printable. Private doctor notes are never printed. */
export default async function OwnerHistoryPrint({ params }: PageProps<"/print/owner-history/[customerId]">) {
  const me = await requireStaff();
  if (!me.can("customers.view")) notFound();
  const { customerId } = await params;
  const supabase = await createClient();
  const [{ data: c }, clinic, h] = await Promise.all([
    supabase.from("customers").select("code, full_name, phone, area, address, created_at").eq("id", customerId).maybeSingle(),
    getSetting<ClinicProfile>("clinic.profile"),
    loadOwnerHistory(customerId, me),
  ]);
  if (!c) notFound();
  const showMoney = me.can("billing.view");
  const items = [
    ...h.episodes.map((e) => ({ at: e.at, key: e.key, episode: e, event: null })),
    ...h.events.map((e) => ({ at: e.at, key: e.key, episode: null, event: e })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <PrintShell clinic={clinic ?? {}} title="Owner history — all pets"
      footer={`Printed ${formatDateTime(new Date())} by ${me.fullName} · ${items.length} entries`}>
      <InfoGrid rows={[
        ["Owner", `${c.full_name} (${c.code})`], ["Phone", formatPhone(c.phone)],
        ["Area", c.area], ["Address", c.address], ["Registered", formatDate(c.created_at)],
      ]} />
      <div className="mt-4"><OwnerSummary h={h} showMoney={showMoney} /></div>
      <div className="mt-3"><OwnerPets h={h} print /></div>
      <div className="mt-4">
        {items.length ? items.map((i) => i.episode
          ? <EpisodeCard key={i.key} e={i.episode} print showPet showMoney={showMoney} showPrivate={false} />
          : <OwnerEventRow key={i.key} e={i.event!} print />)
          : <p className="text-center text-muted-foreground">No history yet.</p>}
      </div>
    </PrintShell>
  );
}
