import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeftRight, ArrowRight, ArrowUpRight, BedDouble, Boxes, CalendarClock, CalendarDays, CalendarPlus, CheckCircle2, Clock, CreditCard,
  ListOrdered, ListTodo, MessageCircle, PackageCheck, PawPrint, Receipt, Search, ShieldAlert, ShoppingBag, Syringe, UserCog, UserPlus, Users,
  Wallet, type LucideIcon,
} from "lucide-react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/brand/logo";
import { OpenSearch } from "@/components/app/open-search";
import { Greeting } from "@/components/app/greeting";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatTime, initials, isPast, TIMEZONE, todayPK } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { presetRange, type FinancialReport } from "@/lib/reports";
import { withContact } from "@/lib/contacts";

export const metadata: Metadata = { title: "Home" };

/** Start of "today" in Lahore, as an ISO timestamp. */
function startOfTodayPK() {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
  return new Date(`${ymd}T00:00:00+05:00`).toISOString();
}

type QueueRow = {
  id: string; token_no: number; status: string; priority: string; reason: string | null; checked_in_at: string;
  pets: { name: string; species: { name: string } | null } | null; customers: { full_name: string } | null;
};
const STATUS: Record<string, { label: string; cls: string }> = {
  waiting: { label: "Waiting", cls: "bg-warning-soft text-warning" },
  with_doctor: { label: "With doctor", cls: "bg-info-soft text-info" },
  in_treatment: { label: "In treatment", cls: "bg-brand-soft text-brand" },
  ready_for_billing: { label: "Ready to bill", cls: "bg-success-soft text-success" },
};
/** Example chips under the homepage search — each opens the search pre-filled. */
const TRY = [
  { q: "0300", label: "phone" }, { q: "#1", label: "token" }, { q: "pet: ", label: "pet name" },
  { q: "bill: ", label: "bill no." }, { q: "item: ", label: "product" },
];

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const me = await requireStaff();
  const { denied } = await searchParams;
  const supabase = await createClient();
  const today = startOfTodayPK();

  const canCustomers = me.can("customers.view");
  const canPets = me.can("pets.view");
  const canQueue = me.can("queue.manage") || me.can("clinical.view");
  const canAppts = me.can("appointments.view");
  const canDue = me.can("clinical.view") || me.can("crm.view");
  const ymd = todayPK();

  const seeMoney = me.can("finance.view") || me.can("billing.create");
  const canDeliveries = me.can("pos.use") || me.can("billing.create");
  const [customers, pets, newCustomers, newPets, recent, queue, appts, dueToday, overdue, inWard, theatre, payToday, openDues, stock, toSend, myTasks, deliveries, loansDue] = await Promise.all([
    canCustomers ? supabase.from("customers").select("id", { count: "exact", head: true }).neq("status", "merged") : null,
    canPets ? supabase.from("pets").select("id", { count: "exact", head: true }).eq("status", "active") : null,
    canCustomers ? supabase.from("customers").select("id", { count: "exact", head: true }).gte("created_at", today) : null,
    canPets ? supabase.from("pets").select("id", { count: "exact", head: true }).gte("created_at", today) : null,
    canCustomers
      ? supabase.from("customers").select("id, code, full_name, customer_contacts(phone, whatsapp), area, created_at, pet_owners(pets(name))")
          .neq("status", "merged").order("created_at", { ascending: false }).limit(6)
      : null,
    canQueue ? supabase.from("visits").select("id, token_no, status, priority, reason, checked_in_at, pets(name, species(name)), customers(full_name)")
      .eq("visit_date", ymd).in("status", ["waiting", "with_doctor", "in_treatment", "ready_for_billing"]).order("token_no") : null,
    canAppts ? supabase.from("appointments").select("id", { count: "exact", head: true })
      .gte("starts_at", `${ymd}T00:00:00+05:00`).lte("starts_at", `${ymd}T23:59:59+05:00`).in("status", ["booked", "confirmed"]) : null,
    canDue ? supabase.from("due_items").select("id", { count: "exact", head: true }).eq("status", "pending").eq("due_on", ymd) : null,
    canDue ? supabase.from("due_items").select("id", { count: "exact", head: true }).eq("status", "pending").lt("due_on", ymd) : null,
    me.can("clinical.view") ? supabase.from("admissions").select("id", { count: "exact", head: true }).eq("status", "admitted") : null,
    me.can("clinical.view") ? supabase.from("surgeries").select("id", { count: "exact", head: true }).in("status", ["admitted", "pre_op", "in_surgery", "recovery"]) : null,
    seeMoney ? supabase.from("payments").select("kind, amount").gte("received_at", `${ymd}T00:00:00+05:00`) : null,
    me.can("billing.view") ? supabase.from("dues").select("promised_date, invoices(balance)").eq("status", "open") : null,
    me.can("inventory.view") ? supabase.from("stock_levels").select("usable_qty, reorder_level, next_expiry, expired_qty") : null,
    me.can("crm.manage") ? supabase.from("messages").select("id", { count: "exact", head: true }).in("status", ["to_send", "queued"]).lte("scheduled_for", ymd) : null,
    supabase.from("tasks").select("id, due_at", { count: "exact" }).eq("assigned_to", me.id).in("status", ["open", "in_progress"]),
    canDeliveries ? supabase.from("invoices").select("delivery_status").eq("fulfilment", "home_delivery").eq("status", "issued").in("delivery_status", ["pending", "dispatched"]) : null,
    me.can("inventory.view") ? supabase.from("stock_loans").select("id", { count: "exact", head: true })
      .in("status", ["pending_return", "partially_returned"]).lt("expected_return_date", ymd) : null,
  ]);
  const queueRows = (queue?.data ?? []) as unknown as QueueRow[];
  const waitingCount = queueRows.filter((v) => v.status === "waiting").length;
  const inClinicCount = queueRows.length - waitingCount;
  const toDispatch = (deliveries?.data ?? []).filter((d) => d.delivery_status === "pending").length;
  const outForDelivery = (deliveries?.data ?? []).filter((d) => d.delivery_status === "dispatched").length;
  const month = presetRange("mtd");
  const monthReport = me.can("reports.financial")
    ? ((await supabase.rpc("report_financial", { p_from: month.from, p_to: month.to })).data as FinancialReport | null)
    : null;
  const myOverdueTasks = (myTasks?.data ?? []).filter((t) => isPast(t.due_at)).length;
  const collected = (payToday?.data ?? []).reduce((s, p) => s + (p.kind === "payment" ? Number(p.amount) : p.kind === "refund" ? -Number(p.amount) : 0), 0);
  const owed = (openDues?.data ?? []).reduce((s, d) => s + Number((d.invoices as unknown as { balance: number } | null)?.balance ?? 0), 0);
  const overdueMoney = (openDues?.data ?? []).filter((d) => d.promised_date < ymd).reduce((s, d) => s + Number((d.invoices as unknown as { balance: number } | null)?.balance ?? 0), 0);
  const stockAlerts = (stock?.data ?? []).filter((r) => (r.reorder_level != null && Number(r.usable_qty) <= Number(r.reorder_level)) || Number(r.expired_qty) > 0).length;
  const rs = (n: number) => `Rs. ${Math.round(n).toLocaleString("en-PK")}`;

  // Doctors are greeted as "Dr. Musab"; everyone else by first name.
  const firstName = me.fullName.replace(/^dr\.?\s+/i, "").split(" ")[0];
  const displayName = me.isDoctor ? `Dr. ${firstName}` : firstName;

  type Action = { title: string; icon: LucideIcon; href: string; primary?: boolean };
  const actions = ([
    me.can("queue.manage") && { title: "Check in a pet", icon: ListOrdered, href: "/queue", primary: true },
    !me.can("queue.manage") && me.can("clinical.view") && { title: "Today's queue", icon: ListOrdered, href: "/queue", primary: true },
    me.can("appointments.manage") && { title: "Book appointment", icon: CalendarPlus, href: "/appointments" },
    me.can("customers.create") && { title: "New pet owner", icon: UserPlus, href: "/customers/new" },
    me.can("pets.create") && { title: "Add a pet", icon: PawPrint, href: "/pets/new" },
    me.can("pos.use") && { title: "Pet store sale", icon: ShoppingBag, href: "/pos", primary: !canQueue },
    me.can("billing.create") && { title: "Bills", icon: Receipt, href: "/billing" },
    me.can("staff.manage") && { title: "Add staff", icon: UserCog, href: "/admin/staff/new" },
  ].filter(Boolean) as Action[]).slice(0, 6);

  // Today in plain numbers (always shown when allowed).
  type Kpi = { label: string; value: string; sub: string; icon: LucideIcon; href: string };
  const kpis = ([
    canQueue && { label: "Waiting", value: String(waitingCount), sub: `${inClinicCount} with doctor / treatment`, icon: ListOrdered, href: "/queue" },
    canAppts && { label: "Appointments left", value: String(appts?.count ?? 0), sub: "booked or confirmed", icon: CalendarDays, href: "/appointments" },
    canDue && { label: "Due today", value: String(dueToday?.count ?? 0), sub: "vaccines & follow-ups", icon: Syringe, href: "/due?view=today" },
    me.can("clinical.view") && { label: "In the ward", value: String(inWard?.count ?? 0), sub: `${theatre?.count ?? 0} surgery case(s)`, icon: BedDouble, href: "/ward" },
    seeMoney && { label: "Collected today", value: rs(collected), sub: "payments − refunds", icon: Wallet, href: "/billing" },
  ].filter(Boolean) as Kpi[]);

  // Things someone should act on — listed only when there is something to do.
  type Todo = { label: string; sub: string; count: string; icon: LucideIcon; href: string; tone: "danger" | "warning" };
  const todos = ([
    canDue && (overdue?.count ?? 0) > 0 && { label: "Overdue vaccines & follow-ups", sub: "need a call from reception", count: String(overdue?.count), icon: CalendarClock, href: "/due?view=overdue", tone: "danger" },
    me.can("billing.view") && owed > 0 && { label: "Owed to the clinic", sub: overdueMoney ? `${rs(overdueMoney)} past the promised date` : "none overdue yet", count: rs(owed), icon: CreditCard, href: "/billing/dues", tone: overdueMoney > 0 ? "danger" : "warning" },
    me.can("crm.manage") && (toSend?.count ?? 0) > 0 && { label: "Messages to send", sub: "reminders ready for WhatsApp", count: String(toSend?.count), icon: MessageCircle, href: "/messages", tone: "warning" },
    (myTasks?.count ?? 0) > 0 && { label: "My tasks", sub: myOverdueTasks ? `${myOverdueTasks} overdue` : "none overdue", count: String(myTasks?.count), icon: ListTodo, href: "/tasks", tone: myOverdueTasks ? "danger" : "warning" },
    canDeliveries && toDispatch + outForDelivery > 0 && { label: "Home deliveries", sub: `${toDispatch} to dispatch · ${outForDelivery} on the way`, count: String(toDispatch + outForDelivery), icon: PackageCheck, href: "/pos/deliveries", tone: "warning" },
    me.can("inventory.view") && stockAlerts > 0 && { label: "Stock to check", sub: "low or expired items", count: String(stockAlerts), icon: Boxes, href: "/inventory", tone: "warning" },
    me.can("inventory.view") && (loansDue?.count ?? 0) > 0 && { label: "Stock loans overdue", sub: "borrowed / lent items not returned", count: String(loansDue?.count), icon: ArrowLeftRight, href: "/inventory/loans", tone: "danger" },
  ].filter(Boolean) as Todo[]);

  const totals = [
    canCustomers && { label: "Pet owners", value: customers?.count ?? 0, today: newCustomers?.count ?? 0, icon: Users, href: "/customers" },
    canPets && { label: "Active pets", value: pets?.count ?? 0, today: newPets?.count ?? 0, icon: PawPrint, href: "/pets" },
  ].filter(Boolean) as { label: string; value: number; today: number; icon: LucideIcon; href: string }[];

  const summary = [
    canQueue && `${waitingCount} waiting`,
    canAppts && `${appts?.count ?? 0} appointment${appts?.count === 1 ? "" : "s"} left today`,
    todos.length ? `${todos.length} thing${todos.length === 1 ? "" : "s"} need attention` : "nothing urgent",
  ].filter(Boolean).join(" · ");
  const canSearch = canCustomers || canPets;

  return (
    <div className="grid grid-cols-1 gap-6">
      {denied && (
        <Alert>
          <ShieldAlert />
          <AlertDescription>You don&apos;t have access to that page. Ask the admin if you need it.</AlertDescription>
        </Alert>
      )}

      {/* Greeting + spotlight search */}
      <section className="relative overflow-hidden rounded-3xl bg-ink bg-hero-gradient px-5 py-6 text-white shadow-float shadow-brand/20 md:px-8 md:py-8">
        <LogoMark tone="white" className="pointer-events-none absolute -right-6 -bottom-10 hidden w-52 opacity-[0.07] md:block" />
        <div className="relative max-w-3xl">
          <Greeting name={displayName} initial={new Date().toISOString()} />
          <p className="mt-1.5 text-sm text-white/70">{summary}</p>
          {canSearch && (
            <>
              <OpenSearch className="mt-6 flex h-14 w-full items-center gap-3 rounded-2xl bg-white px-5 text-left text-muted-foreground shadow-lg transition hover:ring-4 hover:ring-white/20">
                <Search className="size-5 shrink-0 text-brand" />
                <span className="flex-1 truncate text-base">Search owners, pets, phone numbers, bills, products…</span>
                <kbd className="hidden rounded-md border bg-card px-1.5 py-0.5 font-mono text-[11px] sm:inline">Ctrl K</kbd>
              </OpenSearch>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="mr-0.5 text-white/60">Try</span>
                {TRY.map((t) => (
                  <OpenSearch key={t.label} q={t.q} className="rounded-full bg-white/10 px-2.5 py-1 text-white ring-1 ring-white/20 transition hover:bg-white/20">
                    <code className="font-mono font-semibold">{t.q.trim()}</code> <span className="text-white/65">{t.label}</span>
                  </OpenSearch>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Quick actions */}
      {actions.length > 0 && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {actions.map((a) => (
            <Link key={a.title} href={a.href}
              className="group flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border transition hover:-translate-y-0.5 hover:shadow-float hover:ring-brand-muted">
              <span className={cn("flex size-10 items-center justify-center rounded-xl",
                a.primary ? "bg-brand-gradient text-white shadow-md shadow-brand/25" : "bg-brand-soft text-brand")}>
                <a.icon className="size-5" />
              </span>
              <span className="flex items-center justify-between gap-1 text-sm font-semibold">
                {a.title}
                <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
              </span>
            </Link>
          ))}
        </section>
      )}

      {/* Today in numbers */}
      {kpis.length > 0 && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
          {kpis.map((k) => (
            <Link key={k.label} href={k.href} className="group rounded-2xl bg-card p-4 shadow-card ring-1 ring-border transition hover:ring-brand-muted">
              <span className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                <span className="truncate">{k.label}</span>
                <k.icon className="size-4 shrink-0 text-foreground/40 transition group-hover:text-brand" />
              </span>
              <span className="mt-1 block truncate text-2xl font-bold tracking-tight tabular">{k.value}</span>
              <span className="block truncate text-xs text-muted-foreground">{k.sub}</span>
            </Link>
          ))}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Today's queue for clinic staff; recent owners for everyone else */}
        {canQueue ? (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Today&apos;s queue</CardTitle>
              <CardAction>
                <Link href="/queue" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
                  Open queue <ArrowUpRight className="size-4" />
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent className="px-2">
              {queueRows.length ? (
                <ul>
                  {queueRows.slice(0, 7).map((v) => {
                    const st = STATUS[v.status] ?? STATUS.waiting;
                    return (
                      <li key={v.id}>
                        <Link href={`/visits/${v.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-muted/70">
                          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl font-mono text-sm font-bold",
                            v.priority === "normal" ? "bg-muted text-foreground" : "bg-danger-soft text-danger")}>#{v.token_no}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold">
                              {v.pets?.name ?? "Pet"}{v.pets?.species?.name && <span className="font-normal text-muted-foreground"> · {v.pets.species.name}</span>}
                            </p>
                            <p className="truncate text-sm text-muted-foreground">{v.customers?.full_name}{v.reason ? ` · ${v.reason}` : ""}</p>
                          </div>
                          <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:inline-flex"><Clock className="size-3" />{formatTime(v.checked_in_at)}</span>
                          <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", st.cls)}>{st.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                  {queueRows.length > 7 && (
                    <li><Link href="/queue" className="block px-3 py-2 text-sm font-semibold text-brand hover:underline">+{queueRows.length - 7} more in the queue</Link></li>
                  )}
                </ul>
              ) : (
                <div className="flex flex-col items-center gap-3 px-3 py-10 text-center text-muted-foreground">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-muted"><ListOrdered className="size-6" /></span>
                  No one in the queue right now.
                  {me.can("queue.manage") && <Button asChild size="sm"><Link href="/queue">Check in a pet</Link></Button>}
                </div>
              )}
            </CardContent>
          </Card>
        ) : recent && <RecentOwners rows={(recent.data ?? []) as RecentRow[]} className="lg:col-span-2" />}

        {/* Needs attention */}
        <Card>
          <CardHeader><CardTitle>Needs attention</CardTitle></CardHeader>
          <CardContent className="px-2">
            {todos.length ? (
              <ul>
                {todos.map((t) => (
                  <li key={t.label}>
                    <Link href={t.href} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-muted/70">
                      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl",
                        t.tone === "danger" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>
                        <t.icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{t.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">{t.sub}</span>
                      </span>
                      <span className={cn("shrink-0 text-sm font-bold tabular", t.tone === "danger" ? "text-danger" : "text-warning")}>{t.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center gap-2 px-3 py-10 text-center text-sm text-muted-foreground">
                <CheckCircle2 className="size-8 text-success" />
                All clear — nothing overdue or waiting on you.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {((canQueue && recent) || totals.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-3">
          {canQueue && recent && <RecentOwners rows={(recent.data ?? []) as RecentRow[]} className="lg:col-span-2" />}
          {totals.length > 0 && (
            <div className={cn("grid content-start gap-4 sm:grid-cols-2", canQueue && recent ? "lg:grid-cols-1" : "lg:col-span-3")}>
              {totals.map((s) => (
                <Link key={s.label} href={s.href} className="flex items-center gap-4 rounded-2xl bg-card p-5 shadow-card ring-1 ring-border transition hover:ring-brand-muted">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand"><s.icon className="size-6" /></span>
                  <span className="flex-1">
                    <span className="block text-sm text-muted-foreground">{s.label}</span>
                    <span className="block text-3xl font-bold tracking-tight tabular">{s.value.toLocaleString("en-PK")}</span>
                  </span>
                  <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", s.today ? "bg-success-soft text-success" : "bg-muted text-muted-foreground")}>+{s.today} today</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {monthReport && (
        <Card>
          <CardHeader>
            <CardTitle>This month so far</CardTitle>
            <CardAction>
              <Link href="/reports" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
                Full reports <ArrowUpRight className="size-4" />
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Billed", value: monthReport.billed.net, sub: `${monthReport.billed.bills} bills issued` },
              { label: "Collected", value: monthReport.collected.net, sub: "cash actually received" },
              { label: "Owed to the clinic", value: monthReport.owed.total, sub: "unpaid today, all dates", danger: monthReport.owed.total > 0 },
              { label: "Estimated profit", value: monthReport.estimate?.profit ?? null, sub: "after stock cost & expenses", brand: true },
            ].map((t) => (
              <div key={t.label} className={cn("rounded-xl p-3 ring-1", t.brand ? "bg-brand-wash ring-brand-muted" : "bg-surface ring-border")}>
                <p className="text-xs text-muted-foreground">{t.label}</p>
                <p className={cn("mt-1 text-xl font-bold tabular", t.danger && "text-danger", t.brand && "text-brand")}>
                  {t.value == null ? "—" : rs(t.value)}
                </p>
                <p className="text-xs text-muted-foreground">{t.sub}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type RecentRow = { id: string; full_name: string; created_at: string; pet_owners: { pets: unknown }[] | null };

function RecentOwners({ rows, className }: { rows: RecentRow[]; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Recently registered</CardTitle>
        <CardAction>
          <Link href="/customers" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
            See all <ArrowUpRight className="size-4" />
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2">
        {rows.length ? (
          <ul>
            {rows.map((c) => {
              const petNames = (c.pet_owners ?? []).flatMap((po) => {
                const p = po.pets as { name: string } | null;
                return p ? [p.name] : [];
              });
              return (
                <li key={c.id}>
                  <Link href={`/customers/${c.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-muted/70">
                    <Avatar className="size-10 rounded-xl">
                      <AvatarFallback className="rounded-xl bg-brand-soft text-sm font-semibold text-brand">{initials(c.full_name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{c.full_name}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {[formatPhone(withContact(c).phone), petNames.join(", ")].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{formatDateTime(c.created_at)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-3 py-8 text-center text-muted-foreground">
            No pet owners yet — tap <b className="text-foreground">New pet owner</b> above to register the first one.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
