import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BedDouble, Clock, OctagonAlert, Pill } from "lucide-react";
import { EmptyState, PageHeader, StatusPill } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDoctors, getKennels } from "@/lib/queries";
import { treatmentSlots } from "@/lib/clinic";
import { cn } from "@/lib/utils";
import { AdmitDialog } from "./admit-dialog";
import { LiveRefresh } from "./live-refresh";

export const metadata: Metadata = { title: "Ward" };

function stayLength(since: string) {
  const h = Math.floor((Date.now() - new Date(since).getTime()) / 3600_000);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d ${h % 24} h`;
}

export default async function WardPage() {
  const me = await requireStaff();
  if (!me.can("clinical.view")) redirect("/dashboard?denied=1");
  const supabase = await createClient();
  const [kennels, doctors, { data }] = await Promise.all([
    getKennels(), getDoctors(),
    supabase.from("admissions")
      .select(`id, code, kennel_id, reason, admitted_at, expected_discharge_on, care_notes,
        pets(id, name, special_handling, species(name)), doctor:attending_doctor_id(full_name),
        admission_orders(id, status, every_hours, starts_at, ends_at, description),
        admission_administrations(order_id, due_at, result)`)
      .eq("status", "admitted").order("admitted_at"),
  ]);

  const now = new Date();
  const from = new Date(now.getTime() - 24 * 3600_000);
  const admissions = (data ?? []).map((a) => {
    const done = new Map(((a.admission_administrations ?? []) as { order_id: string; due_at: string | null; result: "given" | "skipped" | "refused" }[])
      .filter((x) => x.due_at).map((x) => [`${x.order_id}|${new Date(x.due_at!).toISOString()}`, x.result]));
    let overdue = 0; let dueNow = 0; let nextAt: number | null = null;
    for (const o of (a.admission_orders ?? []) as { id: string; status: string; every_hours: number | null; starts_at: string; ends_at: string | null }[]) {
      if (o.status !== "active") continue;
      const own = new Map([...done].filter(([k]) => k.startsWith(`${o.id}|`)).map(([k, v]) => [k.split("|")[1], v]));
      for (const slot of treatmentSlots({ ...o, every_hours: o.every_hours ? Number(o.every_hours) : null }, own, from, new Date(now.getTime() + 12 * 3600_000), now)) {
        if (slot.state === "overdue") overdue++;
        if (slot.state === "due") dueNow++;
        if (slot.state === "upcoming") { const t = new Date(slot.due_at).getTime(); if (nextAt == null || t < nextAt) nextAt = t; }
      }
    }
    const pet = a.pets as unknown as { id: string; name: string; special_handling: string | null; species: { name: string } | null };
    return { ...a, pet, doctor: (a.doctor as unknown as { full_name: string } | null)?.full_name ?? null, overdue, dueNow, nextAt };
  });
  const byKennel = new Map(admissions.filter((a) => a.kennel_id).map((a) => [a.kennel_id!, a]));
  const unplaced = admissions.filter((a) => !a.kennel_id);
  const wards = [...new Set(kennels.map((k) => k.ward))];
  const totalOverdue = admissions.reduce((n, a) => n + a.overdue, 0);

  return (
    <>
      <LiveRefresh tables={["admissions", "admission_administrations"]} />
      <PageHeader title="Ward"
        description={`${admissions.length} in the ward · ${kennels.filter((k) => !k.occupied).length} free kennels${totalOverdue ? ` · ${totalOverdue} treatments overdue` : ""}`}
        actions={me.can("inpatient.manage") && <AdmitDialog kennels={kennels} doctors={doctors} />} />

      {kennels.length === 0 && admissions.length === 0 && <EmptyState icon={BedDouble} title="No kennels set up" />}

      <div className="grid gap-8">
        {unplaced.length > 0 && (
          <section>
            <h2 className="mb-3 font-semibold text-warning">Not in a kennel yet</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{unplaced.map((a) => <PatientTile key={a.id} a={a} kennel="—" />)}</div>
          </section>
        )}
        {wards.map((w) => (
          <section key={w}>
            <h2 className="mb-3 font-semibold">{w}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {kennels.filter((k) => k.ward === w).map((k) => {
                const a = byKennel.get(k.id);
                return a ? <PatientTile key={k.id} a={a} kennel={k.name} isolation={k.is_isolation} /> : (
                  <div key={k.id} className="flex min-h-32 flex-col justify-between rounded-2xl border border-dashed bg-surface p-4">
                    <span className="text-sm font-semibold text-muted-foreground">{k.name}{k.is_isolation ? " · isolation" : ""}</span>
                    {me.can("inpatient.manage")
                      ? <AdmitDialog kennels={kennels} doctors={doctors} defaultKennel={k.id}
                          trigger={<button type="button" className="self-start text-sm font-semibold text-brand hover:underline">Free — admit here</button>} />
                      : <span className="text-sm text-muted-foreground">Free</span>}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

type Tile = {
  id: string; reason: string; admitted_at: string; care_notes: string | null; expected_discharge_on: string | null;
  pet: { id: string; name: string; special_handling: string | null; species: { name: string } | null };
  doctor: string | null; overdue: number; dueNow: number; nextAt: number | null;
};

function PatientTile({ a, kennel, isolation }: { a: Tile; kennel: string; isolation?: boolean }) {
  return (
    <Link href={`/ward/${a.id}`} className={cn("flex min-h-32 flex-col gap-2 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border transition hover:-translate-y-0.5 hover:ring-brand-muted",
      a.overdue > 0 && "ring-2 ring-danger/50", isolation && "bg-warning-soft/40")}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{kennel}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock className="size-3" />{stayLength(a.admitted_at)}</span>
      </div>
      <p className="text-base font-bold">{a.pet.name} <span className="text-sm font-normal text-muted-foreground">{a.pet.species?.name}</span></p>
      <p className="line-clamp-2 text-sm text-muted-foreground">{a.reason}</p>
      <div className="mt-auto flex flex-wrap gap-1.5">
        {a.overdue > 0 && <StatusPill tone="danger"><Pill className="mr-1 size-3" />{a.overdue} overdue</StatusPill>}
        {a.dueNow > 0 && <StatusPill tone="warning"><Pill className="mr-1 size-3" />{a.dueNow} due now</StatusPill>}
        {!a.overdue && !a.dueNow && a.nextAt && (
          <StatusPill>Next {new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Karachi" }).format(a.nextAt)}</StatusPill>
        )}
        {a.pet.special_handling && <StatusPill tone="danger"><OctagonAlert className="mr-1 size-3" />{a.pet.special_handling}</StatusPill>}
      </div>
    </Link>
  );
}
