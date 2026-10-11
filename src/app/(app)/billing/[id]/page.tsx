import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, StatusPill } from "@/components/app/page-header";
import { NoticeToast } from "@/components/app/notice-toast";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { customerCredit, paymentMethods } from "@/lib/billing";
import { formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { visitSuggestions } from "../suggestions";
import { InvoiceEditor, type Line } from "./editor";
import { IssuedPanel, type IssuedLine, type PaymentRow } from "./issued";

export const metadata: Metadata = { title: "Bill" };

export default async function InvoicePage({ params }: PageProps<"/billing/[id]">) {
  const me = await requireStaff();
  if (!me.can("billing.view") && !me.can("pos.use")) redirect("/dashboard?denied=1");
  const { id } = await params;
  const supabase = await createClient();
  const { data: inv } = await supabase.from("invoices")
    .select(`*, customers(id, full_name, phone), pets(id, name), visits(id, token_no, visit_date),
      invoice_items(id, item_id, description, kind, quantity, unit_price, discount_amount, line_total, returned_qty, sort_order, catalog_items(price_is_editable, track_stock)),
      dues(status, promised_date, approval_status)`)
    .eq("id", id).maybeSingle();
  if (!inv) notFound();

  const customer = inv.customers as unknown as { id: string; full_name: string; phone: string } | null;
  const pet = inv.pets as unknown as { id: string; name: string } | null;
  const visit = inv.visits as unknown as { id: string; token_no: number } | null;
  const items = ((inv.invoice_items ?? []) as (Line & { sort_order: number; returned_qty: number; catalog_items: { price_is_editable: boolean; track_stock: boolean } })[])
    .sort((a, b) => a.sort_order - b.sort_order);
  const [methods, credit] = await Promise.all([paymentMethods(), customer ? customerCredit(customer.id) : Promise.resolve(0)]);
  const methodsNoWriteOff = methods.filter((m) => m.key !== "write_off");

  const title = inv.status === "draft" ? "New bill" : `Bill ${inv.number}`;
  const header = (
    <PageHeader
      back={{ href: "/billing", label: "Billing" }}
      title={<span className="flex flex-wrap items-center gap-3">{title}
        <StatusPill tone={inv.status === "draft" ? "warning" : inv.status === "void" ? "neutral" : inv.balance > 0 ? "danger" : "success"}>
          {inv.status === "draft" ? "Draft" : inv.status === "void" ? "Void" : inv.balance > 0 ? "Unpaid balance" : "Paid"}
        </StatusPill>
        {inv.kind === "store" && <StatusPill tone="info">Pet store</StatusPill>}</span>}
      description={[customer ? `${customer.full_name} · ${formatPhone(customer.phone)}` : "Walk-in customer", pet?.name,
        inv.issued_at ? `issued ${formatDateTime(inv.issued_at)}` : null].filter(Boolean).join(" · ")}
      actions={
        <>
          {customer && <Button asChild variant="outline"><Link href={`/customers/${customer.id}`}>Customer account</Link></Button>}
          {visit && <Button asChild variant="ghost"><Link href={`/visits/${visit.id}`}><Stethoscope /> Visit #{visit.token_no}</Link></Button>}
        </>
      }
    />
  );

  if (inv.status === "draft") {
    if (!me.can("billing.create") && !(inv.kind === "store" && me.can("pos.use"))) redirect("/billing?denied=1");
    const { suggestions, unmatched } = inv.visit_id ? await visitSuggestions(inv.visit_id) : { suggestions: [], unmatched: [] };
    const lines: Line[] = items.map((i) => ({ ...i, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount_amount: Number(i.discount_amount),
      line_total: Number(i.line_total), price_is_editable: i.catalog_items.price_is_editable, track_stock: i.catalog_items.track_stock }));
    return (
      <>
        <Suspense><NoticeToast /></Suspense>
        {header}
        <InvoiceEditor invoiceId={inv.id} lines={lines} suggestions={suggestions} unmatched={unmatched} methods={methodsNoWriteOff}
          totals={{ subtotal: Number(inv.subtotal), line_discounts: Number(inv.line_discounts), invoice_discount: Number(inv.invoice_discount),
            tax_total: Number(inv.tax_total), total: Number(inv.total), discount_reason: inv.discount_reason }}
          perms={{ discount: me.can("billing.discount") }} customerCredit={credit} customerName={customer?.full_name ?? "walk-in customer"} />
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
      <IssuedPanel
        inv={{ id: inv.id, number: inv.number!, status: inv.status, customer_id: customer?.id ?? null, total: Number(inv.total),
          amount_paid: Number(inv.amount_paid), returned_amount: Number(inv.returned_amount), balance: Number(inv.balance),
          void_reason: inv.void_reason, due: dueRow }}
        lines={items.map((i): IssuedLine => ({ id: i.id, description: i.description, quantity: Number(i.quantity), unit_price: Number(i.unit_price),
          discount_amount: Number(i.discount_amount), line_total: Number(i.line_total), returned_qty: Number(i.returned_qty) }))}
        payments={payments} methods={methodsNoWriteOff} credit={credit}
        perms={{ create: me.can("billing.create"), refund: me.can("billing.refund"), void: me.can("billing.void"),
          ret: me.can("billing.refund") || me.can("pos.return") }}
      />
    </>
  );
}
