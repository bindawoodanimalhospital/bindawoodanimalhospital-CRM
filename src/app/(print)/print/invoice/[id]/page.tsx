import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Heart, PawPrint } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { InfoGrid, PrintShell, type ClinicProfile } from "@/components/print/print-shell";
import { PrintButton } from "@/components/print/print-button";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSetting } from "@/lib/queries";
import { formatDate, formatDateTime, formatPKR } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { withContact } from "@/lib/contacts";
import { previousBalance } from "@/lib/billing";

export const metadata: Metadata = { title: "Bill" };

type Item = { description: string; quantity: number; unit_price: number; discount_amount: number; line_total: number; returned_qty: number; sort_order: number; line_role: string | null };

export default async function InvoicePrint({ params, searchParams }: PageProps<"/print/invoice/[id]">) {
  const me = await requireStaff();
  if (!me.can("billing.view") && !me.can("pos.use")) notFound();
  const { id } = await params;
  const { receipt } = await searchParams;
  const supabase = await createClient();
  const [{ data: inv }, clinic, cfg, { data: allocs }, { data: methodRows }] = await Promise.all([
    supabase.from("invoices").select(`number, kind, status, subtotal, line_discounts, invoice_discount, discount_reason, tax_total, total, amount_paid,
      returned_amount, balance, issued_at, issued_by, void_reason, notes, walk_in_name, customer_id, pet_id, visit_id, is_previous_balance, previous_ref,
      customers(full_name, code, customer_contacts(phone, whatsapp), area), pets(name, code, species(name)), visits(pet_id, pets(name, code, species(name))),
      fulfilment, delivery_status, delivery_address, delivery_notes, service_location, service_address,
      invoice_items(description, quantity, unit_price, discount_amount, line_total, returned_qty, sort_order, line_role), dues(promised_date, status)`).eq("id", id).maybeSingle(),
    getSetting<ClinicProfile>("clinic.profile"),
    getSetting<{ invoice_footer?: string }>("billing.config"),
    supabase.from("payment_allocations").select("amount, payments(kind, method, received_at, reference)").eq("invoice_id", id).order("id"),
    supabase.from("payment_methods").select("key, label"),
  ]);
  const methodLabel = new Map((methodRows ?? []).map((m) => [m.key, m.label]));
  if (!inv || inv.status === "draft") notFound();
  // Products/services first, then the delivery charge as its own line (spec §3).
  const all = ((inv.invoice_items ?? []) as Item[]).sort((a, b) => a.sort_order - b.sort_order);
  const items = all.filter((i) => i.line_role !== "delivery_charge");
  const deliveryLine = all.find((i) => i.line_role === "delivery_charge") ?? null;
  const isDelivery = inv.fulfilment === "home_delivery";
  const isHomeVisit = inv.service_location === "home_visit";
  const customer = withContact(inv.customers as unknown as { full_name: string; area: string | null } | null);
  const pet = inv.pets as unknown as { name: string; code: string } | null;
  const due = (Array.isArray(inv.dues) ? inv.dues[0] : inv.dues) as { promised_date: string; status: string } | null;
  const pays = (allocs ?? []).map((a) => ({ amount: Number(a.amount), ...(a.payments as unknown as { kind: string; method: string; received_at: string; reference: string | null }) }));
  // Still owed from this owner's earlier bills (incl. balances from before the CRM) when this bill was made.
  const prev = inv.customer_id && inv.status !== "void" ? await previousBalance(inv.customer_id, id, inv.issued_at) : null;
  const prevRows = prev && prev.amount > 0 ? (
    <>
      <Row l={`Previous balance (since ${formatDate(prev.since)})`} v={formatPKR(prev.amount)} />
      <Row l="Total due now" v={formatPKR(prev.amount + Number(inv.balance))} strong />
    </>
  ) : null;

  const totals = (
    <dl className="grid gap-1">
      <Row l="Subtotal" v={formatPKR(inv.subtotal)} />
      {Number(inv.line_discounts) + Number(inv.invoice_discount) > 0 && <Row l="Discount" v={`− ${formatPKR(Number(inv.line_discounts) + Number(inv.invoice_discount))}`} />}
      {Number(inv.tax_total) > 0 && <Row l="Tax" v={formatPKR(inv.tax_total)} />}
      <Row l="Total" v={formatPKR(inv.total)} strong />
      {Number(inv.returned_amount) > 0 && <Row l="Returned" v={`− ${formatPKR(inv.returned_amount)}`} />}
      <Row l="Paid" v={formatPKR(inv.amount_paid)} />
      <Row l={Number(inv.balance) > 0 ? "Balance to pay" : "Balance"} v={formatPKR(inv.balance)} strong />
      {prevRows}
    </dl>
  );

  // 80 mm thermal receipt for the pet store counter
  if (receipt) {
    type PetLite = { name: string; code: string; species: { name: string } | null } | null;
    const visitPet = (inv.visits as unknown as { pet_id: string; pets: PetLite } | null);
    const rPet = (inv.pets as unknown as PetLite) ?? visitPet?.pets ?? null;
    const rPetId = inv.pet_id ?? visitPet?.pet_id ?? null;
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
    const [{ data: issuer }, { data: nextDue }] = await Promise.all([
      inv.issued_by ? supabase.from("staff").select("full_name").eq("id", inv.issued_by).maybeSingle() : Promise.resolve({ data: null }),
      rPetId ? supabase.from("due_items").select("title, due_on").eq("pet_id", rPetId).eq("status", "pending").gte("due_on", today)
        .in("kind", ["vaccination", "deworming"]).order("due_on").limit(1).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const code = (inv.customers as unknown as { code?: string } | null)?.code;
    const servedBy = (issuer as { full_name: string | null } | null)?.full_name?.split(" ").slice(0, 2).join(" ") || null;
    const discount = Number(inv.line_discounts) + Number(inv.invoice_discount);
    const num = (v: number | string) => Number(v).toLocaleString("en-PK");
    return (
      <div className="min-h-svh bg-muted py-6 print:bg-white print:py-0">
        <div className="no-print mx-auto mb-3 flex w-[80mm] justify-end"><PrintButton /></div>
        <article className="mx-auto w-[80mm] bg-white px-3 py-3.5 font-sans text-[11px] leading-snug text-black print:p-1">
          {/* Clinic */}
          <div className="text-center">
            <LogoMark tone="ink" className="mx-auto w-10" priority />
            <p className="mt-1.5 text-[14px] font-extrabold tracking-wide">{(clinic?.name || "Bin Dawood Animal Hospital").toUpperCase()}</p>
            {(clinic?.tagline || clinic?.city) && <p className="text-[10px] text-neutral-700">{[clinic?.tagline, clinic?.city].filter(Boolean).join(" · ")}</p>}
            {clinic?.phone && <p className="font-mono text-[10px] text-neutral-700">Tel / WhatsApp {formatPhone(clinic.phone)}</p>}
          </div>

          {inv.status === "void" && <p className="mt-2 border-2 border-black p-1 text-center font-bold">VOID — {inv.void_reason}</p>}
          <div className="mt-2.5 flex justify-between border-y-[1.5px] border-black py-1 text-[11px] font-bold tracking-[0.12em]">
            <span>{inv.is_previous_balance ? "PREVIOUS BALANCE" : "RECEIPT"}</span><span className="font-mono tracking-normal">{inv.number}</span>
          </div>
          <p className="mt-1 flex justify-between font-mono text-[10px]">
            <span>{formatDate(inv.issued_at)}</span>
            <span>{inv.issued_at ? new Date(inv.issued_at).toLocaleTimeString("en-PK", { timeZone: "Asia/Karachi", hour: "numeric", minute: "2-digit" }) : ""}</span>
          </p>

          {/* Customer */}
          {(customer || inv.walk_in_name || rPet || servedBy) && (
            <div className="mt-1.5 grid gap-0.5 rounded-md border border-dashed border-black px-2 py-1.5">
              {(customer || inv.walk_in_name) && (
                <p className="flex justify-between gap-2"><span className="text-neutral-600">Customer</span>
                  <b className="text-right">{customer ? `${customer.full_name}${code ? ` · ${code}` : ""}` : `${inv.walk_in_name} (walk-in)`}</b></p>
              )}
              {rPet && <p className="flex justify-between gap-2"><span className="text-neutral-600">Pet</span><b className="text-right">{rPet.name}{rPet.species ? ` (${rPet.species.name.toLowerCase()})` : ""}</b></p>}
              {servedBy && <p className="flex justify-between gap-2"><span className="text-neutral-600">Served by</span><b className="text-right">{servedBy}</b></p>}
            </div>
          )}

          {(isDelivery || isHomeVisit) && (
            <div className="mt-1.5 rounded-md border border-dashed border-black px-2 py-1.5">
              <p className="font-bold">{isDelivery ? "HOME DELIVERY" : "HOME VISIT"}</p>
              <p>{isDelivery ? inv.delivery_address : inv.service_address}</p>
              {isDelivery && inv.delivery_notes && <p>Note: {inv.delivery_notes}</p>}
            </div>
          )}

          {/* Items */}
          <div className="mt-2">
            {items.map((i, n) => (
              <div key={n} className="mb-1.5">
                <p className="font-semibold">{i.description}</p>
                <p className="flex justify-between font-mono">
                  <span>{num(i.quantity)} × {num(i.unit_price)}{Number(i.discount_amount) ? ` − ${num(i.discount_amount)}` : ""}{Number(i.returned_qty) > 0 ? ` (${num(i.returned_qty)} returned)` : ""}</span>
                  <span>{num(i.line_total)}</span>
                </p>
              </div>
            ))}
            {deliveryLine && <ReceiptLine l="Delivery charge" v={Number(deliveryLine.line_total) === 0 ? "Waived" : num(deliveryLine.line_total)} />}
          </div>
          <hr className="my-1.5 border-dashed border-black" />
          <ReceiptLine l="Subtotal" v={num(inv.subtotal)} />
          {discount > 0 && <ReceiptLine l="Discount" v={`− ${num(discount)}`} />}
          {Number(inv.tax_total) > 0 && <ReceiptLine l="Tax" v={num(inv.tax_total)} />}
          <p className="mt-1 flex justify-between border-y-[1.5px] border-black py-1 text-[15px] font-extrabold"><span>TOTAL</span><span className="font-mono">Rs. {num(inv.total)}</span></p>
          <div className="mt-1 grid gap-0.5 text-[10.5px]">
            {Number(inv.returned_amount) > 0 && <ReceiptLine l="Returned" v={`− ${num(inv.returned_amount)}`} />}
            {pays.map((p, n) => <ReceiptLine key={n} l={p.kind === "refund" ? "Refund" : `Paid · ${methodLabel.get(p.method) ?? p.method}`} v={num(Math.abs(p.amount))} />)}
            {!pays.length && <ReceiptLine l="Paid" v={num(inv.amount_paid)} />}
            <ReceiptLine l={Number(inv.balance) > 0 ? "Balance to pay" : "Balance"} v={num(inv.balance)} b={Number(inv.balance) > 0} />
            {due && due.status === "open" && Number(inv.balance) > 0 && <p className="text-neutral-700">Promised by {formatDate(due.promised_date)}</p>}
            {prev && prev.amount > 0 && (
              <>
                <ReceiptLine l={`Previous balance (since ${formatDate(prev.since)})`} v={num(prev.amount)} />
                <ReceiptLine l="Total due now" v={`Rs. ${num(prev.amount + Number(inv.balance))}`} b />
              </>
            )}
          </div>

          {/* What's next for the pet */}
          {rPet && nextDue && (
            <p className="mt-2.5 rounded-md bg-neutral-100 px-2 py-1.5 text-[10px] print:border print:border-black print:bg-white">
              <b>Next for {rPet.name}:</b> {(nextDue as { title: string; due_on: string }).title} · <b>{formatDate((nextDue as { title: string; due_on: string }).due_on)}</b>
            </p>
          )}

          {/* Thanks */}
          <div className="mt-3 text-center">
            <p className="flex items-center justify-center gap-1.5 text-[12px] font-bold">
              <PawPrint className="size-3.5 shrink-0" strokeWidth={2.4} />
              <span>{rPet ? `Thank you for trusting us with ${rPet.name}!` : "Thank you for shopping with us!"}</span>
              <Heart className="size-3.5 shrink-0 fill-black" strokeWidth={2} />
            </p>
            <p className="text-[10px] text-neutral-700">{rPet ? `Wishing ${rPet.name} a happy, healthy life.` : "Your pets are always welcome here."}</p>
            {cfg?.invoice_footer && <p className="mt-1 text-[10px]">{cfg.invoice_footer}</p>}
          </div>

          <p className="mt-2.5 border-t border-dashed border-black pt-1.5 text-center text-[9px] font-medium [word-spacing:-0.06em]">AI softwares by OBD · +92 337 8624781</p>
        </article>
      </div>
    );
  }

  return (
    <PrintShell clinic={clinic ?? {}} title={inv.status === "void" ? "Bill — VOID" : inv.kind === "store" ? "Sales receipt" : "Bill"} footer={<>{cfg?.invoice_footer ?? "Generated by the Bin Dawood Animal Hospital system."}<span className="mt-1.5 block text-[11px] font-medium text-foreground/80">AI softwares by OBD · +92 337 8624781</span></>}>
      {inv.status === "void" && <p className="mb-4 rounded-lg border-2 border-danger p-2 text-center font-bold text-danger uppercase">Void — {inv.void_reason}</p>}
      <div className="flex justify-between text-xs text-muted-foreground"><span>No. {inv.number}</span><span>{formatDateTime(inv.issued_at)}</span></div>
      <div className="mt-2">
        <InfoGrid rows={[
          ["Customer", customer ? [customer.full_name, formatPhone(customer.phone)].filter(Boolean).join(" · ") : inv.walk_in_name ? `${inv.walk_in_name} (walk-in)` : "Walk-in"],
          ["Pet", pet ? `${pet.name} (${pet.code})` : null],
          ["Service at", inv.kind === "clinic" ? (isHomeVisit ? `Home visit — ${inv.service_address}` : "Bin Dawood Animal Hospital") : null],
          ["Fulfilment", inv.kind === "store" ? (isDelivery ? "Home delivery" : "In store") : null],
          ["Deliver to", isDelivery ? inv.delivery_address : null],
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
          {deliveryLine && (
            <tr className="border-b bg-surface/60">
              <td className="py-1.5 font-medium">Delivery charge</td>
              <td className="text-right">1</td>
              <td className="text-right">{formatPKR(deliveryLine.unit_price)}</td>
              <td className="text-right"></td>
              <td className="text-right font-semibold">{Number(deliveryLine.line_total) === 0 ? "Waived" : formatPKR(deliveryLine.line_total)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="mt-4 ml-auto w-72">{totals}</div>
      {pays.length > 0 && (
        <div className="mt-4 text-xs">
          <p className="font-semibold text-muted-foreground uppercase">Payments</p>
          {pays.map((p, n) => <p key={n}>{formatDateTime(p.received_at)} · {p.kind === "refund" ? "Refund" : p.kind === "write_off" ? "Written off" : methodLabel.get(p.method) ?? p.method}{p.reference ? ` (${p.reference})` : ""} · {formatPKR(Math.abs(p.amount))}</p>)}
        </div>
      )}
      {due && due.status === "open" && Number(inv.balance) > 0 && (
        <p className="mt-4 rounded-lg border-2 border-brand p-2 text-sm"><b>Balance {formatPKR(inv.balance)}</b> — promised by {formatDate(due.promised_date)}.</p>
      )}
      {inv.notes && <p className="mt-4 text-sm">{inv.notes}</p>}
    </PrintShell>
  );
}

function Row({ l, v, strong }: { l: string; v: string; strong?: boolean }) {
  return <div className={`flex justify-between ${strong ? "border-t pt-1 text-[14px] font-bold" : ""}`}><dt>{l}</dt><dd className="tabular">{v}</dd></div>;
}

/** One "label ……… amount" line on the thermal receipt. */
function ReceiptLine({ l, v, b }: { l: React.ReactNode; v: React.ReactNode; b?: boolean }) {
  return <p className={b ? "flex justify-between font-bold" : "flex justify-between"}><span>{l}</span><span className="font-mono">{v}</span></p>;
}
