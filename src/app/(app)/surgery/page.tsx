import type { Metadata } from "next";
import Link from "next/link";
import { Scissors, ShieldAlert } from "lucide-react";
import { EmptyState, PageHeader, StatusPill } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDoctors } from "@/lib/queries";
import { formatDate, formatTime, todayPK } from "@/lib/format";
import { SURGERY_LABEL, SURGERY_STAGES, SURGERY_TONE, URGENCY, type SurgeryStatus } from "@/lib/clinic";
import { cn } from "@/lib/utils";
import { PlanSurgeryDialog } from "./plan-dialog";

export const metadata: Metadata = { title: "Surgery" };

type Row = {
  id: string; code: string; status: SurgeryStatus; urgency: string; procedure_name: string; scheduled_at: string | null;
  discharged_at: string | null; pet: { id: string; name: string; species: string | null }; owner: string; surgeon: string | null;
  has_consent: boolean; preop_done: boolean;
};

export default async function SurgeryPage() {
  const me = await requireStaff();
  const supabase = await createClient();
  const today = todayPK();
  const [{ data }, { data: procedures }, doctors] = await Promise.all([
    supabase.from("surgeries")
      .select(`id, code, status, urgency, procedure_name, scheduled_at, discharged_at, preop_checked_at,
        pets(id, name, species(name)), customers(full_name), surgeon:surgeon_id(full_name), surgery_consents(revoked_at)`)
      .or(`status.not.in.(discharged,cancelled),discharged_at.gte.${today}T00:00:00+05:00`)
      .order("scheduled_at", { ascending: true, nullsFirst: false }).limit(200),
    supabase.from("surgery_procedures").select("id, name, default_minutes").eq("is_active", true).order("sort_order"),
    getDoctors(),
  ]);

  const rows: Row[] = (data ?? []).map((s) => {
    const pet = s.pets as unknown as { id: string; name: string; species: { name: string } | null };
    return {
      id: s.id, code: s.code, status: s.status, urgency: s.urgency, procedure_name: s.procedure_name,
      scheduled_at: s.scheduled_at, discharged_at: s.discharged_at,
      pet: { id: pet.id, name: pet.name, species: pet.species?.name ?? null },
      owner: (s.customers as unknown as { full_name: string }).full_name,
      surgeon: (s.surgeon as unknown as { full_name: string } | null)?.full_name ?? null,
      has_consent: ((s.surgery_consents ?? []) as { revoked_at: string | null }[]).some((c) => !c.revoked_at),
      preop_done: !!s.preop_checked_at,
    };
  });

  const pkDay = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date(iso)) : null);
  const active = ["admitted", "pre_op", "in_surgery", "recovery"];
  const groups = [
    { title: "Today", items: rows.filter((r) => active.includes(r.status) || (r.status === "scheduled" && pkDay(r.scheduled_at) === today) || (r.status === "discharged")) },
    { title: "Upcoming", items: rows.filter((r) => r.status === "scheduled" && (pkDay(r.scheduled_at) ?? "") > today) },
    { title: "Not scheduled yet", items: rows.filter((r) => r.status === "planned" || (r.status === "scheduled" && (pkDay(r.scheduled_at) ?? "") < today)) },
  ];

  return (
    <>
      <PageHeader title="Surgery" description="From plan to discharge — consent and pre-op checks are required before the operation starts."
        actions={me.can("surgery.manage") && <PlanSurgeryDialog procedures={procedures ?? []} doctors={doctors} />} />
      {rows.length === 0 ? (
        <EmptyState icon={Scissors} title="No surgeries planned" description="Plan one from a visit, or with the button above." />
      ) : (
        <div className="grid gap-8">
          {groups.filter((g) => g.items.length).map((g) => (
            <section key={g.title}>
              <h2 className="mb-3 text-lg font-semibold">{g.title} <span className="font-normal text-muted-foreground">({g.items.length})</span></h2>
              <ul className="grid gap-3">
                {g.items.map((r) => <SurgeryCard key={r.id} r={r} />)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function SurgeryCard({ r }: { r: Row }) {
  const stageIndex = SURGERY_STAGES.findIndex((s) => s.status === r.status);
  const blocked = r.status === "pre_op" && (!r.has_consent || !r.preop_done);
  return (
    <li>
      <Link href={`/surgery/${r.id}`}
        className={cn("grid gap-3 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border transition hover:ring-brand-muted sm:grid-cols-[1fr_auto]",
          r.urgency === "emergency" && r.status !== "discharged" && "ring-2 ring-danger/50")}>
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl text-white",
            r.status === "in_surgery" ? "bg-danger" : "bg-brand-gradient")}><Scissors className="size-5" /></span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{r.pet.name} <span className="font-normal text-muted-foreground">· {r.procedure_name}</span></p>
            <p className="truncate text-sm text-muted-foreground">
              {[r.pet.species, r.owner, r.surgeon ?? "Surgeon not set",
                r.scheduled_at ? `${formatDate(r.scheduled_at)} ${formatTime(r.scheduled_at)}` : null].filter(Boolean).join(" · ")}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {r.urgency !== "elective" && <StatusPill tone={URGENCY[r.urgency].tone}>{URGENCY[r.urgency].label}</StatusPill>}
              {r.status !== "discharged" && (
                <StatusPill tone={r.has_consent ? "success" : "warning"}>{r.has_consent ? "Consent ✓" : "Consent needed"}</StatusPill>
              )}
              {blocked && <StatusPill tone="danger"><ShieldAlert className="mr-1 size-3" /> Not ready for theatre</StatusPill>}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <StatusPill tone={SURGERY_TONE[r.status]}>{SURGERY_LABEL[r.status]}</StatusPill>
          <div className="flex gap-1" aria-hidden>
            {SURGERY_STAGES.map((s, i) => (
              <span key={s.status} className={cn("h-1.5 w-5 rounded-full", i <= stageIndex ? "bg-brand" : "bg-muted")} />
            ))}
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">{r.code}</span>
        </div>
      </Link>
    </li>
  );
}
