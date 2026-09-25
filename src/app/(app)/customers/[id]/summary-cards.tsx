import Link from "next/link";
import { CalendarDays, Receipt, Syringe } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPKR, formatTime, todayPK } from "@/lib/format";
import type { CurrentStaff } from "@/lib/auth";
import { cn } from "@/lib/utils";

/** Balance, next appointment and vaccines due — each only for roles allowed to see it. */
export async function CustomerSummaryCards({ customerId, petIds, me }: { customerId: string; petIds: string[]; me: CurrentStaff }) {
  const supabase = await createClient();
  const today = todayPK();
  const [bal, appt, due] = await Promise.all([
    me.can("billing.view") ? supabase.from("customer_balances").select("balance").eq("customer_id", customerId).maybeSingle() : null,
    me.can("appointments.view") ? supabase.from("appointments").select("starts_at, pets(name), appointment_types(name)").eq("customer_id", customerId)
      .in("status", ["booked", "confirmed"]).gte("starts_at", new Date().toISOString()).order("starts_at").limit(1).maybeSingle() : null,
    (me.can("clinical.view") || me.can("crm.view")) && petIds.length
      ? supabase.from("due_items").select("title, due_on, pets(name)").in("pet_id", petIds).eq("status", "pending").eq("kind", "vaccination").order("due_on").limit(3) : null,
  ]);
  const balance = Number(bal?.data?.balance ?? 0);
  const next = appt?.data as { starts_at: string; pets: { name: string } | null; appointment_types: { name: string } } | null | undefined;
  const dues = (due?.data ?? []) as unknown as { title: string; due_on: string; pets: { name: string } | null }[];

  return (
    <div className="grid gap-6 sm:grid-cols-3 lg:col-span-2">
      {bal && (
        <Link href={`/customers/${customerId}/account`}>
          <Card className={cn("h-full transition hover:ring-brand-muted", balance > 0 && "ring-danger/40")}>
            <CardContent>
              <Receipt className="mb-2 size-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Balance</p>
              <p className={cn("text-2xl font-bold tabular", balance > 0 ? "text-danger" : "text-success")}>{formatPKR(Math.abs(balance))}</p>
              <p className="text-xs text-muted-foreground">{balance > 0 ? "to pay · open account" : balance < 0 ? "advance held" : "all settled"}</p>
            </CardContent>
          </Card>
        </Link>
      )}
      {appt && (
        <Card className="h-full">
          <CardContent>
            <CalendarDays className="mb-2 size-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Next appointment</p>
            {next ? <><p className="font-semibold">{formatDate(next.starts_at)} · {formatTime(next.starts_at)}</p>
              <p className="text-xs text-muted-foreground">{[next.appointment_types.name, next.pets?.name].filter(Boolean).join(" · ")}</p></>
              : <p className="text-sm">None booked</p>}
          </CardContent>
        </Card>
      )}
      {due && (
        <Card className="h-full">
          <CardContent>
            <Syringe className="mb-2 size-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Vaccines due</p>
            {dues.length ? (
              <ul className="mt-1 grid gap-0.5 text-sm">
                {dues.map((d, i) => <li key={i} className={cn(d.due_on < today && "font-semibold text-danger")}>{d.pets?.name}: {d.title} · {formatDate(d.due_on)}</li>)}
              </ul>
            ) : <p className="text-sm">Nothing due</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
