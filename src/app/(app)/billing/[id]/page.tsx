import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { History, MapPin, Stethoscope, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, StatusPill } from "@/components/app/page-header";
import { NoticeToast } from "@/components/app/notice-toast";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { customerCredit, paymentMethods, previousBalance } from "@/lib/billing";
import { formatDate, formatDateTime, formatPKR } from "@/lib/format";
import { DELIVERY_STATUS, addressLine, type AddressParts, type DeliveryStatus, type ServiceLocation } from "@/lib/clinic";
import { ServiceLocationControl } from "@/components/app/service-location";
import { setInvoiceServiceLocation } from "../actions";
import { DeliveryActions } from "../../pos/deliveries/delivery-actions";
import { formatPhone } from "@/lib/phone";
import { visitSuggestions } from "../suggestions";
import { InvoiceEditor, type Line } from "./editor";
import { IssuedPanel, type IssuedLine, type PaymentRow } from "./issued";
import { withContact } from "@/lib/contacts";

export const metadata: Metadata = { title: "Bill" };

export default async function InvoicePage({ params }: PageProps<"/billing/[id]">) {
  const me = await requireStaff();
  if (!me.can("billing.view") && !me.can("pos.use")) redirect("/dashboard?denied=1");
  const { id } = await params;
  const supabase = await createClient();
  const { data: inv } = await supabase.from("invoices")
    .select(`*, customers(id, full_name, customer_contacts(phone, whatsapp), house_no, block, address, area, city), pets(id, name), visits(id, token_no, visit_date),
      invoice_items(id, item_id, description, kind, quantity, unit_price, discount_amount, line_total, returned_qty, sort_order, line_role, catalog_items(price_is_editable, track_stock)),
      dues(status, promised_date, approval_status)`)
    .eq("id", id).maybeSingle();
  if (!inv) notFound();

  const customer = withContact(inv.customers as unknown as ({ id: string; full_name: string } & AddressParts) | null);
  const pet = inv.pets as unknown as { id: string; name: string } | null;
  const visit = inv.visits as unknown as { id: string; token_no: number } | null;
  const items = ((inv.invoice_items ?? []) as (Line & { sort_order: number; returned_qty: number; catalog_items: { price_is_editable: boolean; track_stock: boolean } })[])
    .sort((a, b) => a.sort_order - b.sort_order);
  const [methods, credit, prevBal] = await Promise.all([paymentMethods(), customer ? customerCredit(customer.id) : Promise.resolve(0),
    customer && inv.status !== "void" ? previousBalance(customer.id, inv.id, inv.issued_at) : Promise.resolve(null)]);
  const methodsNoWriteOff = methods.filter((m) => m.key !== "write_off");

  const title = inv.status === "draft" ? "New bill" : `Bill ${inv.number}`;
  const header = (
    <PageHeader
      back={{ href: "/billing", label: "Billing" }}
      title={<span className="flex flex-wrap items-center gap-3">{title}
        <StatusPill tone={inv.status === "draft" ? "warning" : inv.status === "void" ? "neutral" : inv.balance > 0 ? "danger" : "success"}>
          {inv.status === "draft" ? "Draft" : inv.status === "void" ? "Void" : inv.balance > 0 ? "Unpaid balance" : "Paid"}
        </StatusPill>
        {inv.kind === "store" && <StatusPill tone="info">Pet store</StatusPill>}
        {inv.is_previous_balance && <StatusPill tone="warning">Previous balance (before CRM)</StatusPill>}
        {inv.fulfilment === "home_delivery" && <StatusPill tone="brand"><Truck className="mr-1 size-3" />Home delivery</StatusPill>}</span>}
      description={[customer ? [customer.full_name, formatPhone(customer.phone)].filter(Boolean).join(" · ") : inv.walk_in_name ? `${inv.walk_in_name} (walk-in)` : "Walk-in customer", pet?.name,
        inv.issued_at ? `issued ${formatDateTime(inv.issued_at)}` : null].filter(Boolean).join(" · ")}
      actions={
        <>
          {customer && <Button asChild variant="outline"><Link href={`/customers/${customer.id}`}>Customer account</Link></Button>}
          {visit && <Button asChild variant="ghost"><Link href={`/visits/${visit.id}`}><Stethoscope /> Visit #{visit.token_no}</Link></Button>}
        </>
      }
    />
  );

  // What the owner still owes from earlier bills (incl. balances from before the CRM).
  const prevCard = prevBal && prevBal.amount > 0 ? (
    <div className="-mt-2 mb-6 flex flex-wrap items-center gap-3 rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning ring-1 ring-warning/30">
      <History className="size-5 shrink-0" />
      <span className="min-w-0 flex-1">
        <b>Previous balance {formatPKR(prevBal.amount)}</b> — unpaid since {formatDate(prevBal.since)} ({prevBal.count} earlier bill{prevBal.count === 1 ? "" : "s"}).
        {" "}Total due now: <b>{formatPKR(prevBal.amount + Number(inv.status === "draft" ? inv.total : inv.balance))}</b>.
      </span>
      {customer && <Link href={`/customers/${customer.id}/account`} className="font-semibold underline-offset-2 hover:underline">Account</Link>}
    </div>
  ) : null;

  // Where the service was given (clinic bills): editable on drafts, shown on issued bills.
  const serviceLocation = inv.kind === "clinic" ? (
    <div className="-mt-4 mb-6">
      <ServiceLocationControl location={inv.service_location as ServiceLocation} address={inv.service_address}
        savedAddress={addressLine(customer)} label="Where was the service given?"
        canEdit={inv.status === "draft" && me.can("billing.create")} onSave={setInvoiceServiceLocation.bind(null, inv.id)} />
    </div>
  ) : null;

  const deliveryLine = items.find((i) => (i as { line_role?: string | null }).line_role === "delivery_charge");
  const deliveryCard = inv.fulfilment === "home_delivery" && inv.status === "issued" ? (
    <div className="mb-6 flex flex-wrap items-start gap-3 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand"><Truck className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold">Home delivery
          <StatusPill tone={DELIVERY_STATUS[inv.delivery_status as DeliveryStatus].tone}>{DELIVERY_STATUS[inv.delivery_status as DeliveryStatus].label}</StatusPill>
          <span className="text-sm font-normal text-muted-foreground">Delivery charge {Number(deliveryLine?.unit_price ?? 0) === 0 ? "waived" : formatPKR(deliveryLine?.unit_price ?? 0)}</span>
        </p>
        <p className="mt-1 flex items-start gap-1.5 text-sm"><MapPin className="mt-0.5 size-4 shrink-0 text-brand" />{inv.delivery_address}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {inv.dispatched_at ? `Left ${formatDateTime(inv.dispatched_at)}${inv.delivery_rider ? ` with ${inv.delivery_rider}` : ""}` : "Not dispatched yet"}
          {inv.delivered_at && ` · delivered ${formatDateTime(inv.delivered_at)}`}
        </p>
        {inv.delivery_notes && <p className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground">Note: {inv.delivery_notes}</p>}
      </div>
      {(me.can("pos.use") || me.can("billing.create")) && inv.delivery_status !== "delivered" && (
        <div className="flex flex-wrap gap-2">
          <DeliveryActions order={{ id: inv.id, number: inv.number!, status: inv.delivery_status as DeliveryStatus, balance: Number(inv.balance),
            address: inv.delivery_address ?? "", charge: Number(deliveryLine?.unit_price ?? 0), customerId: customer?.id ?? null, rider: inv.delivery_rider }}
            chargeLocked={inv.delivery_status !== "pending" || Number(inv.amount_paid) !== 0 || Number(inv.returned_amount) !== 0}
            canWaive={me.can("billing.discount")} methods={methodsNoWriteOff} />
        </div>
      )}
    </div>
  ) : null;

  if (inv.status === "draft") {
    if (!me.can("billing.create") && !(inv.kind === "store" && me.can("pos.use"))) redirect("/billing?denied=1");
    const { suggestions, unmatched } = inv.visit_id ? await visitSuggestions(inv.visit_id) : { suggestions: [], unmatched: [] };
    const lines: Line[] = items.map((i) => ({ ...i, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount_amount: Number(i.discount_amount),
      line_total: Number(i.line_total), price_is_editable: i.catalog_items.price_is_editable, track_stock: i.catalog_items.track_stock }));
    return (
      <>
        <Suspense><NoticeToast /></Suspense>
        {header}
        {prevCard}
        {serviceLocation}
        <InvoiceEditor invoiceId={inv.id} lines={lines} suggestions={suggestions} unmatched={unmatched} methods={methodsNoWriteOff}
          totals={{ subtotal: Number(inv.subtotal), line_discounts: Number(inv.line_discounts), invoice_discount: Number(inv.invoice_discount),
            tax_total: Number(inv.tax_total), total: Number(inv.total), discount_reason: inv.discount_reason }}
          perms={{ discount: me.can("billing.discount") }} customerCredit={credit} customerName={customer?.full_name ?? inv.walk_in_name ?? "walk-in customer"} />
      </>
    );
  }

  const [{ data: allocs }, { data: staff }] = await Promise.all([
    supabase.from("payment_allocations").select("amount, payments(id, code, kind, method, received_at, reference, received_by)").eq("invoice_id", id).order("id"),
    supabase.from("staff").select("id, full_name"),
  ]);
  const names = new Map((staff ?? []).map((s) => [s.id, s.full_name]));
  const payments: PaymentRow[] = (allocs ?? []).map((a) => {
    const p = a.payments as unknown as { id: string; code: string; kind: string; method: string; received_at: string; reference: string | null; received_by: string | null };
    return { ...p, amount: Number(a.amount), allocated: Number(a.amount), by: p.received_by ? names.get(p.received_by) ?? null : null };
  });
  const due = (inv.dues as unknown as { status: string; promised_date: string; approval_status: string }[] | { status: string; promised_date: string; approval_status: string } | null);
  const dueRow = Array.isArray(due) ? due[0] ?? null : due;

  return (
    <>
      <Suspense><NoticeToast /></Suspense>
      {header}
      {prevCard}
      {serviceLocation}
      {deliveryCard}
      <IssuedPanel
        inv={{ id: inv.id, number: inv.number!, status: inv.status, customer_id: customer?.id ?? null, total: Number(inv.total),
          amount_paid: Number(inv.amount_paid), returned_amount: Number(inv.returned_amount), balance: Number(inv.balance),
          void_reason: inv.void_reason, due: dueRow, store: inv.kind === "store" }}
        lines={items.map((i): IssuedLine => ({ id: i.id, description: i.description, quantity: Number(i.quantity), unit_price: Number(i.unit_price),
          discount_amount: Number(i.discount_amount), line_total: Number(i.line_total), returned_qty: Number(i.returned_qty) }))}
        payments={payments} methods={methodsNoWriteOff} credit={credit}
        perms={{ create: me.can("billing.create"), refund: me.can("billing.refund"), void: me.can("billing.void"),
          ret: me.can("billing.refund") || me.can("pos.return"), cancel: me.can("pos.use") || me.can("billing.void") }}
      />
    </>
  );
}
