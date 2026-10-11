import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BellRing, Boxes, CalendarX, CircleCheck, CreditCard, FileWarning, FlaskConical, ListTodo, Stethoscope, Syringe, TrendingUp, type LucideIcon } from "lucide-react";
import { EmptyState, PageHeader, StatusPill } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getStaffOptions } from "@/lib/queries";
import { formatDate, formatPKR, todayPK } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RunNowButton } from "../messages/run-now";
import { PauseButton } from "./pause-button";

export const metadata: Metadata = { title: "Alert centre" };

const KINDS: Record<string, { label: string; icon: LucideIcon; action: string }> = {
  payment: { label: "Unpaid bills", icon: CreditCard, action: "Take payment or record a new promise" },
  due_approval: { label: "Pay-later approvals", icon: CreditCard, action: "Approve or reject" },
  vaccination: { label: "Vaccinations", icon: Syringe, action: "Contact owner, book, or record the dose" },
  follow_up: { label: "Follow-ups", icon: Stethoscope, action: "Book the recheck or record the outcome" },
  diagnostic: { label: "Test results", icon: FlaskConical, action: "Review the result" },
  record: { label: "Unfinished records", icon: FileWarning, action: "Finish & finalize the consultation" },
  task: { label: "Tasks", icon: ListTodo, action: "Do it and write the outcome" },
  stock: { label: "Stock", icon: Boxes, action: "Reorder, or write off expired stock" },
  no_show: { label: "No-shows", icon: CalendarX, action: "Call to rebook" },
};
const SEV = { critical: { label: "Critical", tone: "danger" }, warning: { label: "Needs attention", tone: "warning" }, info: { label: "Today", tone: "info" } } as const;

