import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Building2, Phone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, PageHeader, StatusPill } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, todayPK } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LOAN_STATUS, qtyText } from "../labels";
import { CancelLoanDialog, PARTNER_KIND, ReturnDialog } from "../widgets";

export const metadata: Metadata = { title: "Stock loan" };

type Line = { id: string; qty: number; returned_qty: number; unit: string; batch_no: string; expiry_date: string | null; notes: string | null;
  sort_order: number; item_id: string; catalog_items: { name: string } | null; inventory_locations: { name: string } | null };
type Ret = { id: string; returned_on: string; notes: string | null; created_by: string | null; created_at: string;
  stock_loan_return_lines: { qty: number; batch_no: string | null; expiry_date: string | null; loan_line_id: string }[] };

export default async function StockLoanPage({ params }: PageProps<"/inventory/loans/[id]">) {
  const me = await requireStaff();
  if (!me.can("inventory.view")) redirect("/dashboard?denied=1");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: loan }, { data: staff }] = await Promise.all([
    supabase.from("stock_loans").select(`*, partner_businesses(id, name, kind, contact_name, phone, address),
      stock_loan_lines(id, qty, returned_qty, unit, batch_no, expiry_date, notes, sort_order, item_id, catalog_items(name), inventory_locations(name)),
      stock_loan_returns(id, returned_on, notes, created_by, created_at, stock_loan_return_lines(qty, batch_no, expiry_date, loan_line_id))`)
      .eq("id", id).maybeSingle(),
    supabase.from("staff").select("id, full_name"),
  ]);
  if (!loan) notFound();
  const names = new Map((staff ?? []).map((s) => [s.id, s.full_name]));
  const partner = loan.partner_businesses as unknown as { id: string; name: string; kind: string; contact_name: string | null; phone: string | null; address: string | null };
  const lines = ((loan.stock_loan_lines ?? []) as unknown as Line[]).sort((a, b) => a.sort_order - b.sort_order);
  const returns = ((loan.stock_loan_returns ?? []) as unknown as Ret[]).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const lineName = new Map(lines.map((l) => [l.id, `${l.catalog_items?.name ?? "Item"}`]));
  const borrowed = loan.direction === "borrowed";
  const isOpen = ["pending_return", "partially_returned"].includes(loan.status);
  const overdue = isOpen && !!loan.expected_return_date && loan.expected_return_date < todayPK();
  const st = LOAN_STATUS[loan.status];
  const canManage = me.can("inventory.manage");

  return (
    <>
      <PageHeader back={{ href: "/inventory/loans", label: "Stock borrowed & lent" }}
        title={<span className="flex flex-wrap items-center gap-3">{loan.code}
          <StatusPill tone={borrowed ? "warning" : "info"}>{borrowed ? "Borrowed — we owe back" : "Lent — owed to us"}</StatusPill>
          <StatusPill tone={st.tone}>{st.label}</StatusPill>
          {overdue && <StatusPill tone="danger">Overdue</StatusPill>}</span>}
        description={`${borrowed ? "Borrowed from" : "Lent to"} ${partner.name} on ${formatDate(loan.loan_date)} · recorded by ${names.get(loan.created_by) ?? "—"}`}
        actions={canManage && isOpen && (
          <>
            {returns.length === 0 && <CancelLoanDialog loanId={loan.id} code={loan.code} />}
            <ReturnDialog loanId={loan.id} direction={loan.direction} partnerName={partner.name} loanDate={loan.loan_date}
              lines={lines.map((l) => ({ id: l.id, item_name: l.catalog_items?.name ?? "Item", unit: l.unit, qty: Number(l.qty), returned_qty: Number(l.returned_qty) }))} />
          </>
        )} />

      {loan.status === "cancelled" && (
        <p className="mb-6 rounded-xl bg-muted px-4 py-3 text-sm">Cancelled {formatDateTime(loan.cancelled_at)} by {names.get(loan.cancelled_by) ?? "—"}: {loan.cancel_reason}. Its stock movement was reversed.</p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Products</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground">
                <th className="py-1">Product</th><th className="text-right">{borrowed ? "Borrowed" : "Lent"}</th><th className="text-right">Returned</th><th className="text-right">Outstanding</th>
              </tr></thead>
              <tbody>
                {lines.map((l) => {
                  const left = Number(l.qty) - Number(l.returned_qty);
                  return (
                    <tr key={l.id} className="border-t">
                      <td className="py-2">
                        <Link href={`/inventory/${l.item_id}`} className="font-medium hover:underline">{l.catalog_items?.name}</Link>
                        {borrowed && (l.batch_no || l.expiry_date || l.inventory_locations) && (
                          <span className="block text-xs text-muted-foreground">
                            {[l.batch_no && `Batch ${l.batch_no}`, l.expiry_date && `exp. ${formatDate(l.expiry_date)}`, l.inventory_locations?.name && `in ${l.inventory_locations.name}`].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </td>
                      <td className="text-right tabular">{qtyText(l.qty)} {l.unit}</td>
                      <td className="text-right tabular text-success">{qtyText(l.returned_qty)}</td>
                      <td className={cn("text-right font-semibold tabular", left > 0 && (overdue ? "text-danger" : "text-warning"))}>{qtyText(left)} {l.unit}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="size-4 text-brand" />{partner.name}</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Type">{PARTNER_KIND[partner.kind]}</Field>
              <Field label="Contact">{partner.contact_name}</Field>
              <Field label="Phone">{partner.phone && <a href={`tel:${partner.phone}`} className="inline-flex items-center gap-1 hover:text-brand"><Phone className="size-3.5" />{partner.phone}</a>}</Field>
              <Field label="Expected back">{loan.expected_return_date ? formatDate(loan.expected_return_date) : null}</Field>
              <Field label="Address" className="col-span-2">{partner.address}</Field>
              <Field label="Reference" className="col-span-2">{loan.reference}</Field>
            </dl>
            {loan.notes && <p className="mt-4 rounded-lg bg-muted/60 p-3 text-sm whitespace-pre-wrap">{loan.notes}</p>}
            <p className="mt-4 text-xs text-muted-foreground">Not a purchase or sale — no bill or payment is linked. Any agreed payment goes through Suppliers or Billing as usual.</p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader><CardTitle>Return history</CardTitle></CardHeader>
          <CardContent>
            {returns.length === 0 ? <p className="text-sm text-muted-foreground">Nothing returned yet.</p> : (
              <ul className="grid gap-2">
                {returns.map((r) => (
                  <li key={r.id} className="rounded-xl bg-surface px-3 py-2.5 text-sm ring-1 ring-border">
                    <p className="flex flex-wrap items-center gap-x-3 font-medium">
                      {formatDate(r.returned_on)}
                      <span className="font-normal text-muted-foreground">recorded by {names.get(r.created_by ?? "") ?? "—"} · {formatDateTime(r.created_at)}</span>
                    </p>
                    <p className="mt-0.5">{r.stock_loan_return_lines.map((rl) => `${qtyText(rl.qty)} × ${lineName.get(rl.loan_line_id)}${rl.batch_no ? ` (batch ${rl.batch_no})` : ""}`).join(" · ")}</p>
                    {r.notes && <p className="text-xs text-muted-foreground">{r.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
