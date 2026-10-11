import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LogoMark } from "@/components/brand/logo";
import { InfoGrid, PrintShell, type ClinicProfile } from "@/components/print/print-shell";
import { PrintButton } from "@/components/print/print-button";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSetting } from "@/lib/queries";
import { formatDateTime, formatPKR } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export const metadata: Metadata = { title: "Bill" };

type Item = { description: string; quantity: number; unit_price: number; discount_amount: number; line_total: number; returned_qty: number; sort_order: number };

export default async function InvoicePrint({ params, searchParams }: PageProps<"/print/invoice/[id]">) {
  const me = await requireStaff();
  if (!me.can("billing.view") && !me.can("pos.use")) notFound();
  const { id } = await params;
  const { receipt } = await searchParams;
  const supabase = await createClient();
  const [{ data: inv }, clinic, cfg, { data: allocs }] = await Promise.all([
    supabase.from("invoices").select(`number, kind, status, subtotal, line_discounts, invoice_discount, discount_reason, tax_total, total, amount_paid,
      returned_amount, balance, issued_at, void_reason, notes, customers(full_name, phone, area), pets(name, code),
      invoice_items(description, quantity, unit_price, discount_amount, line_total, returned_qty, sort_order), dues(promised_date, status)`).eq("id", id).maybeSingle(),
    getSetting<ClinicProfile>("clinic.profile"),
    getSetting<{ invoice_footer?: string }>("billing.config"),
    supabase.from("payment_allocations").select("amount, payments(kind, method, received_at, reference)").eq("invoice_id", id).order("id"),
  ]);
  if (!inv || inv.status === "draft") notFound();
  const items = ((inv.invoice_items ?? []) as Item[]).sort((a, b) => a.sort_order - b.sort_order);
  const customer = inv.customers as unknown as { full_name: string; phone: string; area: string | null } | null;
  const pet = inv.pets as unknown as { name: string; code: string } | null;
  const due = (Array.isArray(inv.dues) ? inv.dues[0] : inv.dues) as { promised_date: string; status: string } | null;
  const pays = (allocs ?? []).map((a) => ({ amount: Number(a.amount), ...(a.payments as unknown as { kind: string; method: string; received_at: string; reference: string | null }) }));

  const totals = (
    <dl className="grid gap-1">
      <Row l="Subtotal" v={formatPKR(inv.subtotal)} />
      {Number(inv.line_discounts) + Number(inv.invoice_discount) > 0 && <Row l="Discount" v={`− ${formatPKR(Number(inv.line_discounts) + Number(inv.invoice_discount))}`} />}
      {Number(inv.tax_total) > 0 && <Row l="Tax" v={formatPKR(inv.tax_total)} />}
      <Row l="Total" v={formatPKR(inv.total)} strong />
      {Number(inv.returned_amount) > 0 && <Row l="Returned" v={`− ${formatPKR(inv.returned_amount)}`} />}
      <Row l="Paid" v={formatPKR(inv.amount_paid)} />
      <Row l={Number(inv.balance) > 0 ? "Balance to pay" : "Balance"} v={formatPKR(inv.balance)} strong />
    </dl>
  );

  // 80 mm thermal receipt for the pet store counter
  if (receipt) {
    return (
      <div className="min-h-svh bg-muted py-6 print:bg-white print:py-0">
        <div className="no-print mx-auto mb-3 flex w-[80mm] justify-end"><PrintButton /></div>
        <article className="mx-auto w-[80mm] bg-white p-3 font-mono text-[11px] leading-snug text-ink print:p-1">
          <div className="text-center">
            <LogoMark tone="ink" className="mx-auto w-10" />
            <p className="mt-1 font-sans text-sm font-bold">{(clinic?.name || "Bin Dawood Animal Hospital").toUpperCase()}</p>
            {clinic?.phone && <p>{formatPhone(clinic.phone)}</p>}
            <p className="mt-1">{inv.number} · {formatDateTime(inv.issued_at)}</p>
            {customer && <p>{customer.full_name}</p>}
          </div>
          <hr className="my-2 border-dashed border-ink" />
          {items.map((i, n) => (
            <div key={n} className="mb-1">
              <p>{i.description}</p>
              <p className="flex justify-between"><span>{Number(i.quantity)} × {Number(i.unit_price).toLocaleString("en-PK")}{Number(i.discount_amount) ? ` − ${Number(i.discount_amount)}` : ""}</span><span>{Number(i.line_total).toLocaleString("en-PK")}</span></p>
            </div>
          ))}
          <hr className="my-2 border-dashed border-ink" />
          {totals}
          {pays.map((p, n) => <p key={n} className="flex justify-between"><span>{p.kind === "refund" ? "Refund" : p.method}</span><span>{p.amount.toLocaleString("en-PK")}</span></p>)}
          <p className="mt-3 text-center">{cfg?.invoice_footer ?? "Thank you!"}</p>
        </article>
      </div>
    );
  }

  return (
    <PrintShell clinic={clinic ?? {}} title={inv.status === "void" ? "Bill — VOID" : inv.kind === "store" ? "Sales receipt" : "Bill"} footer={cfg?.invoice_footer}>
      {inv.status === "void" && <p className="mb-4 rounded-lg border-2 border-danger p-2 text-center font-bold text-danger uppercase">Void — {inv.void_reason}</p>}
      <div className="flex justify-between text-xs text-muted-foreground"><span>No. {inv.number}</span><span>{formatDateTime(inv.issued_at)}</span></div>
      <div className="mt-2">
        <InfoGrid rows={[
          ["Customer", customer ? `${customer.full_name} · ${formatPhone(customer.phone)}` : "Walk-in"],
          ["Pet", pet ? `${pet.name} (${pet.code})` : null],
        ]} />
      </div>
      <table className="mt-5 w-full border-collapse">
        <thead><tr className="border-b-2 border-ink text-left text-xs uppercase"><th className="py-1.5">Item</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Discount</th><th className="text-right">Amount</th></tr></thead>
        <tbody>
          {items.map((i, n) => (
            <tr key={n} className="border-b">
              <td className="py-1.5">{i.description}{Number(i.returned_qty) > 0 && <span className="text-xs text-muted-foreground"> ({Number(i.returned_qty)} returned)</span>}</td>
              <td className="text-right">{Number(i.quantity)}</td>
              <td className="text-right">{formatPKR(i.unit_price)}</td>
              <td className="text-right">{Number(i.discount_amount) ? formatPKR(i.discount_amount) : ""}</td>
              <td className="text-right font-semibold">{formatPKR(i.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 ml-auto w-72">{totals}</div>
      {pays.length > 0 && (
        <div className="mt-4 text-xs">
          <p className="font-semibold text-muted-foreground uppercase">Payments</p>
          {pays.map((p, n) => <p key={n}>{formatDateTime(p.received_at)} · {p.kind === "refund" ? "Refund" : p.kind === "write_off" ? "Written off" : p.method}{p.reference ? ` (${p.reference})` : ""} · {formatPKR(Math.abs(p.amount))}</p>)}
        </div>
      )}
      {due && due.status === "open" && Number(inv.balance) > 0 && (
        <p className="mt-4 rounded-lg border-2 border-brand p-2 text-sm"><b>Balance {formatPKR(inv.balance)}</b> — promised by {due.promised_date}.</p>
      )}
      {inv.notes && <p className="mt-4 text-sm">{inv.notes}</p>}
    </PrintShell>
  );
}

function Row({ l, v, strong }: { l: string; v: string; strong?: boolean }) {
  return <div className={`flex justify-between ${strong ? "border-t pt-1 text-[14px] font-bold" : ""}`}><dt>{l}</dt><dd className="tabular">{v}</dd></div>;
}
