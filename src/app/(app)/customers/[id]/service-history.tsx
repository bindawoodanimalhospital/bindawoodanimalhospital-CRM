import Link from "next/link";
import { House, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/app/page-header";
import { createClient } from "@/lib/supabase/server";
import { DELIVERY_STATUS, type DeliveryStatus } from "@/lib/clinic";
import { formatDate, formatPKR } from "@/lib/format";
import type { CurrentStaff } from "@/lib/auth";

type Entry = { key: string; at: string; kind: "delivery" | "home_visit"; href: string; title: string; address: string | null; status?: DeliveryStatus; amount?: number };

/** Home deliveries and home visits for this customer, newest first (spec: "visible in the client history"). */
export async function ServiceHistory({ customerId, me }: { customerId: string; me: CurrentStaff }) {
  const canBills = me.can("billing.view") || me.can("pos.use");
  const canVisits = me.can("clinical.view") || me.can("queue.manage") || me.can("appointments.view");
  if (!canBills && !canVisits) return null;
  const supabase = await createClient();
  const [orders, visits] = await Promise.all([
    canBills ? supabase.from("invoices").select("id, number, total, issued_at, delivery_status, delivery_address")
      .eq("customer_id", customerId).eq("fulfilment", "home_delivery").neq("status", "void").not("issued_at", "is", null)
      .order("issued_at", { ascending: false }).limit(8) : null,
    canVisits ? supabase.from("visits").select("id, checked_in_at, service_address, token_no, pets(name), appointment_types:visit_type_id(name)")
      .eq("customer_id", customerId).eq("service_location", "home_visit").neq("status", "cancelled")
      .order("checked_in_at", { ascending: false }).limit(8) : null,
  ]);

  const entries: Entry[] = [
    ...(orders?.data ?? []).map((o): Entry => ({
      key: `o-${o.id}`, at: o.issued_at!, kind: "delivery", href: `/billing/${o.id}`, title: `Delivery ${o.number}`,
      address: o.delivery_address, status: o.delivery_status as DeliveryStatus, amount: Number(o.total),
    })),
    ...(visits?.data ?? []).map((v): Entry => {
      const type = (v.appointment_types as unknown as { name: string } | null)?.name;
      const pet = (v.pets as unknown as { name: string } | null)?.name;
      return { key: `v-${v.id}`, at: v.checked_in_at, kind: "home_visit", href: `/visits/${v.id}`,
        title: [type ?? "Home visit", pet].filter(Boolean).join(" · "), address: v.service_address };
    }),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);

  return (
    <Card>
      <CardHeader><CardTitle>Deliveries & home visits</CardTitle></CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No home deliveries or home visits yet.</p>
        ) : (
          <ul className="grid gap-2">
            {entries.map((e) => (
              <li key={e.key}>
                <Link href={e.href} className="flex items-start gap-3 rounded-xl bg-surface px-3 py-2.5 text-sm ring-1 ring-border hover:ring-brand-muted">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                    {e.kind === "delivery" ? <Truck className="size-4" /> : <House className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {e.title}
                      {e.status && <StatusPill tone={DELIVERY_STATUS[e.status].tone}>{DELIVERY_STATUS[e.status].label}</StatusPill>}
                      {e.kind === "home_visit" && <StatusPill tone="info">Home visit</StatusPill>}
                    </span>
                    {e.address && <span className="block truncate text-xs text-muted-foreground">{e.address}</span>}
                  </span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground">
                    {formatDate(e.at)}
                    {e.amount != null && <span className="block font-semibold text-foreground tabular">{formatPKR(e.amount)}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
