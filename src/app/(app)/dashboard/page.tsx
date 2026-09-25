import type { Metadata } from "next";
import Link from "next/link";
import { PawPrint, Plus, ShieldAlert, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, TIMEZONE } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export const metadata: Metadata = { title: "Dashboard" };

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

  const [customers, pets, newCustomers, newPets, recent] = await Promise.all([
    canCustomers ? supabase.from("customers").select("id", { count: "exact", head: true }).neq("status", "merged") : null,
    canPets ? supabase.from("pets").select("id", { count: "exact", head: true }).eq("status", "active") : null,
    canCustomers ? supabase.from("customers").select("id", { count: "exact", head: true }).gte("created_at", today) : null,
    canPets ? supabase.from("pets").select("id", { count: "exact", head: true }).gte("created_at", today) : null,
    canCustomers
      ? supabase.from("customers").select("id, code, full_name, phone, area, created_at, pet_owners(pets(name))")
          .neq("status", "merged").order("created_at", { ascending: false }).limit(8)
      : null,
  ]);

  const stats = [
    canCustomers && { label: "Customers", value: customers?.count ?? 0, sub: `+${newCustomers?.count ?? 0} today`, icon: Users, href: "/customers" },
    canPets && { label: "Active patients", value: pets?.count ?? 0, sub: `+${newPets?.count ?? 0} today`, icon: PawPrint, href: "/pets" },
  ].filter(Boolean) as { label: string; value: number; sub: string; icon: typeof Users; href: string }[];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${me.fullName.split(" ")[0]}`}
        description={new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TIMEZONE }).format(new Date())}
        actions={
          <>
            {me.can("customers.create") && (
              <Button asChild><Link href="/customers/new"><UserPlus /> New customer</Link></Button>
            )}
            {me.can("pets.create") && (
              <Button asChild variant="outline"><Link href="/pets/new"><Plus /> Register pet</Link></Button>
            )}
          </>
        }
      />

      {denied && (
        <Alert className="mb-6">
          <ShieldAlert />
          <AlertDescription>You don&apos;t have access to that page. Ask the admin if you need it.</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="transition-colors hover:border-foreground/20">
              <CardContent className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{s.label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value.toLocaleString("en-PK")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{s.sub}</p>
                </div>
                <s.icon className="size-5 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {recent && (
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Recently registered</CardTitle></CardHeader>
            <CardContent className="px-0">
              {recent.data?.length ? (
                <ul className="divide-y">
                  {recent.data.map((c) => {
                    const petNames = (c.pet_owners ?? []).flatMap((po) => {
                      const p = po.pets as unknown as { name: string } | null;
                      return p ? [p.name] : [];
                    });
                    return (
                      <li key={c.id}>
                        <Link href={`/customers/${c.id}`} className="flex items-center gap-3 px-6 py-2.5 hover:bg-muted/50">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{c.full_name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {formatPhone(c.phone)}{c.area ? ` · ${c.area}` : ""}{petNames.length ? ` · ${petNames.join(", ")}` : ""}
                            </p>
                          </div>
                          <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(c.created_at)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="px-6 text-sm text-muted-foreground">No customers yet. Register the first one to get started.</p>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Coming next</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {[
              ["Phase 2", "Appointments, walk-in queue, consultations, vaccinations & prescriptions"],
              ["Phase 3", "Surgery workflow, admissions, discharge"],
              ["Phase 4", "Billing, dues & ledger, POS, inventory, suppliers"],
              ["Phase 5", "WhatsApp reminders, tasks, escalation engine"],
              ["Phase 6", "Owner analytics & reports"],
            ].map(([phase, text]) => (
              <div key={phase} className="flex gap-3">
                <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{phase}</span>
                <span>{text}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
