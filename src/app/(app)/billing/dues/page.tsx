import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleCheck, MessageCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, StatusPill } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSetting } from "@/lib/queries";
import { paymentMethods } from "@/lib/billing";
import { formatDate, formatPKR, todayPK } from "@/lib/format";
import { formatPhone, whatsappLink } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { DueActions } from "./due-actions";

export const metadata: Metadata = { title: "Unpaid bills" };

const VIEWS = [
  { key: "overdue", label: "Overdue" }, { key: "today", label: "Promised today" }, { key: "upcoming", label: "Upcoming" },
  { key: "approval", label: "Needs approval" }, { key: "all", label: "All open" },
] as const;

function daysLate(promised: string, today: string) {
  return Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${promised}T00:00:00Z`).getTime()) / 86400_000);
}

export default async function DuesPage({ searchParams }: PageProps<"/billing/dues">) {
  const me = await requireStaff();
  if (!me.can("billing.view") && !me.can("crm.manage")) redirect("/dashboard?denied=1");
  const { view: v } = await searchParams;
  const view = VIEWS.some((x) => x.key === v) ? (v as string) : "overdue";
  const today = todayPK();
  const supabase = await createClient();
  const [{ data }, methods, clinic] = await Promise.all([
    supabase.from("dues").select(`id, invoice_id, customer_id, original_amount, reason, promised_date, priority, approval_status, missed_promises, created_at,
      invoices(number, balance, issued_at), customers(full_name, phone, whatsapp), pets(name)`)
      .eq("status", "open").order("promised_date"),
    paymentMethods(),
    getSetting<{ name?: string }>("clinic.profile"),
  ]);

  const rows = (data ?? []).map((d) => {
    const inv = d.invoices as unknown as { number: string; balance: number; issued_at: string };
    return { ...d, inv, balance: Number(inv.balance), late: daysLate(d.promised_date, today),
      customer: d.customers as unknown as { full_name: string; phone: string; whatsapp: string | null },
      pet: (d.pets as unknown as { name: string } | null)?.name ?? null };
  }).filter((r) => r.balance > 0);

  const sum = (xs: typeof rows) => xs.reduce((s, r) => s + r.balance, 0);
  const buckets = [
    { label: "Not yet due", items: rows.filter((r) => r.late <= 0) },
    { label: "1–7 days late", items: rows.filter((r) => r.late >= 1 && r.late <= 7) },
    { label: "8–30 days", items: rows.filter((r) => r.late >= 8 && r.late <= 30) },
    { label: "31–60 days", items: rows.filter((r) => r.late >= 31 && r.late <= 60) },
    { label: "60+ days", items: rows.filter((r) => r.late > 60) },
  ];
  const shown = rows.filter((r) =>
    view === "overdue" ? r.late > 0 : view === "today" ? r.late === 0 : view === "upcoming" ? r.late < 0 : view === "approval" ? r.approval_status === "pending" : true)
    .sort((a, b) => (b.priority === "high" ? 1 : 0) - (a.priority === "high" ? 1 : 0) || b.late - a.late);
  const count = (k: string) => rows.filter((r) => k === "overdue" ? r.late > 0 : k === "today" ? r.late === 0 : k === "upcoming" ? r.late < 0 : k === "approval" ? r.approval_status === "pending" : true).length;
  const clinicName = clinic?.name || "Bin Dawood Animal Hospital";

  return (
    <>
      <PageHeader back={{ href: "/billing", label: "Billing" }} title="Unpaid bills"
        description="Every “pay later” is tracked here until it's paid. Opening a bill isn't enough — record a payment or a new promised date." />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {buckets.map((b, i) => (
          <div key={b.label} className={cn("rounded-2xl p-4 ring-1", i === 0 ? "bg-card ring-border" : i < 2 ? "bg-warning-soft ring-warning/30" : "bg-danger-soft ring-danger/30")}>
            <p className="text-xs font-semibold text-muted-foreground">{b.label}</p>
            <p className="mt-1 text-xl font-bold tabular">{formatPKR(sum(b.items))}</p>
            <p className="text-xs text-muted-foreground">{b.items.length} bill{b.items.length === 1 ? "" : "s"}</p>
          </div>
        ))}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">Total outstanding: <b className="text-foreground">{formatPKR(sum(rows))}</b></p>

      <div className="mb-4 flex flex-wrap gap-2">
        {VIEWS.map((x) => (
          <Link key={x.key} href={`?view=${x.key}`} className={cn("inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold ring-1",
            view === x.key ? "bg-brand-gradient text-white ring-transparent" : "bg-card ring-border hover:ring-brand-muted")}>
            {x.label}<span className={cn("rounded-full px-2 text-xs", view === x.key ? "bg-white/20" : "bg-muted")}>{count(x.key)}</span>
          </Link>
        ))}
      </div>

      {shown.length === 0 ? <EmptyState icon={CircleCheck} title="Nothing here" description="No unpaid bills in this list." /> : (
        <ul className="grid gap-3">
          {shown.map((r) => {
            const wa = whatsappLink(r.customer.whatsapp,
              `Assalam o Alaikum ${r.customer.full_name}, a gentle reminder from ${clinicName}: ${formatPKR(r.balance)} is due on bill ${r.inv.number}${r.late > 0 ? ` (promised ${formatDate(r.promised_date)})` : ""}. JazzCash / bank transfer details on request. Thank you!`);
            return (
              <li key={r.id} className={cn("grid gap-3 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border md:grid-cols-[1fr_auto]", r.priority === "high" && "ring-2 ring-danger/40")}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/customers/${r.customer_id}`} className="font-semibold hover:underline">{r.customer.full_name}</Link>
                    {r.pet && <span className="text-sm text-muted-foreground">· {r.pet}</span>}
                    <Link href={`/billing/${r.invoice_id}`} className="font-mono text-xs text-brand hover:underline">{r.inv.number}</Link>
                    {r.approval_status === "pending" && <StatusPill tone="warning">Needs manager approval</StatusPill>}
                    {r.approval_status === "rejected" && <StatusPill tone="danger">Not approved</StatusPill>}
                    {r.missed_promises > 0 && <StatusPill tone="danger">{r.missed_promises} missed promise{r.missed_promises > 1 ? "s" : ""}</StatusPill>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{formatPhone(r.customer.phone)} · {r.reason}</p>
                  <p className="mt-1 text-sm">
                    <b className="text-lg tabular">{formatPKR(r.balance)}</b>
                    <span className="text-muted-foreground"> of {formatPKR(r.original_amount)} · promised {formatDate(r.promised_date)}</span>
                    {r.late > 0 && <span className="ml-2 font-semibold text-danger">{r.late} day{r.late > 1 ? "s" : ""} late</span>}
                  </p>
                </div>
                <div className="flex flex-wrap items-start gap-2 md:justify-end">
                  <Button asChild variant="outline" size="icon-sm" aria-label="Call"><a href={`tel:${r.customer.phone}`}><Phone /></a></Button>
                  {wa && <Button asChild variant="outline" size="icon-sm" aria-label="WhatsApp reminder"><a href={wa} target="_blank" rel="noreferrer"><MessageCircle /></a></Button>}
                  <DueActions due={{ id: r.id, invoice_id: r.invoice_id, customer_id: r.customer_id, balance: r.balance, approval_status: r.approval_status }}
                    methods={methods.filter((m) => m.key !== "write_off")} canTake={me.can("billing.create")} canManage={me.can("billing.discount_approve")} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
