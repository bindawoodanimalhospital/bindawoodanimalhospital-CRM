import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MapPin, Phone, Printer, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, StatusPill } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { paymentMethods } from "@/lib/billing";
import { DELIVERY_STATUS, type DeliveryStatus } from "@/lib/clinic";
import { formatDateTime, formatPKR, formatTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { DeliveryActions } from "./delivery-actions";
import { withContact } from "@/lib/contacts";

export const metadata: Metadata = { title: "Home deliveries" };
const PAGE = 30;
const VIEWS = [
  { key: "open", label: "To do" }, { key: "pending", label: "To dispatch" }, { key: "dispatched", label: "Out for delivery" },
  { key: "delivered", label: "Delivered" }, { key: "all", label: "All" },
] as const;

export default async function DeliveriesPage({ searchParams }: PageProps<"/pos/deliveries">) {
  const me = await requireStaff();
  const canWrite = me.can("pos.use") || me.can("billing.create");
  if (!canWrite && !me.can("billing.view")) redirect("/dashboard?denied=1");
  const sp = await searchParams;
  const view = VIEWS.some((v) => v.key === sp.view) ? (sp.view as string) : "open";
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();

  let q = supabase.from("invoices")
    .select(`id, number, total, balance, amount_paid, returned_amount, issued_at, delivery_status, delivery_address, delivery_rider, delivery_notes,
      dispatched_at, delivered_at, customers(id, full_name, customer_contacts(phone, whatsapp)), invoice_items(description, quantity, line_role, unit_price)`, { count: "exact" })
    .eq("fulfilment", "home_delivery").eq("status", "issued")
    .order("issued_at", { ascending: view === "open" || view === "pending" })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (view === "open") q = q.in("delivery_status", ["pending", "dispatched"]);
  else if (view !== "all") q = q.eq("delivery_status", view);

  const [{ data, count }, { data: counts }, methods] = await Promise.all([
    q,
    supabase.from("invoices").select("delivery_status").eq("fulfilment", "home_delivery").eq("status", "issued").in("delivery_status", ["pending", "dispatched"]),
    paymentMethods(),
  ]);
  const pending = (counts ?? []).filter((c) => c.delivery_status === "pending").length;
  const out = (counts ?? []).filter((c) => c.delivery_status === "dispatched").length;

  return (
    <>
      <PageHeader back={{ href: "/pos", label: "Pet store" }} title="Home deliveries"
        description="Orders going to customers' homes: dispatch them, mark them delivered, collect cash on delivery." />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl bg-card p-4 shadow-card ring-1 ring-border">
          <p className="text-sm text-muted-foreground">To dispatch</p><p className={cn("text-3xl font-bold tabular", pending > 0 && "text-warning")}>{pending}</p>
        </div>
        <div className="rounded-2xl bg-card p-4 shadow-card ring-1 ring-border">
          <p className="text-sm text-muted-foreground">Out for delivery</p><p className="text-3xl font-bold tabular">{out}</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Link key={v.key} href={`?view=${v.key}`} className={cn("inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold ring-1",
            view === v.key ? "bg-brand-gradient text-white ring-transparent" : "bg-card ring-border hover:ring-brand-muted")}>{v.label}</Link>
        ))}
      </div>

      {!data?.length ? (
        <EmptyState icon={Truck} title={view === "open" ? "Nothing to deliver right now" : "No deliveries here"}
          description="In the Pet store, choose “Home delivery” before taking payment to create a delivery order." />
      ) : (
        <ul className="grid gap-3">
          {data.map((o) => {
            const c = withContact(o.customers as unknown as { id: string; full_name: string } | null);
            const items = (o.invoice_items ?? []) as { description: string; quantity: number; line_role: string | null; unit_price: number }[];
            const fee = items.find((i) => i.line_role === "delivery_charge");
            const products = items.filter((i) => i.line_role !== "delivery_charge");
            const status = o.delivery_status as DeliveryStatus;
            const locked = status !== "pending" || Number(o.amount_paid) !== 0 || Number(o.returned_amount) !== 0;
            return (
              <li key={o.id} className="rounded-2xl bg-card p-4 shadow-card ring-1 ring-border">
                <div className="flex flex-wrap items-start gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand"><Truck className="size-5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/billing/${o.id}`} className="font-semibold hover:underline">{o.number}</Link>
                      <StatusPill tone={DELIVERY_STATUS[status].tone}>{DELIVERY_STATUS[status].label}</StatusPill>
                      {Number(o.balance) > 0
                        ? <StatusPill tone="danger">{status === "delivered" ? "Unpaid" : "Collect"} {formatPKR(o.balance)}</StatusPill>
                        : <StatusPill tone="success">Paid</StatusPill>}
                    </div>
                    {c && (
                      <p className="mt-1 text-sm">
                        <Link href={`/customers/${c.id}`} className="font-medium hover:underline">{c.full_name}</Link>
                        {c.phone && <a href={`tel:${c.phone}`} className="ml-2 inline-flex items-center gap-1 text-muted-foreground hover:text-brand"><Phone className="size-3.5" />{formatPhone(c.phone)}</a>}
                      </p>
                    )}
                    <p className="mt-1 flex items-start gap-1.5 text-sm"><MapPin className="mt-0.5 size-4 shrink-0 text-brand" />{o.delivery_address}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {products.map((i) => `${Number(i.quantity)} × ${i.description}`).join(" · ")}
                      {fee && ` · Delivery ${Number(fee.unit_price) === 0 ? "waived" : formatPKR(fee.unit_price)}`}
                    </p>
                    {o.delivery_notes && <p className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground">Note: {o.delivery_notes}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Ordered {formatDateTime(o.issued_at)}
                      {o.dispatched_at && ` · left ${formatTime(o.dispatched_at)}${o.delivery_rider ? ` with ${o.delivery_rider}` : ""}`}
                      {o.delivered_at && ` · delivered ${formatDateTime(o.delivered_at)}`}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="text-xl font-bold tabular">{formatPKR(o.total)}</span>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button asChild variant="ghost" size="sm"><Link href={`/print/invoice/${o.id}?receipt=1`} target="_blank"><Printer /> Receipt</Link></Button>
                      {canWrite && (
                        <DeliveryActions
                          order={{ id: o.id, number: o.number!, status, balance: Number(o.balance), address: o.delivery_address ?? "",
                            charge: Number(fee?.unit_price ?? 0), customerId: c?.id ?? null, rider: o.delivery_rider }}
                          chargeLocked={locked} canWaive={me.can("billing.discount")}
                          methods={methods.filter((m) => m.key !== "write_off")} />
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Pagination page={page} pageSize={PAGE} total={count ?? 0} params={{ view }} />
    </>
  );
}
