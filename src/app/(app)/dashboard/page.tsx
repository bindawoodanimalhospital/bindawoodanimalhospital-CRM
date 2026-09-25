import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, ArrowUpRight, BedDouble, Boxes, CalendarClock, CreditCard, ListTodo, MessageCircle, ShoppingBag, Wallet, CalendarDays, CalendarPlus, ListOrdered, PawPrint, Search, ShieldAlert, Syringe,
  UserCog, UserPlus, Users, type LucideIcon,
} from "lucide-react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogoMark } from "@/components/brand/logo";
import { OpenSearch } from "@/components/app/open-search";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, initials, isPast, TIMEZONE, todayPK } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Home" };

/** Start of "today" in Lahore, as an ISO timestamp. */
function startOfTodayPK() {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
  return new Date(`${ymd}T00:00:00+05:00`).toISOString();
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: TIMEZONE }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

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
  const [customers, pets, newCustomers, newPets, recent, waiting, inClinic, appts, dueToday, overdue, inWard, theatre, payToday, openDues, stock, toSend, myTasks] = await Promise.all([
    canCustomers ? supabase.from("customers").select("id", { count: "exact", head: true }).neq("status", "merged") : null,
    canPets ? supabase.from("pets").select("id", { count: "exact", head: true }).eq("status", "active") : null,
    canCustomers ? supabase.from("customers").select("id", { count: "exact", head: true }).gte("created_at", today) : null,
    canPets ? supabase.from("pets").select("id", { count: "exact", head: true }).gte("created_at", today) : null,
    canCustomers
      ? supabase.from("customers").select("id, code, full_name, phone, area, created_at, pet_owners(pets(name))")
          .neq("status", "merged").order("created_at", { ascending: false }).limit(6)
      : null,
    canQueue ? supabase.from("visits").select("id", { count: "exact", head: true }).eq("visit_date", ymd).eq("status", "waiting") : null,
    canQueue ? supabase.from("visits").select("id", { count: "exact", head: true }).eq("visit_date", ymd).in("status", ["with_doctor", "in_treatment", "ready_for_billing"]) : null,
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
  ]);
  const myOverdueTasks = (myTasks?.data ?? []).filter((t) => isPast(t.due_at)).length;
  const collected = (payToday?.data ?? []).reduce((s, p) => s + (p.kind === "payment" ? Number(p.amount) : p.kind === "refund" ? -Number(p.amount) : 0), 0);
  const owed = (openDues?.data ?? []).reduce((s, d) => s + Number((d.invoices as unknown as { balance: number } | null)?.balance ?? 0), 0);
  const overdueMoney = (openDues?.data ?? []).filter((d) => d.promised_date < ymd).reduce((s, d) => s + Number((d.invoices as unknown as { balance: number } | null)?.balance ?? 0), 0);
  const stockAlerts = (stock?.data ?? []).filter((r) => (r.reorder_level != null && Number(r.usable_qty) <= Number(r.reorder_level)) || Number(r.expired_qty) > 0).length;

  // Doctors are greeted as "Dr. Musab"; everyone else by first name.
  const firstName = me.fullName.replace(/^dr\.?\s+/i, "").split(" ")[0];
  const displayName = me.isDoctor ? `Dr. ${firstName}` : firstName;
  const dateLine = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TIMEZONE }).format(new Date());

  type Action = { title: string; text: string; icon: LucideIcon; href?: string; search?: boolean; primary?: boolean };
  const actions = ([
    me.can("queue.manage") && { title: "Check in a pet", text: "Walk-in or arrived — add to today's queue", icon: ListOrdered, href: "/queue", primary: true },
    !me.can("queue.manage") && me.can("clinical.view") && { title: "Today's queue", text: "See who's waiting and call the next patient", icon: ListOrdered, href: "/queue", primary: true },
    me.can("pos.use") && !me.can("queue.manage") && { title: "Pet store sale", text: "Scan products and take payment", icon: ShoppingBag, href: "/pos", primary: !me.can("clinical.view") },
    me.can("appointments.manage") && { title: "Book appointment", text: "Phone or WhatsApp booking", icon: CalendarPlus, href: "/appointments" },
    me.can("customers.create") && { title: "New pet owner", text: "Register an owner and their pet in one go", icon: UserPlus, href: "/customers/new" },
    (canCustomers || canPets) && { title: "Find a pet or owner", text: "Search by name, phone number or ID", icon: Search, search: true },
    me.can("pets.create") && { title: "Add a pet", text: "Add another pet to an existing owner", icon: PawPrint, href: "/pets/new" },
    me.can("staff.manage") && { title: "Add staff", text: "Give a doctor or receptionist a login", icon: UserCog, href: "/admin/staff/new" },
  ].filter(Boolean) as Action[]).slice(0, 4);

  type Stat = { label: string; value: number; sub: string; icon: LucideIcon; href: string; tone?: "danger" | "warning" | "success"; money?: boolean };
  const todayStats = ([
    canQueue && { label: "Waiting now", value: waiting?.count ?? 0, sub: `${inClinic?.count ?? 0} with doctor / in treatment`, icon: ListOrdered, href: "/queue", tone: (waiting?.count ?? 0) > 0 ? "warning" : undefined },
    canAppts && { label: "Appointments left today", value: appts?.count ?? 0, sub: "booked or confirmed", icon: CalendarDays, href: "/appointments" },
    canDue && { label: "Due today", value: dueToday?.count ?? 0, sub: "vaccines & follow-ups", icon: Syringe, href: "/due?view=today" },
    me.can("clinical.view") && { label: "In the ward", value: inWard?.count ?? 0, sub: `${theatre?.count ?? 0} surgery case(s) in progress`, icon: BedDouble, href: "/ward" },
    me.can("crm.manage") && (toSend?.count ?? 0) > 0 && { label: "Messages to send", value: toSend?.count ?? 0, sub: "reminders ready for WhatsApp", icon: MessageCircle, href: "/messages", tone: "warning" },
    (myTasks?.count ?? 0) > 0 && { label: "My tasks", value: myTasks?.count ?? 0, sub: myOverdueTasks ? `${myOverdueTasks} overdue` : "none overdue", icon: ListTodo, href: "/tasks", tone: myOverdueTasks ? "danger" : undefined },
    seeMoney && { label: "Collected today", value: Math.round(collected), sub: "payments − refunds (Rs.)", icon: Wallet, href: "/billing", money: true },
    me.can("billing.view") && { label: "Owed to the clinic", value: Math.round(owed), sub: overdueMoney ? `Rs. ${Math.round(overdueMoney).toLocaleString("en-PK")} overdue` : "none overdue", icon: CreditCard, href: "/billing/dues", tone: overdueMoney > 0 ? "danger" : undefined, money: true },
    me.can("inventory.view") && stockAlerts > 0 && { label: "Stock to check", value: stockAlerts, sub: "low or expired items", icon: Boxes, href: "/inventory", tone: "warning" },
    canDue && { label: "Overdue", value: overdue?.count ?? 0, sub: "need a call from reception", icon: CalendarClock, href: "/due?view=overdue", tone: (overdue?.count ?? 0) > 0 ? "danger" : "success" },
  ].filter(Boolean) as Stat[]);

  const stats = [
    canCustomers && { label: "Pet owners", value: customers?.count ?? 0, today: newCustomers?.count ?? 0, icon: Users, href: "/customers" },
    canPets && { label: "Active pets", value: pets?.count ?? 0, today: newPets?.count ?? 0, icon: PawPrint, href: "/pets" },
  ].filter(Boolean) as { label: string; value: number; today: number; icon: LucideIcon; href: string }[];

  return (
    <div className="grid grid-cols-1 gap-6">
      {denied && (
        <Alert>
          <ShieldAlert />
          <AlertDescription>You don&apos;t have access to that page. Ask the admin if you need it.</AlertDescription>
        </Alert>
      )}

      {/* Welcome banner */}
      <section className="relative overflow-hidden rounded-3xl bg-ink bg-hero-gradient px-6 py-8 text-white shadow-float shadow-brand/20 md:px-10 md:py-10">
        <LogoMark tone="white" className="pointer-events-none absolute -right-8 -bottom-12 w-60 opacity-[0.07]" />
        <div className="relative">
          <p className="text-sm font-medium text-white/60">{dateLine}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight md:text-4xl">{greeting()}, {displayName}</h1>
          <p className="mt-2 max-w-lg text-white/70">What would you like to do today?</p>
          {(canCustomers || canPets) && (
            <OpenSearch className="mt-6 flex h-13 w-full max-w-xl items-center gap-3 rounded-2xl bg-white px-5 text-left text-muted-foreground shadow-lg transition hover:ring-4 hover:ring-white/15">
              <Search className="size-5 text-brand" />
              <span className="flex-1 truncate">Search a pet, owner or phone number…</span>
              <kbd className="hidden rounded-md border px-1.5 py-0.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
            </OpenSearch>
          )}
        </div>
      </section>

      {todayStats.length > 0 && (
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {todayStats.map((s) => (
            <Link key={s.label} href={s.href} className="group rounded-2xl bg-card p-4 shadow-card ring-1 ring-border transition hover:ring-brand-muted">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><s.icon className="size-4" /> {s.label}</div>
              <p className={cn("mt-2 text-3xl font-bold tabular", s.tone === "danger" && "text-danger", s.tone === "warning" && "text-warning")}>{s.money ? `Rs. ${s.value.toLocaleString("en-PK")}` : s.value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{s.sub}</p>
            </Link>
          ))}
        </section>
      )}

      {/* Big, obvious actions */}
      {actions.length > 0 && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {actions.map((a) => {
            const body = (
              <>
                <span className={cn("flex size-12 items-center justify-center rounded-2xl",
                  a.primary ? "bg-brand-gradient text-white shadow-md shadow-brand/30" : "bg-brand-soft text-brand")}>
                  <a.icon className="size-6" />
                </span>
                <span className="mt-4 flex items-center gap-1 text-base font-semibold">
                  {a.title}
                  <ArrowRight className="size-4 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                </span>
                <span className="mt-1 text-sm text-muted-foreground">{a.text}</span>
              </>
            );
            const cls = "group flex flex-col items-start rounded-2xl bg-card p-5 text-left shadow-card ring-1 ring-border transition hover:-translate-y-0.5 hover:shadow-float hover:ring-brand-muted";
            return a.search
              ? <OpenSearch key={a.title} className={cls}>{body}</OpenSearch>
              : <Link key={a.title} href={a.href!} className={cls}>{body}</Link>;
          })}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Numbers */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          {stats.map((s) => (
            <Link key={s.label} href={s.href} className="group">
              <Card className="transition group-hover:ring-brand-muted">
                <CardContent className="flex items-center gap-4">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-muted">
                    <s.icon className="size-6 text-foreground/70" />
                  </span>
                  <div className="flex-1">
                    <p className="text-sm text-muted-foreground">{s.label}</p>
                    <p className="tabular text-3xl font-bold tracking-tight">{s.value.toLocaleString("en-PK")}</p>
                  </div>
                  <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold",
                    s.today ? "bg-success-soft text-success" : "bg-muted text-muted-foreground")}>
                    +{s.today} today
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* Recent */}
        {recent && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Recently registered</CardTitle>
              <CardAction>
                <Link href="/customers" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
                  See all <ArrowUpRight className="size-4" />
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent className="px-2">
              {recent.data?.length ? (
                <ul>
                  {recent.data.map((c) => {
                    const petNames = (c.pet_owners ?? []).flatMap((po) => {
                      const p = po.pets as unknown as { name: string } | null;
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
                              {formatPhone(c.phone)}{petNames.length ? ` · ${petNames.join(", ")}` : ""}
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
        )}
      </div>

      {me.can("dashboard.owner") && (
        <Card className="bg-surface shadow-none">
          <CardHeader><CardTitle>Coming next to the system</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Phase 6", "Owner reports & analytics"],
            ].map(([phase, text]) => (
              <div key={phase} className="rounded-xl bg-card p-3 ring-1 ring-border">
                <p className="text-xs font-bold tracking-wide text-brand uppercase">{phase}</p>
                <p className="mt-1">{text}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