export default async function AlertsPage({ searchParams }: PageProps<"/alerts">) {
  const me = await requireStaff();
  const sp = await searchParams;
  const kind = typeof sp.kind === "string" && KINDS[sp.kind] ? sp.kind : "";
  const sev = typeof sp.severity === "string" && sp.severity in SEV ? sp.severity : "";
  const today = todayPK();
  const supabase = await createClient();
  const [{ data: alerts }, { data: tracks }, staff, dues] = await Promise.all([
    supabase.from("open_alerts").select("*").order("days_overdue", { ascending: false }).limit(500),
    supabase.from("reminder_tracks").select("id, source_table, source_id, escalation_level, paused_until, customer_msgs").is("closed_at", null),
    getStaffOptions(),
    me.can("billing.view") ? supabase.from("dues").select("promised_date, invoices(balance)").eq("status", "open") : Promise.resolve({ data: null }),
  ]);
  const names = new Map(staff.map((s) => [s.id, s.full_name]));
  const trackOf = new Map((tracks ?? []).map((t) => [`${t.source_table}:${t.source_id}`, t]));
  const rows = (alerts ?? []).map((a) => ({ ...a, track: trackOf.get(`${a.source_table}:${a.source_id}`) ?? null }));
  const shown = rows.filter((r) => (!kind || r.kind === kind) && (!sev || r.severity === sev))
    .sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity as "info"] - { critical: 0, warning: 1, info: 2 }[b.severity as "info"])
      || (b.track?.escalation_level ?? 0) - (a.track?.escalation_level ?? 0) || b.days_overdue - a.days_overdue);

  const dueRows = (dues.data ?? []) as unknown as { promised_date: string; invoices: { balance: number } | null }[];
  const receivable = dueRows.reduce((s, d) => s + Number(d.invoices?.balance ?? 0), 0);
  const overdueMoney = dueRows.filter((d) => d.promised_date < today).reduce((s, d) => s + Number(d.invoices?.balance ?? 0), 0);
  const promisedToday = dueRows.filter((d) => d.promised_date === today).reduce((s, d) => s + Number(d.invoices?.balance ?? 0), 0);
  const escalated = rows.filter((r) => (r.track?.escalation_level ?? 0) > 0).length;
  const count = (k: string, overdueOnly = false) => rows.filter((r) => r.kind === k && (!overdueOnly || r.days_overdue > 0)).length;

  const cards: { label: string; value: string; href: string; tone?: "danger" | "warning"; icon: LucideIcon }[] = [
    ...(me.can("billing.view") ? [
      { label: "Outstanding receivables", value: formatPKR(receivable), href: "/billing/dues?view=all", icon: TrendingUp },
      { label: "Overdue receivables", value: formatPKR(overdueMoney), href: "/billing/dues", tone: overdueMoney ? "danger" as const : undefined, icon: CreditCard },
      { label: "Promised today", value: formatPKR(promisedToday), href: "/billing/dues?view=today", icon: CreditCard },
    ] : []),
    { label: "Vaccinations overdue", value: String(count("vaccination", true)), href: "?kind=vaccination", tone: count("vaccination", true) ? "warning" : undefined, icon: Syringe },
    { label: "Follow-ups overdue", value: String(count("follow_up", true)), href: "?kind=follow_up", tone: count("follow_up", true) ? "warning" : undefined, icon: Stethoscope },
    { label: "Tests pending / to review", value: String(count("diagnostic")), href: "?kind=diagnostic", icon: FlaskConical },
    { label: "Low / expiring stock", value: String(count("stock")), href: "?kind=stock", icon: Boxes },
    { label: "Escalated items", value: String(escalated), href: "?severity=critical", tone: escalated ? "danger" : undefined, icon: BellRing },
  ];

  return (
    <>
      <PageHeader title="Alert centre" description="Everything unfinished across the hospital. Viewing an item doesn't close it — record the outcome in its workflow."
        actions={(me.can("crm.manage") || me.can("settings.manage")) && <RunNowButton />} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className={cn("rounded-2xl p-4 ring-1 transition hover:ring-brand-muted",
            c.tone === "danger" ? "bg-danger-soft ring-danger/30" : c.tone === "warning" ? "bg-warning-soft ring-warning/30" : "bg-card shadow-card ring-border")}>
            <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><c.icon className="size-4" /> {c.label}</p>
            <p className={cn("mt-1 text-2xl font-bold tabular", c.tone === "danger" && "text-danger", c.tone === "warning" && "text-warning")}>{c.value}</p>
          </Link>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Chip href="?" on={!kind && !sev} label={`All (${rows.length})`} />
        {Object.entries(SEV).map(([k, v]) => <Chip key={k} href={`?severity=${k}${kind ? `&kind=${kind}` : ""}`} on={sev === k} label={`${v.label} (${rows.filter((r) => r.severity === k).length})`} />)}
        <span className="mx-1 w-px bg-border" />
        {Object.entries(KINDS).filter(([k]) => count(k) > 0).map(([k, v]) => <Chip key={k} href={`?kind=${k}${sev ? `&severity=${sev}` : ""}`} on={kind === k} label={`${v.label} (${count(k)})`} />)}
      </div>

      {shown.length === 0 ? <EmptyState icon={CircleCheck} title="Nothing unfinished" description="Every item here has an outcome. Well done." /> : (
        <ul className="grid gap-2">
          {shown.map((a) => {
            const k = KINDS[a.kind] ?? { label: a.kind, icon: BellRing, action: "Open" };
            const s = SEV[a.severity as keyof typeof SEV];
            return (
              <li key={`${a.source_table}-${a.source_id}-${a.kind}`} className={cn("flex flex-wrap items-center gap-3 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border",
                a.severity === "critical" && "ring-2 ring-danger/40")}>
                <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", a.severity === "critical" ? "bg-danger-soft text-danger" : "bg-brand-soft text-brand")}><k.icon className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="truncate">{a.title}</b>
                    <StatusPill tone={s.tone}>{s.label}</StatusPill>
                    {(a.track?.escalation_level ?? 0) > 0 && <StatusPill tone="danger">Escalated ×{a.track!.escalation_level}</StatusPill>}
                    {a.track?.paused_until && <StatusPill>Paused until {formatDate(a.track.paused_until)}</StatusPill>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {[a.subtitle, a.days_overdue > 0 ? `${a.days_overdue} day(s) late` : a.days_overdue === 0 ? "due today" : null,
                      a.responsible_id ? `responsible: ${names.get(a.responsible_id) ?? "—"}` : null,
                      a.track?.customer_msgs ? `${a.track.customer_msgs} reminder(s) sent` : null].filter(Boolean).join(" · ")}
                  </p>
                  <p className="text-xs text-brand">{k.action}</p>
                </div>
                {a.track && ["dues", "due_items"].includes(a.source_table) && <PauseButton trackId={a.track.id} pausedUntil={a.track.paused_until} />}
                <Link href={a.link} className="inline-flex h-9 items-center gap-1 rounded-xl bg-ink px-3 text-sm font-semibold text-white hover:bg-ink/85">Open <ArrowRight className="size-4" /></Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function Chip({ href, on, label }: { href: string; on: boolean; label: string }) {
  return <Link href={href} className={cn("inline-flex h-9 items-center rounded-xl px-3 text-sm font-semibold ring-1", on ? "bg-ink text-white ring-ink" : "bg-card ring-border hover:ring-brand-muted")}>{label}</Link>;
}
